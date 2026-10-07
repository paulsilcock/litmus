import { on, once } from "node:events";

import type {
  Audio,
  SimulatedUserAction,
  VoiceModel,
  VoiceSession,
} from "@litmus/core/ai";
import { type RawData, WebSocket } from "ws";

const SAMPLE_RATE = 24_000;
const DEFAULT_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime";

/** Who the simulated user is, and — once it's pursuing one — its goal. */
interface Brief {
  persona: string;
  goal?: string;
}

/** A voice for a simulated user, backed by the OpenAI Realtime API. */
export class OpenAIRealtimeVoiceModel implements VoiceModel {
  /** OpenAI Realtime listens to 24kHz audio. */
  readonly inputSampleRate = SAMPLE_RATE;
  readonly #apiKey: string;
  readonly #url: string;

  /**
   * @param options.apiKey An OpenAI API key.
   * @param options.url The Realtime endpoint. Defaults to `gpt-realtime`;
   *   point it at a `FakeRealtimeServer` in tests.
   */
  constructor(options: { apiKey: string; url?: string }) {
    this.#apiKey = options.apiKey;
    this.#url = options.url ?? DEFAULT_URL;
  }

  /**
   * Opens a conversation in which the model plays the simulated user. It
   * listens, but says nothing until given a goal to pursue.
   */
  async connect(who: { persona: string }): Promise<RealtimeVoiceSession> {
    return RealtimeVoiceSession.open(
      { url: this.#url, apiKey: this.#apiKey },
      who.persona,
    );
  }
}

/** An open Realtime session, lasting one conversation. */
export class RealtimeVoiceSession implements VoiceSession {
  readonly #socket: WebSocket;
  readonly #messages: ReturnType<typeof on>;
  readonly #persona: string;
  #pursuing = false;
  #replying = false;
  #closing = false;
  /** How the connection closed, once it has. */
  #closed = "";
  #requests = 0;

  private constructor(
    socket: WebSocket,
    messages: ReturnType<typeof on>,
    persona: string,
  ) {
    this.#socket = socket;
    this.#messages = messages;
    this.#persona = persona;
    socket.once("close", (code: number, reason: Buffer) => {
      const why = reason.toString("utf8");
      this.#closed = why === "" ? `${code}` : `${code}: ${why}`;
    });
  }

  static async open(
    connection: { url: string; apiKey: string },
    persona: string,
  ): Promise<RealtimeVoiceSession> {
    const socket = new WebSocket(connection.url, {
      headers: { Authorization: `Bearer ${connection.apiKey}` },
    });
    // Listen before anything can arrive, and stop when the socket closes.
    const messages = on(socket, "message", { close: ["close"] });
    await once(socket, "open");
    const session = new RealtimeVoiceSession(socket, messages, persona);
    session.#send({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: instructionsFor({ persona }),
        tools: [GOAL_MET_TOOL],
        audio: {
          input: {
            // Transcribe what the simulated user hears, so it can be recorded.
            transcription: { model: "gpt-4o-transcribe" },
            // Detect turns by whether the speaker sounds finished, not just
            // by a pause, so the simulated user doesn't reply mid-sentence.
            // Reply only when asked: before a goal it just listens.
            turn_detection: { type: "semantic_vad", create_response: false },
          },
        },
      },
    });
    return session;
  }

  /**
   * What the simulated user does, for as long as the session is open.
   * Throws if OpenAI reports an error or fails to finish a reply, or if the
   * connection is lost before the session is closed.
   */
  async *actions(): AsyncIterable<SimulatedUserAction> {
    const order = new ConversationOrder();
    for await (const [data] of this.#messages) {
      const event: unknown = JSON.parse(text(data));
      if (isError(event)) throw new Error(describe(event.error));
      const failure = replyFailure(event);
      if (failure !== undefined) {
        throw new Error(`OpenAI Realtime couldn't finish a reply: ${failure}`);
      }
      if (isEvent(event, "response.done")) this.#replying = false;
      // While pursuing, reply whenever the other side finishes a turn —
      // unless a reply is already under way.
      if (
        this.#pursuing &&
        !this.#replying &&
        isEvent(event, "input_audio_buffer.committed")
      ) {
        this.#reply();
      }
      for (const action of actionsFrom(event, order)) {
        // Once a goal is met, stop replying until given another.
        if (action.type === "finishedTurn" && action.goalMet) {
          this.#pursuing = false;
        }
        yield action;
      }
    }
    if (!this.#closing) {
      throw new Error(
        `The connection to OpenAI Realtime closed unexpectedly (code ${this.#closed}).`,
      );
    }
  }

  /** Gives the simulated user a goal, and has it start working towards it. */
  pursue(goal: string): void {
    this.#send({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: instructionsFor({ persona: this.#persona, goal }),
      },
    });
    this.#reply();
    this.#pursuing = true;
  }

  /** Sends a request, with an id that says what it was. */
  #send<Request extends { type: string }>(event: Request): void {
    const request = { ...event, event_id: `${event.type}#${++this.#requests}` };
    this.#socket.send(JSON.stringify(request));
  }

  /**
   * Asks for the simulated user's next turn — reminding it, last thing
   * before it replies, which side of the conversation it's on.
   */
  #reply(): void {
    this.#send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: REPLY_REMINDER }],
      },
    });
    this.#send({ type: "response.create" });
    this.#replying = true;
  }

  /** Passes on what the other side of the conversation said. */
  listenTo(audio: Audio): void {
    this.#send({
      type: "input_audio_buffer.append",
      audio: toPcm16(audio.samples),
    });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#closing = true;
    await this.#messages.return?.();
    this.#socket.close();
  }
}

/** Turns one Realtime event into whatever the simulated user did, in order. */
function actionsFrom(
  event: unknown,
  order: ConversationOrder,
): SimulatedUserAction[] {
  if (isAudioDelta(event)) {
    // Speech is never held back.
    return [{ type: "speak", audio: fromPcm16(event.delta) }];
  }
  if (isEvent(event, "input_audio_buffer.speech_started")) {
    // Nor is the moment the other side starts speaking.
    return [{ type: "hearing" }];
  }
  if (isEvent(event, "input_audio_buffer.committed")) {
    order.awaitTranscription(itemIdOf(event));
    return [];
  }
  if (hasTranscript(event, INPUT_TRANSCRIPT)) {
    return order.transcribed(itemIdOf(event), {
      type: "heard",
      text: event.transcript,
    });
  }
  if (isEvent(event, INPUT_TRANSCRIPTION_FAILED)) {
    return order.transcribed(itemIdOf(event), {
      type: "unclear",
      reason: errorMessageOf(event),
    });
  }
  if (hasTranscript(event, OUTPUT_TRANSCRIPT)) {
    return order.after({ type: "said", text: event.transcript });
  }
  if (isEvent(event, "response.done")) {
    // A cancelled reply was cut off before it was finished: it isn't a turn.
    if (statusOf(event) === "cancelled") return [];
    return order.after({ type: "finishedTurn", goalMet: callsGoalMet(event) });
  }
  return [];
}

/**
 * Keeps the conversation reported in the order it happened. Transcription
 * of what was heard can arrive after the reply to it, so words and the
 * end of a turn wait until every heard turn before them has been
 * transcribed (or its transcription has failed).
 */
class ConversationOrder {
  readonly #awaiting = new Set<string>();
  readonly #held: SimulatedUserAction[] = [];

  awaitTranscription(itemId: string | undefined): void {
    if (itemId !== undefined) this.#awaiting.add(itemId);
  }

  /** A heard turn has been transcribed: what was heard, or that it was unclear. */
  transcribed(
    itemId: string | undefined,
    heard: SimulatedUserAction,
  ): SimulatedUserAction[] {
    if (itemId !== undefined) this.#awaiting.delete(itemId);
    const released = this.#awaiting.size === 0 ? this.#held.splice(0) : [];
    return [heard, ...released];
  }

  /** Something that must follow any heard turns still being transcribed. */
  after(action: SimulatedUserAction): SimulatedUserAction[] {
    if (this.#awaiting.size === 0) return [action];
    this.#held.push(action);
    return [];
  }
}

const GOAL_MET_TOOL = {
  type: "function",
  name: "goal_met",
  description: "Call this once your goal has been achieved.",
  parameters: { type: "object", properties: {} },
};

/** Sent before every reply: the model's training pulls it towards helping. */
const REPLY_REMINDER =
  "Stay in character as the person described in your instructions. You're not an assistant: you're the one who wants something, not the one helping.";

function instructionsFor(brief: Brief): string {
  return [
    `You are ${brief.persona.replace(/\.\s*$/, "")}.`,
    ...(brief.goal === undefined ? [] : [`What you want: ${brief.goal}`]),
    "The other voice in the conversation is there to help you. You're the one who wants something: you ask, it answers. You don't know its answers until it tells you.",
    "Get to what you want early, without waiting to be asked.",
    "Talk like a real person: briefly, a sentence or two at a time.",
    "When you've got what you wanted, wrap up naturally, then call the goal_met function.",
    "Never mention that this is a test.",
  ].join("\n");
}

/**
 * What an OpenAI error says went wrong. Our requests' ids start with their
 * type, so an error that quotes one says which request it rejected.
 */
function describe(error: { message: string } & object): string {
  const id =
    "event_id" in error && typeof error.event_id === "string"
      ? error.event_id
      : undefined;
  const code =
    "code" in error && typeof error.code === "string" ? ` (${error.code})` : "";
  const rejected = id === undefined ? "" : ` rejected ${id.split("#")[0]}`;
  return `OpenAI Realtime${rejected}: ${error.message}${code}`;
}

function text(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isEvent(event: unknown, type: string): event is { type: string } {
  return isObject(event) && "type" in event && event.type === type;
}

function isError(event: unknown): event is { error: { message: string } } {
  return (
    isEvent(event, "error") &&
    "error" in event &&
    isObject(event.error) &&
    "message" in event.error &&
    typeof event.error.message === "string"
  );
}

/** Why a `response.done` event's reply failed, if it did. */
function replyFailure(event: unknown): string | undefined {
  if (!isEvent(event, "response.done") || statusOf(event) !== "failed") return;
  const details =
    "response" in event &&
    isObject(event.response) &&
    "status_details" in event.response
      ? event.response.status_details
      : undefined;
  return isObject(details) ? errorMessageOf(details) : "no reason given";
}

/** The status a `response.done` event gives its reply. */
function statusOf(event: object): unknown {
  return "response" in event &&
    isObject(event.response) &&
    "status" in event.response
    ? event.response.status
    : undefined;
}

function isAudioDelta(event: unknown): event is { delta: string } {
  return (
    isEvent(event, "response.output_audio.delta") &&
    "delta" in event &&
    typeof event.delta === "string"
  );
}

/** What the simulated user said, transcribed by Realtime as it spoke. */
const OUTPUT_TRANSCRIPT = "response.output_audio_transcript.done";
/** What the simulated user heard, transcribed once the speaker finished. */
const INPUT_TRANSCRIPT =
  "conversation.item.input_audio_transcription.completed";
/** What was heard couldn't be made out; the conversation carries on regardless. */
const INPUT_TRANSCRIPTION_FAILED =
  "conversation.item.input_audio_transcription.failed";

/** The message of the error an event carries. */
function errorMessageOf(event: object): string {
  const error = "error" in event ? event.error : undefined;
  return isObject(error) &&
    "message" in error &&
    typeof error.message === "string"
    ? error.message
    : "no reason given";
}

function itemIdOf(event: object): string | undefined {
  return "item_id" in event && typeof event.item_id === "string"
    ? event.item_id
    : undefined;
}

function hasTranscript(
  event: unknown,
  type: string,
): event is { transcript: string } {
  return (
    isEvent(event, type) &&
    "transcript" in event &&
    typeof event.transcript === "string"
  );
}

/** Whether a `response.done` event includes a call to `goal_met`. */
function callsGoalMet(event: object): boolean {
  if (!("response" in event) || !isObject(event.response)) return false;
  const output = "output" in event.response ? event.response.output : [];
  return (
    Array.isArray(output) &&
    output.some(
      (item) =>
        isObject(item) &&
        "type" in item &&
        item.type === "function_call" &&
        "name" in item &&
        item.name === "goal_met",
    )
  );
}

/** Encodes float samples (-1..1) as base64 little-endian 16-bit PCM. */
function toPcm16(samples: readonly number[]): string {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => {
    const value = Math.round(sample * 32_768);
    buffer.writeInt16LE(Math.max(-32_768, Math.min(32_767, value)), i * 2);
  });
  return buffer.toString("base64");
}

/** Decodes base64 little-endian 16-bit PCM into float samples (-1..1). */
function fromPcm16(base64: string): Audio {
  const bytes = Buffer.from(base64, "base64");
  const samples: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    samples.push(bytes.readInt16LE(i) / 32_768);
  }
  return { samples, sampleRate: SAMPLE_RATE };
}
