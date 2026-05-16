import { Buffer } from "node:buffer";
import { setTimeout as sleep } from "node:timers/promises";

import type { AudioStream } from "@litmus/test";
import { OpenAI } from "openai";
import { OpenAIRealtimeWebSocket } from "openai/realtime/websocket";

import type { ElevenLabsDocsDriver } from "./driver.ts";

const REALTIME_SAMPLE_RATE = 24_000;

// Bypasses vitest's console.log capture/buffering so the live
// transcript streams to stdout while the test runs.
function emit(line: string): void {
  process.stdout.write(`${line}\n`);
}

interface BridgeOptions {
  driver: ElevenLabsDocsDriver;
  instructions: string;
  voice?: string;
  model?: string;
  apiKey?: string;
}

export interface BridgeTurn {
  speaker: "agent" | "user";
  content: string;
}

interface RunOptions {
  maxDurationMs: number;
}

/**
 * Bridges OpenAI's Realtime API to a voice-capable browser driver,
 * so the realtime LLM impersonates a calling user. El (or any other
 * voice agent) sees a synthetic mic carrying the LLM's speech; the
 * LLM hears the agent's spoken responses via the driver's capture
 * stream and reacts as if it were a customer on a phone call.
 *
 * - El's audio (Float32 @ page sample rate) → resampled to 24kHz PCM16
 *   → fed into realtime `input_audio_buffer.append`. Server-side VAD
 *   detects when El stops talking and auto-fires a response.
 * - Realtime audio output (PCM16 @ 24kHz) → decoded to Float32 →
 *   pushed through `driver.sendUserAudio` into El's mic.
 *
 * Transcripts are captured via `response.output_audio_transcript.done`
 * (the simulated user's speech) and
 * `conversation.item.input_audio_transcription.completed` (El's
 * speech). The orchestration uses the test author's perspective —
 * "user" is the simulator, "agent" is the SUT — which is the
 * inverse of what the Realtime API sees.
 *
 * Termination is by `maxDurationMs` only for now.
 */
export class RealtimeBridge {
  readonly #driver: ElevenLabsDocsDriver;
  readonly #instructions: string;
  readonly #voice: string;
  readonly #model: string;
  readonly #apiKey: string;
  readonly #turns: BridgeTurn[] = [];
  #stream?: AudioStream;

  constructor(options: BridgeOptions) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "RealtimeBridge: OPENAI_API_KEY env var or `apiKey` option is required",
      );
    }
    this.#driver = options.driver;
    this.#instructions = options.instructions;
    this.#voice = options.voice ?? "alloy";
    this.#model = options.model ?? "gpt-realtime";
    this.#apiKey = apiKey;
  }

  get turns(): readonly BridgeTurn[] {
    return this.#turns;
  }

  /**
   * Open the driver's audio capture stream now so the buffer
   * accumulates anything the agent says before `run()` starts. Call
   * this immediately after the driver has joined the voice call but
   * before any time you spend waiting for greetings or warmup —
   * otherwise the agent's opening turn will be lost.
   */
  async startCapture(): Promise<void> {
    if (this.#stream) return;
    this.#stream = await this.#driver.openAgentAudioStream();
  }

  async run({ maxDurationMs }: RunOptions): Promise<readonly BridgeTurn[]> {
    if (!this.#stream) {
      this.#stream = await this.#driver.openAgentAudioStream();
    }
    const stream = this.#stream;

    const ws = new OpenAIRealtimeWebSocket(
      { model: this.#model },
      new OpenAI({ apiKey: this.#apiKey }),
    );

    await waitForEvent(ws, "session.created");

    ws.send({
      type: "session.update",
      session: {
        type: "realtime",
        model: this.#model,
        output_modalities: ["audio"],
        instructions: this.#instructions,
        audio: {
          input: {
            format: { type: "audio/pcm", rate: REALTIME_SAMPLE_RATE },
            transcription: { model: "whisper-1" },
            noise_reduction: { type: "near_field" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 200,
              silence_duration_ms: 500,
              create_response: true,
            },
          },
          output: {
            format: { type: "audio/pcm", rate: REALTIME_SAMPLE_RATE },
            voice: this.#voice,
          },
        },
      },
    });
    await waitForEvent(ws, "session.updated");

    ws.on("conversation.item.input_audio_transcription.completed", (event) => {
      if (event.transcript) {
        this.#turns.push({ speaker: "agent", content: event.transcript });
        emit(`AGENT: ${event.transcript}`);
      }
    });
    ws.on("response.output_audio_transcript.done", (event) => {
      if (event.transcript) {
        this.#turns.push({ speaker: "user", content: event.transcript });
        emit(`USER:  ${event.transcript}`);
      }
    });

    // Serialise outgoing audio playback so chunks don't overlap.
    let outboundChain: Promise<void> = Promise.resolve();
    ws.on("response.output_audio.delta", (event) => {
      const pcm = Buffer.from(event.delta, "base64");
      const samples = pcm16ToFloat32(pcm);
      outboundChain = outboundChain
        .then(() => this.#driver.sendUserAudio(samples, REALTIME_SAMPLE_RATE))
        .catch(() => {});
    });

    // Pump driver-captured audio into the realtime input buffer.
    // Send every chunk including silence — VAD needs to see pauses to
    // detect end-of-speech. Filtering silent chunks would hide every
    // gap between the agent's utterances.
    let stopped = false;
    const pumpPromise = (async () => {
      while (!stopped) {
        const chunk = await stream.read();
        if (chunk.samples.length === 0) {
          await sleep(100);
          continue;
        }
        const resampled = resample(
          chunk.samples,
          chunk.sampleRate,
          REALTIME_SAMPLE_RATE,
        );
        const pcm = float32ToPcm16(resampled);
        ws.send({
          type: "input_audio_buffer.append",
          audio: pcm.toString("base64"),
        });
        await sleep(100);
      }
    })();

    try {
      await sleep(maxDurationMs);
    } finally {
      stopped = true;
      await pumpPromise;
      await stream.close();
      this.#stream = undefined;
      await outboundChain;
      ws.close();
    }

    return this.#turns;
  }
}

function pcm16ToFloat32(buf: Buffer): number[] {
  const length = buf.length / 2;
  const out: number[] = Array.from({ length });
  for (let i = 0; i < length; i++) {
    const v = buf.readInt16LE(i * 2);
    out[i] = v / (v < 0 ? 0x8000 : 0x7fff);
  }
  return out;
}

function float32ToPcm16(samples: number[]): Buffer {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const raw = samples[i] ?? 0;
    const clamped = Math.max(-1, Math.min(1, raw));
    buf.writeInt16LE(
      Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff),
      i * 2,
    );
  }
  return buf;
}

function resample(samples: number[], from: number, to: number): number[] {
  if (from === to) return samples;
  const ratio = from / to;
  const length = Math.floor(samples.length / ratio);
  const out: number[] = Array.from({ length });
  for (let i = 0; i < length; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = srcIdx - lo;
    out[i] = (samples[lo] ?? 0) * (1 - frac) + (samples[hi] ?? 0) * frac;
  }
  return out;
}

function waitForEvent<E extends Parameters<OpenAIRealtimeWebSocket["on"]>[0]>(
  ws: OpenAIRealtimeWebSocket,
  event: E,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: { message: string }) => {
      ws.off("error", onError);
      reject(new Error(`waitForEvent(${String(event)}): ${err.message}`));
    };
    ws.once(event, () => {
      ws.off("error", onError);
      resolve();
    });
    ws.on("error", onError);
  });
}
