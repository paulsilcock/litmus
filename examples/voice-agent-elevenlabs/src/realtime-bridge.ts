/**
 * Wrapper around OpenAI's official Realtime client.
 *
 * Role mapping (deliberate, since it's confusing):
 *  - The Realtime model is acting as the *simulator* (user persona).
 *  - Audio it RECEIVES is the SUT (El) speaking — we emit those
 *    transcripts as `role: "assistant"` in the Conversation.
 *  - Audio it SENDS is the simulated user speaking — we emit those
 *    transcripts as `role: "user"`.
 *
 * Audio format on the wire: PCM16 little-endian @ 24kHz mono, base64.
 *
 * This bridge does NOT resample. Callers feed it 24kHz PCM16; they're
 * responsible for converting from whatever the page's audio context
 * uses (typically 48kHz Float32). Conversion helpers exported below.
 */

import { Buffer } from "node:buffer";

import { OpenAI } from "openai";
import { OpenAIRealtimeWebSocket } from "openai/realtime/websocket";

import type { Turn } from "./types.ts";

export interface RealtimeBridgeOptions {
  apiKey: string;
  /** Realtime model id (e.g. `gpt-realtime-2`). */
  model: string;
  /** System-prompt-equivalent for the simulator role. */
  instructions: string;
  /** Synthetic voice id used for the simulator's speech. */
  voice?: string;
}

type AgentAudioListener = (pcm16le24k: Int16Array) => void;
type TurnListener = (turn: Turn) => void;
type DoneListener = () => void;

export class RealtimeBridge {
  #rt: OpenAIRealtimeWebSocket | undefined;
  #agentAudioListeners: Set<AgentAudioListener> = new Set();
  #turnListeners: Set<TurnListener> = new Set();
  #doneListeners: Set<DoneListener> = new Set();
  #pendingSimulatorTranscript = "";

  async open(opts: RealtimeBridgeOptions): Promise<void> {
    const client = new OpenAI({ apiKey: opts.apiKey });
    const rt = new OpenAIRealtimeWebSocket({ model: opts.model }, client);
    this.#rt = rt;

    rt.on("session.created", () => {
      if (process.env.LITMUS_REALTIME_DEBUG) {
        console.log("[realtime:event] session.created");
      }
      rt.send({
        type: "session.update",
        session: {
          type: "realtime",
          instructions: opts.instructions,
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24_000 },
              transcription: { model: "whisper-1" },
              // Page audio carries a constant noise floor from the browser
              // and fake-device flags; without noise reduction the server
              // VAD reads it as continuous speech and never fires
              // speech_stopped, stalling the conversation.
              noise_reduction: { type: "near_field" },
              turn_detection: {
                type: "server_vad",
                threshold: 0.5,
                prefix_padding_ms: 200,
                silence_duration_ms: 200,
                create_response: true,
              },
            },
            output: {
              format: { type: "audio/pcm", rate: 24_000 },
              voice: opts.voice ?? "alloy",
            },
          },
        },
      });
    });

    rt.on("event", (event) => {
      if (process.env.LITMUS_REALTIME_DEBUG) {
        console.log("[realtime:event]", event.type);
      }
    });

    rt.on("response.output_audio.delta", (event) => {
      const bytes = Buffer.from(event.delta, "base64");
      const pcm16 = new Int16Array(
        bytes.buffer,
        bytes.byteOffset,
        Math.floor(bytes.byteLength / 2),
      );
      for (const listener of this.#agentAudioListeners) listener(pcm16);
    });

    rt.on("response.output_audio_transcript.delta", (event) => {
      if (typeof event.delta === "string") {
        this.#pendingSimulatorTranscript += event.delta;
      }
    });

    rt.on("response.output_audio_transcript.done", () => {
      const transcript = this.#pendingSimulatorTranscript.trim();
      this.#pendingSimulatorTranscript = "";
      if (transcript.length > 0) {
        for (const listener of this.#turnListeners) {
          listener({ role: "user", content: transcript });
        }
      }
    });

    rt.on("conversation.item.input_audio_transcription.completed", (event) => {
      const transcript = (event.transcript ?? "").trim();
      if (transcript.length > 0) {
        for (const listener of this.#turnListeners) {
          listener({ role: "assistant", content: transcript });
        }
      }
    });

    rt.on("response.done", () => {
      for (const listener of this.#doneListeners) listener();
    });

    rt.on("error", (err) => {
      console.error("[realtime:error]", err.error ?? err.message);
    });

    // Wait for the session to be ready before returning. We resolve on
    // `session.updated` so callers know our config was applied.
    await new Promise<void>((resolve, reject) => {
      const onUpdated = (): void => {
        rt.off("session.updated", onUpdated);
        rt.off("error", onError);
        resolve();
      };
      const onError = (err: { message: string }): void => {
        rt.off("session.updated", onUpdated);
        rt.off("error", onError);
        reject(new Error(err.message));
      };
      rt.on("session.updated", onUpdated);
      rt.on("error", onError);
    });
  }

  /** Push captured page audio into Realtime as the user-side input. */
  sendUserAudio(pcm16le24k: Int16Array): void {
    if (!this.#rt) return;
    if (process.env.LITMUS_REALTIME_DEBUG) {
      console.log("[realtime:send_user_audio]", pcm16le24k.length, "samples");
    }
    const b64 = Buffer.from(
      pcm16le24k.buffer,
      pcm16le24k.byteOffset,
      pcm16le24k.byteLength,
    ).toString("base64");
    this.#rt.send({ type: "input_audio_buffer.append", audio: b64 });
  }

  onAgentAudio(cb: AgentAudioListener): () => void {
    this.#agentAudioListeners.add(cb);
    return () => this.#agentAudioListeners.delete(cb);
  }

  onTurn(cb: TurnListener): () => void {
    this.#turnListeners.add(cb);
    return () => this.#turnListeners.delete(cb);
  }

  onDone(cb: DoneListener): () => void {
    this.#doneListeners.add(cb);
    return () => this.#doneListeners.delete(cb);
  }

  async close(): Promise<void> {
    if (!this.#rt) return;
    const rt = this.#rt;
    this.#rt = undefined;
    rt.close();
  }
}

// ---------------------------------------------------------------------------
// Audio conversion / resampling helpers — unchanged from the hand-rolled
// version. Page captures arrive as Float32 @ ~48kHz; Realtime wants
// PCM16 @ 24kHz.

export function float32ToPcm16(samples: ArrayLike<number>): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    out[i] = Math.round(v * 32767);
  }
  return out;
}

export function pcm16ToFloat32(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i]! / 32768;
  return out;
}

export function resampleFloat32(
  samples: ArrayLike<number>,
  inRate: number,
  outRate: number,
): Float32Array {
  if (inRate === outRate) {
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) out[i] = samples[i]!;
    return out;
  }
  // Linear interpolation. Better quality than naive sample-and-hold for
  // upsampling (24k→48k) — without it, stairstep artifacts make the
  // resulting audio hard for the SUT's STT to transcribe. Still cheap;
  // for production-grade audio you'd want a proper polyphase filter.
  const ratio = inRate / outRate;
  const outLength = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(outLength);
  const last = samples.length - 1;
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const lower = Math.floor(pos);
    const upper = Math.min(lower + 1, last);
    const frac = pos - lower;
    const a = samples[lower] ?? 0;
    const b = samples[upper] ?? 0;
    out[i] = a + (b - a) * frac;
  }
  return out;
}
