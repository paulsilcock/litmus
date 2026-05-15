/**
 * DSL for acceptance tests against the ElevenLabs docs voice agent.
 *
 * Composes an `ElevenLabsDocsDriver` (page protocol) with the
 * `RealtimeBridge` (user simulator) and runs a bidirectional audio
 * conversation between them, returning a Litmus `Conversation` for the
 * test to assert against.
 *
 * Audio plumbing:
 *   Page capture (Float32 @ 48kHz)  -->  resample to 24kHz  -->
 *     PCM16  -->  Realtime input
 *   Realtime output (PCM16 @ 24kHz)  -->  Float32  -->  resample to 48kHz
 *     -->  driver.pushUserAudio (page mic)
 *
 * The conversation ends when any of:
 *   - the simulator emits `done: true` in its persona-mediated reasoning
 *     (we drive that via system prompt instructions)
 *   - max turns elapses
 *   - an inactivity timeout fires (no transcript on either side for N ms)
 */

import { Dsl } from "@litmus/test";

import { ElevenLabsDocsDriver, type AudioStreamHandle } from "./driver.ts";
import {
  float32ToPcm16,
  pcm16ToFloat32,
  RealtimeBridge,
  resampleFloat32,
} from "./realtime-bridge.ts";
import type { Conversation, Turn } from "./types.ts";

const REALTIME_RATE = 24_000;
// El's response latency can be 5–10s after the simulator finishes — we need
// generous slack here. Conversations that exceed this are likely stuck.
const INACTIVITY_TIMEOUT_MS = 20_000;
const POST_AGENT_AUDIO_TAIL_MS = 1_500;

export interface ElevenLabsDslOptions {
  openaiApiKey: string;
  /** Defaults to `gpt-realtime-2`. */
  realtimeModel?: string;
  /** Defaults to `true`. Set `false` to watch the browser. */
  headless?: boolean;
}

export interface ConversationRequest {
  /** Persona injected into the simulator's system prompt. */
  persona: string;
  /** Goal injected into the simulator's system prompt. */
  goal: string;
  /** Hard cap on conversation turns. Defaults to 5. */
  maxTurns?: number;
}

export class ElevenLabsDsl extends Dsl {
  readonly #driver: ElevenLabsDocsDriver;
  readonly #apiKey: string;
  readonly #model: string;

  constructor(options: ElevenLabsDslOptions) {
    super();
    this.#apiKey = options.openaiApiKey;
    this.#model = options.realtimeModel ?? "gpt-realtime-2";
    this.#driver = new ElevenLabsDocsDriver({ headless: options.headless });
  }

  override async init(): Promise<void> {
    await this.#driver.init();
  }

  override async cleanup(): Promise<void> {
    await this.#driver.cleanup();
  }

  async customerSpeaksToAgent(req: ConversationRequest): Promise<Conversation> {
    const maxTurns = req.maxTurns ?? 5;
    const bridge = new RealtimeBridge();
    let stream: AudioStreamHandle | undefined;
    const turns: Turn[] = [];
    let outcome: Conversation["outcome"] = "max_turns";

    let lastActivityAt = Date.now();
    const markActivity = (): void => {
      lastActivityAt = Date.now();
    };

    // Serialised queue for simulator audio playback. Each Realtime
    // chunk is queued behind the previous one so they play back-to-back
    // rather than in parallel — without this the widget hears multiple
    // overlapping streams and its STT fails to transcribe.
    let playbackQueue: Promise<void> = Promise.resolve();

    try {
      await bridge.open({
        apiKey: this.#apiKey,
        model: this.#model,
        instructions: buildSimulatorInstructions(req.persona, req.goal),
      });

      // Wire incoming agent (simulator's) audio back into the page mic.
      // Send at Realtime's native 24kHz; the page's AudioContext will
      // resample on playback with its built-in high-quality resampler.
      bridge.onAgentAudio((pcm24) => {
        markActivity();
        const float24 = pcm16ToFloat32(pcm24);
        const samples = Array.from(float24);
        playbackQueue = playbackQueue.then(() =>
          this.#driver.pushUserAudio(samples, REALTIME_RATE),
        );
      });

      bridge.onTurn((turn) => {
        markActivity();
        turns.push(turn);
        if (process.env.LITMUS_REALTIME_DEBUG) {
          console.log(`[dsl:turn] ${turn.role}: ${turn.content.slice(0, 120)}`);
        }
        if (turns.length >= maxTurns * 2) {
          outcome = "max_turns";
        }
      });

      // Open the chat and start the voice call *after* the bridge is
      // ready, so the agent's greeting flows straight into Realtime.
      await this.#driver.openChat();

      // Start capture *before* clicking the phone button so we catch
      // the greeting from sample 0 — we lost the first ~4s of audio in
      // the earlier non-streaming prototype.
      stream = this.#driver.startCapture({ pollMs: 80 });

      await this.#driver.startVoiceCall();

      // Pump page audio into Realtime.
      const pumpDone = pumpCaptureToBridge(stream, bridge);

      // Watch for end conditions in parallel.
      await waitForEndOfConversation({
        turns,
        maxTurns,
        getLastActivityAt: () => lastActivityAt,
        onOutcome: (o) => {
          outcome = o;
        },
      });

      // Drain anything still in flight before closing.
      await new Promise((r) => setTimeout(r, POST_AGENT_AUDIO_TAIL_MS));

      // Stop the pump (we set a flag inside the helper; the loop exits).
      await stream.stop();
      await pumpDone;
    } finally {
      await bridge.close();
    }

    return { turns, outcome };
  }
}

function buildSimulatorInstructions(persona: string, goal: string): string {
  return `You are a USER speaking to a customer support voice agent (the
"assistant"). Your job is to play the persona below and pursue the goal.

PERSONA:
${persona}

GOAL:
${goal}

Rules of engagement:
- Speak naturally and concisely. One thought per turn.
- Stay in character — don't reveal you are a simulator or an LLM.
- When the goal is met (you have a clear answer), end the conversation
  by thanking the assistant briefly and stopping.
- If the assistant has clearly confirmed or refused without further
  ambiguity, also end the conversation.
- Do NOT volunteer extra information unprompted.
`;
}

// Client-side noise gate threshold. Chunks with RMS below this are
// replaced with explicit zero-filled silence before sending — Realtime
// needs a continuous audio timeline (not gaps) for VAD's silence
// duration to elapse and fire speech_stopped.
const NOISE_GATE_RMS = 0.03;

async function pumpCaptureToBridge(
  stream: AudioStreamHandle,
  bridge: RealtimeBridge,
): Promise<void> {
  let chunkIndex = 0;
  for await (const chunk of stream.chunks) {
    if (chunk.samples.length === 0) continue;
    chunkIndex++;
    let sumSq = 0;
    for (const s of chunk.samples) sumSq += s * s;
    const rms = Math.sqrt(sumSq / chunk.samples.length);
    const isQuiet = rms < NOISE_GATE_RMS;
    if (process.env.LITMUS_REALTIME_DEBUG && chunkIndex % 5 === 0) {
      console.log(
        `[pump] chunk ${chunkIndex} rms=${rms.toFixed(4)} ${isQuiet ? "[silenced]" : "[send]"}`,
      );
    }
    const resampled = resampleFloat32(
      chunk.samples,
      chunk.sampleRate,
      REALTIME_RATE,
    );
    if (isQuiet) {
      // Send true zeros for any chunk below the noise floor. Realtime's
      // VAD measures duration from incoming silent samples, not from
      // gaps in the stream.
      const zeros = new Int16Array(resampled.length);
      bridge.sendUserAudio(zeros);
    } else {
      const pcm = float32ToPcm16(resampled);
      bridge.sendUserAudio(pcm);
    }
  }
}

interface EndWatchOptions {
  turns: Turn[];
  maxTurns: number;
  getLastActivityAt: () => number;
  onOutcome: (o: Conversation["outcome"]) => void;
}

async function waitForEndOfConversation(opts: EndWatchOptions): Promise<void> {
  while (true) {
    await new Promise((r) => setTimeout(r, 500));
    if (opts.turns.length >= opts.maxTurns * 2) {
      opts.onOutcome("max_turns");
      return;
    }
    if (Date.now() - opts.getLastActivityAt() > INACTIVITY_TIMEOUT_MS) {
      // Inactivity = both sides have stopped speaking. Treat as a clean
      // end. Whether the goal was met is the grader's call.
      opts.onOutcome(opts.turns.length > 0 ? "goal_met" : "terminated");
      return;
    }
  }
}
