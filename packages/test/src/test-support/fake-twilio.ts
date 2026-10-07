import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { type RawData, WebSocket } from "ws";

import { decodeMulaw, encodeMulaw } from "#litmus-test/drivers/phone-audio.ts";

/** A call as the fake saw it placed. */
export interface PlacedCall {
  to: string;
  from: string;
}

/**
 * A stand-in for Twilio, served locally. It places calls through the same
 * REST endpoint Twilio has, and when a call is "answered", connects to
 * the stream URL in its TwiML and speaks Twilio's media-stream protocol —
 * so a driver pointed at it runs its real code. The callee is the test:
 * it decides what's said and when, and sees what the caller sent.
 */
export class FakeTwilio implements AsyncDisposable {
  readonly #server: Server;
  readonly #calls: PlacedCall[] = [];
  readonly #heard: number[] = [];
  #socket?: WebSocket;
  #refusal?: string;
  #answers = true;
  #holdsPlayback = false;
  #heldMarks: string[] = [];
  #hungUp = false;

  private constructor(server: Server) {
    this.#server = server;
    server.on(
      "request",
      (request: IncomingMessage, response: ServerResponse) => {
        void this.#handle(request, response);
      },
    );
  }

  static async start(): Promise<FakeTwilio> {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return new FakeTwilio(server);
  }

  /** Where to point a driver's `twilio.apiUrl`. */
  get apiUrl(): string {
    const address = this.#server.address();
    if (address === null || typeof address === "string") {
      throw new Error("FakeTwilio isn't listening on a port.");
    }
    return `http://127.0.0.1:${address.port}`;
  }

  /** Refuses the next call placed, as Twilio does, with this reason. */
  refusesCalls(reason: string): void {
    this.#refusal = reason;
  }

  /** Lets calls ring out: nobody answers, so no audio ever streams. */
  leavesCallsUnanswered(): void {
    this.#answers = false;
  }

  /**
   * Holds what the caller sends as if still playing it, until
   * `finishPlaying()` — Twilio reports playback reaching a mark only once
   * everything before it has played.
   */
  holdsPlayback(): void {
    this.#holdsPlayback = true;
  }

  finishPlaying(): void {
    for (const mark of this.#heldMarks.splice(0)) this.#sendMark(mark);
  }

  /** Whether the caller is waiting to hear that something has played. */
  isPlaying(): boolean {
    return this.#heldMarks.length > 0;
  }

  /** The callee says something: samples at the phone's 8kHz. */
  says(samples: readonly number[]): void {
    this.#send({ event: "media", media: { payload: encodeMulaw(samples) } });
  }

  /** The callee hangs up. */
  hangsUp(): void {
    this.#send({ event: "stop" });
    this.#socket?.close();
  }

  /** Calls placed so far. */
  calls(): readonly PlacedCall[] {
    return [...this.#calls];
  }

  /** Everything the caller has sent down the line, at 8kHz. */
  heard(): number[] {
    return [...this.#heard];
  }

  /** Whether the caller has hung up. */
  callerHungUp(): boolean {
    return this.#hungUp;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#socket?.terminate();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const form = new URLSearchParams(await bodyOf(request));
    const path = request.url ?? "";
    if (/\/Calls\/[^/]+\.json$/.test(path)) {
      // Updating a call: the only update drivers make is hanging up.
      if (form.get("Status") === "completed") {
        this.#hungUp = true;
        this.#socket?.close();
      }
      reply(response, 200, { status: "completed" });
      return;
    }
    if (this.#refusal !== undefined) {
      reply(response, 400, { code: 21211, message: this.#refusal });
      return;
    }
    this.#calls.push({
      to: form.get("To") ?? "",
      from: form.get("From") ?? "",
    });
    reply(response, 201, { sid: `CA${this.#calls.length}`, status: "queued" });
    const streamUrl = /<Stream url="([^"]+)"/.exec(
      form.get("Twiml") ?? "",
    )?.[1];
    if (this.#answers && streamUrl !== undefined) this.#answer(streamUrl);
  }

  #answer(streamUrl: string): void {
    const socket = new WebSocket(streamUrl);
    this.#socket = socket;
    socket.on("open", () => {
      this.#send({ event: "connected", protocol: "Call", version: "1.0.0" });
      this.#send({
        event: "start",
        streamSid: "MZ1",
        start: {
          streamSid: "MZ1",
          mediaFormat: {
            encoding: "audio/x-mulaw",
            sampleRate: 8_000,
            channels: 1,
          },
        },
      });
    });
    socket.on("message", (data) => this.#receive(data));
  }

  #receive(data: RawData): void {
    const message: unknown = JSON.parse(text(data));
    if (!isObject(message) || !("event" in message)) return;
    if (
      message.event === "media" &&
      "media" in message &&
      isObject(message.media) &&
      "payload" in message.media &&
      typeof message.media.payload === "string"
    ) {
      this.#heard.push(...decodeMulaw(message.media.payload));
    }
    if (
      message.event === "mark" &&
      "mark" in message &&
      isObject(message.mark) &&
      "name" in message.mark &&
      typeof message.mark.name === "string"
    ) {
      if (this.#holdsPlayback) this.#heldMarks.push(message.mark.name);
      else this.#sendMark(message.mark.name);
    }
  }

  #sendMark(name: string): void {
    this.#send({ event: "mark", mark: { name } });
  }

  #send(message: object): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) return;
    this.#socket.send(JSON.stringify({ streamSid: "MZ1", ...message }));
  }
}

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    if (Buffer.isBuffer(chunk)) chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function reply(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function text(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}
