import { once } from "node:events";

import { type RawData, type WebSocket, WebSocketServer } from "ws";

/** What the model does the next time it responds. */
interface Reply {
  /** The audio it says, as chunks of float samples. */
  audio: number[][];
  /** The words that audio says, sent as Realtime's transcript of it. */
  says?: string;
  /** Whether it then calls `goal_met` — only if the session declared it. */
  goalMet?: boolean;
  /** Whether it stays under way until `finishReply()`, instead of finishing at once. */
  heldOpen?: boolean;
  /** Why it fails to finish, if it does — like the real API, after any audio. */
  failsWith?: string;
}

/**
 * A stand-in for the OpenAI Realtime API, served locally over WebSocket.
 * It speaks the part of the real protocol Litmus uses, in the real wire
 * format, so a model pointed at its `url` runs its real client code.
 * Replies are canned: it's a stub, not a model.
 */
export class FakeRealtimeServer implements AsyncDisposable {
  readonly #server: WebSocketServer;
  readonly #replies: (Reply | { error: string; code: string | null })[] = [];
  readonly #tools = new Set<string>();
  readonly #heard: number[] = [];
  readonly #transcriptions: { words: string; late: boolean }[] = [];
  /** Transcriptions waiting for the next reply to finish. */
  readonly #lateTranscriptions: object[] = [];
  #transcribesInput = false;
  #repliesAutomatically = true;
  #instructions = "";
  /** The reply that's under way, if it was held open. */
  #underWay?: { finish(): void; cancel(): void };
  #items = 0;
  #connections = 0;

  private constructor(server: WebSocketServer) {
    this.#server = server;
    server.on("connection", (socket) => this.#accept(socket));
  }

  static async start(): Promise<FakeRealtimeServer> {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    return new FakeRealtimeServer(server);
  }

  get url(): string {
    const address = this.#server.address();
    if (address === null || typeof address === "string") {
      throw new Error("fake Realtime server is not listening on a port");
    }
    return `ws://127.0.0.1:${address.port}`;
  }

  /**
   * Queues what the model does the next time it responds. Like the real
   * API, it can only call `goal_met` if the session declared that tool.
   */
  replyWith(reply: Reply): void {
    this.#replies.push(reply);
  }

  /**
   * Queues an error in place of what the model does the next time it
   * responds, as the real API sends when it can't carry out a request.
   */
  replyWithError(message: string, code: string | null = null): void {
    this.#replies.push({ error: message, code });
  }

  /**
   * Queues the words the next heard turn turns out to say, as Realtime's
   * transcription of it — only sent if the session enabled transcription.
   * It arrives as soon as the turn ends; with `late`, only once the next
   * reply has finished, like the real API's slowest case.
   */
  transcribesHeardSpeechAs(
    words: string,
    options: { late?: boolean } = {},
  ): void {
    this.#transcriptions.push({ words, late: options.late === true });
  }

  /** Finishes the reply that's under way, if it was held open. */
  finishReply(): void {
    this.#underWay?.finish();
  }

  /**
   * Cancels the reply that's under way, if it was held open — as the real
   * API does when the other side starts talking over it.
   */
  cancelReply(): void {
    this.#underWay?.cancel();
  }

  /** Everything non-silent the model has been sent to hear, as samples. */
  heardSpeech(): number[] {
    return [...this.#heard];
  }

  /** Cuts off every connected session, as a network failure would. */
  dropConnections(): void {
    for (const client of this.#server.clients) client.terminate();
  }

  /** Closes every connected session, giving a reason, as the server would. */
  closeConnections(code: number, reason: string): void {
    for (const client of this.#server.clients) client.close(code, reason);
  }

  /** How many sessions are connected right now. */
  openConnections(): number {
    return this.#server.clients.size;
  }

  /** How many sessions have connected. */
  connections(): number {
    return this.#connections;
  }

  /** The instructions the session was given, if any. */
  instructions(): string {
    return this.#instructions;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.dropConnections();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  #accept(socket: WebSocket): void {
    this.#connections++;
    send(socket, { type: "session.created", session: {} });
    // A crude stand-in for the real API's turn detection: speech followed
    // by silence means the other speaker has finished, so respond.
    let hearingSpeech = false;
    socket.on("message", (data) => {
      const event: unknown = JSON.parse(text(data));
      if (isEventOfType(event, "session.update")) this.#configure(event);
      if (isEventOfType(event, "response.create")) {
        this.#respond(socket, eventIdOf(event));
      }
      if (isEventOfType(event, "input_audio_buffer.append")) {
        const samples = fromPcm16(audioIn(event));
        if (samples.some((sample) => sample !== 0)) {
          this.#heard.push(...samples);
          if (!hearingSpeech) {
            send(socket, { type: "input_audio_buffer.speech_started" });
          }
          hearingSpeech = true;
        } else if (hearingSpeech) {
          hearingSpeech = false;
          this.#endOfHeardTurn(socket);
        }
      }
    });
  }

  #endOfHeardTurn(socket: WebSocket): void {
    const itemId = `item_${++this.#items}`;
    send(socket, { type: "input_audio_buffer.committed", item_id: itemId });
    if (this.#repliesAutomatically) this.#respond(socket, null);
    if (!this.#transcribesInput) return;
    // Like the real API, every heard turn's transcription either completes
    // or fails. With no words provided, the stub has nothing to transcribe.
    const next = this.#transcriptions.shift();
    const transcription =
      next === undefined
        ? {
            type: "conversation.item.input_audio_transcription.failed",
            item_id: itemId,
            error: { message: "Transcription failed" },
          }
        : {
            type: "conversation.item.input_audio_transcription.completed",
            item_id: itemId,
            transcript: next.words,
          };
    if (next?.late) this.#lateTranscriptions.push(transcription);
    else send(socket, transcription);
  }

  #configure(event: object): void {
    if (!("session" in event) || !isObject(event.session)) return;
    if (
      "audio" in event.session &&
      isObject(event.session.audio) &&
      "input" in event.session.audio &&
      isObject(event.session.audio.input) &&
      "transcription" in event.session.audio.input &&
      isObject(event.session.audio.input.transcription)
    ) {
      this.#transcribesInput = true;
    }
    if (
      "audio" in event.session &&
      isObject(event.session.audio) &&
      "input" in event.session.audio &&
      isObject(event.session.audio.input) &&
      "turn_detection" in event.session.audio.input &&
      isObject(event.session.audio.input.turn_detection) &&
      "create_response" in event.session.audio.input.turn_detection &&
      event.session.audio.input.turn_detection.create_response === false
    ) {
      this.#repliesAutomatically = false;
    }
    if (
      "instructions" in event.session &&
      typeof event.session.instructions === "string"
    ) {
      this.#instructions = event.session.instructions;
    }
    const tools = "tools" in event.session ? event.session.tools : [];
    if (!Array.isArray(tools)) return;
    for (const tool of tools) {
      if (isObject(tool) && "name" in tool && typeof tool.name === "string") {
        this.#tools.add(tool.name);
      }
    }
  }

  /**
   * Responds to a request for a reply — `requestId` is the request's
   * `event_id`, which the real API quotes back in any error it causes.
   */
  #respond(socket: WebSocket, requestId: string | null): void {
    // Like the real API, it replies to one request at a time.
    if (this.#underWay) {
      send(socket, {
        type: "error",
        error: {
          type: "invalid_request_error",
          code: "conversation_already_has_active_response",
          message: "Conversation already has an active response in progress.",
          param: null,
          event_id: requestId,
        },
      });
      return;
    }
    const reply = this.#replies.shift() ?? { audio: [] };
    if ("error" in reply) {
      send(socket, {
        type: "error",
        error: {
          type: "invalid_request_error",
          code: reply.code,
          message: reply.error,
          param: null,
          event_id: requestId,
        },
      });
      return;
    }
    send(socket, { type: "response.created", response: {} });
    for (const samples of reply.audio) {
      send(socket, {
        type: "response.output_audio.delta",
        delta: pcm16(samples),
      });
    }
    send(socket, { type: "response.output_audio.done" });
    const underWay = {
      finish: (): void => {
        this.#underWay = undefined;
        this.#finish(socket, reply);
      },
      cancel: (): void => {
        this.#underWay = undefined;
        send(socket, {
          type: "response.done",
          response: {
            status: "cancelled",
            status_details: { type: "cancelled", reason: "turn_detected" },
            output: [],
          },
        });
      },
    };
    if (reply.heldOpen) this.#underWay = underWay;
    else underWay.finish();
  }

  #finish(socket: WebSocket, reply: Reply): void {
    if (reply.failsWith !== undefined) {
      send(socket, {
        type: "response.done",
        response: {
          status: "failed",
          status_details: {
            type: "failed",
            error: {
              type: "invalid_request_error",
              code: "inference_rate_limit_exceeded",
              message: reply.failsWith,
            },
          },
          output: [],
        },
      });
      return;
    }
    if (reply.says !== undefined) {
      send(socket, {
        type: "response.output_audio_transcript.done",
        transcript: reply.says,
      });
    }

    const callsGoalMet = reply.goalMet === true && this.#tools.has("goal_met");
    const output = callsGoalMet
      ? [
          {
            type: "function_call",
            name: "goal_met",
            call_id: "call_1",
            arguments: "{}",
          },
        ]
      : [];
    send(socket, { type: "response.done", response: { output } });
    for (const transcription of this.#lateTranscriptions.splice(0)) {
      send(socket, transcription);
    }
  }
}

function send(socket: WebSocket, event: object): void {
  socket.send(JSON.stringify(event));
}

function text(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isEventOfType(event: unknown, type: string): event is object {
  return isObject(event) && "type" in event && event.type === type;
}

function eventIdOf(event: object): string | null {
  return "event_id" in event && typeof event.event_id === "string"
    ? event.event_id
    : null;
}

function audioIn(event: object): string {
  return "audio" in event && typeof event.audio === "string" ? event.audio : "";
}

/** Decodes base64 little-endian 16-bit PCM into float samples (-1..1). */
function fromPcm16(base64: string): number[] {
  const bytes = Buffer.from(base64, "base64");
  const samples: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    samples.push(bytes.readInt16LE(i) / 32_768);
  }
  return samples;
}

/** Encodes float samples (-1..1) as base64 little-endian 16-bit PCM. */
function pcm16(samples: readonly number[]): string {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => {
    const value = Math.round(sample * 32_768);
    buffer.writeInt16LE(Math.max(-32_768, Math.min(32_767, value)), i * 2);
  });
  return buffer.toString("base64");
}
