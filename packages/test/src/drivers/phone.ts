import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

import type { Audio } from "@litmus/core/ai";
import { type RawData, type WebSocket, WebSocketServer } from "ws";

import { Driver } from "#litmus-test/drivers/base.ts";
import {
  decodeMulaw,
  encodeMulaw,
  PHONE_SAMPLE_RATE,
  resample,
} from "#litmus-test/drivers/phone-audio.ts";

/**
 * A local port made reachable from the internet, e.g. through a tunnel.
 * Disposed with the driver, if it can be.
 */
export interface Exposure extends Partial<AsyncDisposable> {
  /** The public HTTPS address that reaches the port. */
  url: string;
}

export interface PhoneDriverOptions {
  twilio: {
    accountSid: string;
    authToken: string;
    /** The Twilio number calls come from, in international format. */
    from: string;
    /** Where Twilio's REST API is. Defaults to Twilio's own. */
    apiUrl?: string;
  };
  /**
   * Makes the driver's local port reachable from the internet. Twilio
   * streams each call's audio to it, so it can't be localhost — except
   * in tests, against a fake Twilio.
   */
  expose: (port: number) => Promise<Exposure>;
  /** How long to wait for a call to be answered. Defaults to 60 seconds. */
  answerTimeout?: number;
}

/** One call's audio stream, from when Twilio connects to it. */
interface Stream {
  socket: WebSocket;
  streamSid: string;
}

/**
 * Driver for acceptance tests that talk to a system over a real phone
 * call, placed with Twilio. Twilio streams the call's audio both ways to
 * a WebSocket this driver serves, which `expose` makes reachable.
 *
 * Subclasses use `call`, `speak`, `listen` and `hangUp`. Construct, then
 * `await driver.init()`; scope its lifetime with `await using` so any
 * call is hung up and the server closed when the block exits.
 *
 * @example
 * ```typescript
 * class ReceptionDriver extends PhoneDriver {
 *   ring() { return this.call("+447700900123"); }
 *   callerSays(audio: Audio) { return this.speak(audio); }
 *   receptionistSays() { return this.listen(24_000); }
 * }
 * ```
 */
export abstract class PhoneDriver extends Driver {
  readonly #options: PhoneDriverOptions;
  #server?: Server;
  #exposure?: Exposure;
  #callSid?: string;
  #stream?: Stream;
  #connected = (_stream: Stream): void => {};
  #heard: number[] = [];
  #ended = false;
  #wake = (): void => {};
  #played = (): void => {};

  constructor(options: PhoneDriverOptions) {
    super();
    this.#options = options;
  }

  /** Starts serving call audio, and makes it reachable. */
  override async init(): Promise<void> {
    const server = createServer((_request, response) => {
      response.writeHead(200);
      response.end("ok");
    });
    new WebSocketServer({ server, path: "/media" }).on("connection", (socket) =>
      this.#attach(socket),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    this.#server = server;
    const { port }: AddressInfo = addressOf(server);
    this.#exposure = await this.#options.expose(port);
  }

  /**
   * Calls `to`, and resolves once the call is answered and its audio is
   * flowing. Throws if Twilio won't place it, or nobody answers in time.
   */
  protected async call(to: string): Promise<void> {
    const exposure = this.#exposure;
    if (exposure === undefined) {
      throw new Error("PhoneDriver: call init() before placing a call.");
    }
    const streamUrl = `${exposure.url.replace(/^http/, "ws")}/media`;
    this.#stream = undefined;
    this.#heard = [];
    this.#ended = false;
    const connected = new Promise<Stream>((resolve) => {
      this.#connected = resolve;
    });
    this.#callSid = await this.#placeCall(to, streamUrl);
    const timeout = this.#options.answerTimeout ?? 60_000;
    const stream = await Promise.race([
      connected,
      sleep(timeout).then(() => undefined),
    ]);
    if (stream === undefined) {
      await this.#endCall();
      throw new Error(
        `The call to ${to} wasn't answered within ${timeout / 1_000}s, or Twilio couldn't stream its audio. Twilio's call log (Console → Monitor → Logs → Calls) says which.`,
      );
    }
    this.#stream = stream;
  }

  /** Plays audio down the line, at whatever rate it comes in. */
  protected async speak(audio: Audio): Promise<void> {
    const stream = this.#stream;
    if (stream === undefined || this.#ended) return;
    const samples = resample(
      audio.samples,
      audio.sampleRate,
      PHONE_SAMPLE_RATE,
    );
    stream.socket.send(
      JSON.stringify({
        event: "media",
        streamSid: stream.streamSid,
        media: { payload: encodeMulaw(samples) },
      }),
    );
  }

  /**
   * Everything heard since last asked, silence included, at `sampleRate`.
   * Waits for more if there's nothing yet; throws once the call has ended.
   */
  protected async listen(sampleRate: number): Promise<Audio> {
    while (this.#heard.length === 0) {
      if (this.#ended) throw new Error("The call has ended.");
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
    }
    const samples = this.#heard.splice(0);
    return {
      samples: resample(samples, PHONE_SAMPLE_RATE, sampleRate),
      sampleRate,
    };
  }

  /**
   * Hangs up once everything spoken has finished playing — or after ten
   * seconds, if Twilio never says so.
   */
  protected async hangUp(): Promise<void> {
    await this.#untilPlayed(10_000);
    await this.#endCall();
  }

  override async [Symbol.asyncDispose](): Promise<void> {
    await this.#endCall();
    this.#server?.close();
    await this.#exposure?.[Symbol.asyncDispose]?.();
  }

  async #placeCall(to: string, streamUrl: string): Promise<string> {
    const response = await fetch(this.#callsUrl(), {
      method: "POST",
      headers: { Authorization: this.#authorization() },
      body: new URLSearchParams({
        To: to,
        From: this.#options.twilio.from,
        Twiml: `<Response><Connect><Stream url="${streamUrl}"/></Connect></Response>`,
      }),
    });
    const body: unknown = await response.json();
    if (
      response.ok &&
      isObject(body) &&
      "sid" in body &&
      typeof body.sid === "string"
    ) {
      return body.sid;
    }
    const reason =
      isObject(body) && "message" in body && typeof body.message === "string"
        ? body.message
        : JSON.stringify(body);
    throw new Error(`Twilio didn't place the call to ${to}: ${reason}`);
  }

  /** Ends the call, if one is in progress. */
  async #endCall(): Promise<void> {
    const callSid = this.#callSid;
    if (callSid === undefined) return;
    this.#callSid = undefined;
    await fetch(this.#callsUrl(callSid), {
      method: "POST",
      headers: { Authorization: this.#authorization() },
      body: new URLSearchParams({ Status: "completed" }),
    });
    this.#end();
  }

  /** Resolves once Twilio has played everything sent, via a mark. */
  async #untilPlayed(limit: number): Promise<void> {
    const stream = this.#stream;
    if (stream === undefined || this.#ended) return;
    const played = new Promise<void>((resolve) => {
      this.#played = resolve;
    });
    stream.socket.send(
      JSON.stringify({
        event: "mark",
        streamSid: stream.streamSid,
        mark: { name: "played" },
      }),
    );
    await Promise.race([played, sleep(limit)]);
  }

  #attach(socket: WebSocket): void {
    socket.on("message", (data) => {
      const message = parseMessage(data);
      if (message.event === "start") {
        this.#connected({ socket, streamSid: message.streamSid });
      } else if (message.event === "media") {
        this.#heard.push(...decodeMulaw(message.payload));
        this.#wake();
      } else if (message.event === "mark") {
        this.#played();
      } else if (message.event === "stop") {
        this.#end();
      }
    });
    socket.on("close", () => this.#end());
  }

  #end(): void {
    this.#ended = true;
    this.#wake();
    this.#played();
  }

  #callsUrl(callSid?: string): string {
    const { apiUrl = "https://api.twilio.com", accountSid } =
      this.#options.twilio;
    const call = callSid === undefined ? "" : `/${callSid}`;
    return `${apiUrl}/2010-04-01/Accounts/${accountSid}/Calls${call}.json`;
  }

  #authorization(): string {
    const { accountSid, authToken } = this.#options.twilio;
    return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  }
}

type StreamMessage =
  | { event: "start"; streamSid: string }
  | { event: "media"; payload: string }
  | { event: "mark" }
  | { event: "stop" }
  | { event: "other" };

/** Reads one of the messages Twilio sends over a media stream. */
function parseMessage(data: RawData): StreamMessage {
  const message: unknown = JSON.parse(text(data));
  if (!isObject(message) || !("event" in message)) return { event: "other" };
  if (
    message.event === "start" &&
    "streamSid" in message &&
    typeof message.streamSid === "string"
  ) {
    return { event: "start", streamSid: message.streamSid };
  }
  if (
    message.event === "media" &&
    "media" in message &&
    isObject(message.media) &&
    "payload" in message.media &&
    typeof message.media.payload === "string"
  ) {
    return { event: "media", payload: message.media.payload };
  }
  if (message.event === "mark") return { event: "mark" };
  if (message.event === "stop") return { event: "stop" };
  return { event: "other" };
}

function addressOf(server: Server): AddressInfo {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("PhoneDriver: the media server isn't listening on a port.");
  }
  return address;
}

function text(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}
