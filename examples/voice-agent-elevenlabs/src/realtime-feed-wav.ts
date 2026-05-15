/**
 * Feeds the recorded `agent-greeting-24k.wav` file (which we already
 * confirmed sounds clean) into a Realtime session in small chunks,
 * mimicking what the live bridge does — but without the browser, the
 * audio pump, or the resampler in the path. Pure WAV → Realtime.
 *
 * If Realtime emits `speech_stopped` + a transcript here, then the
 * issue with the eval is specific to live page-audio chunking/timing.
 * If it still gets stuck on `speech_started`, the issue is in our
 * Realtime session config and we have no audio variable to chase.
 *
 * Run after running `record-resampled` so the WAV exists:
 *   vp dlx tsx ./src/record-resampled.ts
 *   vp dlx tsx ./src/realtime-feed-wav.ts
 */

import "dotenv/config";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { OpenAI } from "openai";
import { OpenAIRealtimeWebSocket } from "openai/realtime/websocket";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WAV_PATH = join(__dirname, "..", "out", "agent-greeting-24k.wav");
const CHUNK_SAMPLES = 2_048;
const CHUNK_INTERVAL_MS = 80;

interface WavPayload {
  samples: Int16Array;
  sampleRate: number;
}

function readWav16(path: string): WavPayload {
  const buf = readFileSync(path);
  if (
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error(`${path} is not a RIFF/WAVE file`);
  }
  // Skim through chunks looking for fmt + data. Tiny implementation —
  // good enough for the WAVs our recorder writes.
  let offset = 12;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataSize = 0;
  while (offset < buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "fmt ") {
      sampleRate = buf.readUInt32LE(offset + 8 + 4);
      bitsPerSample = buf.readUInt16LE(offset + 8 + 14);
    } else if (chunkId === "data") {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
  }
  if (bitsPerSample !== 16) {
    throw new Error(`Expected 16-bit PCM, got ${bitsPerSample}`);
  }
  const samples = new Int16Array(
    buf.buffer,
    buf.byteOffset + dataOffset,
    Math.floor(dataSize / 2),
  );
  return { samples, sampleRate };
}

async function run(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  const { samples, sampleRate } = readWav16(WAV_PATH);
  console.log(
    `Loaded ${samples.length} samples @ ${sampleRate} Hz from ${WAV_PATH}`,
  );
  if (sampleRate !== 24_000) {
    console.warn(
      `WARNING: expected 24kHz, got ${sampleRate} — Realtime will misread.`,
    );
  }

  const client = new OpenAI({ apiKey });
  const rt = new OpenAIRealtimeWebSocket({ model: "gpt-realtime-2" }, client);

  let userTranscript = "";
  let agentTranscript = "";

  rt.on("session.created", () => {
    console.log("[session.created]");
    rt.send({
      type: "session.update",
      session: {
        type: "realtime",
        instructions:
          "You are a USER speaking to a support agent. Respond naturally to whatever the assistant says.",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24_000 },
            transcription: { model: "whisper-1" },
            noise_reduction: { type: "near_field" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 700,
              create_response: true,
            },
          },
          output: {
            format: { type: "audio/pcm", rate: 24_000 },
            voice: "alloy",
          },
        },
      },
    });
  });

  rt.on("event", (event) => {
    if (
      event.type !== "response.output_audio.delta" &&
      event.type !== "response.output_audio_transcript.delta"
    ) {
      console.log("[event]", event.type);
    }
  });

  rt.on("response.output_audio_transcript.delta", (event) => {
    if (typeof event.delta === "string") agentTranscript += event.delta;
  });

  rt.on("response.output_audio_transcript.done", () => {
    console.log("[agent transcript]", agentTranscript);
    agentTranscript = "";
  });

  rt.on("conversation.item.input_audio_transcription.completed", (event) => {
    const t = (event.transcript ?? "").trim();
    userTranscript = t;
    console.log("[user transcript]", t);
  });

  rt.on("input_audio_buffer.speech_started", () => {
    console.log("[speech_started]");
  });

  rt.on("input_audio_buffer.speech_stopped", () => {
    console.log("[speech_stopped]");
  });

  rt.on("response.done", () => {
    console.log("[response.done]");
  });

  rt.on("error", (err) => {
    console.error("[error]", err.error ?? err.message);
  });

  // Wait for session ready
  await new Promise<void>((resolve) => {
    rt.on("session.updated", () => {
      console.log("[session.updated]");
      resolve();
    });
  });

  // Stream the WAV in chunks at real time pace.
  console.log("Streaming WAV...");
  for (let i = 0; i < samples.length; i += CHUNK_SAMPLES) {
    const slice = samples.subarray(
      i,
      Math.min(i + CHUNK_SAMPLES, samples.length),
    );
    const b64 = Buffer.from(
      slice.buffer,
      slice.byteOffset,
      slice.byteLength,
    ).toString("base64");
    rt.send({ type: "input_audio_buffer.append", audio: b64 });
    await new Promise((r) => setTimeout(r, CHUNK_INTERVAL_MS));
  }

  console.log("WAV streamed. Waiting 10s for events to flush...");
  await new Promise((r) => setTimeout(r, 10_000));

  console.log("Final state:");
  console.log("  user transcript:", userTranscript || "(none)");
  console.log("  agent transcript:", agentTranscript || "(none)");

  rt.close();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
