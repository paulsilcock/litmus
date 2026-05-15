/**
 * Captures El's greeting (same as record-greeting.ts) but ALSO writes a
 * second WAV at 24kHz that's been through our exact resampler +
 * float-to-PCM16 pipeline — the same path the Realtime bridge feeds.
 *
 * Listen to both:
 *   out/agent-greeting.wav         — 48kHz Float32, what the page produced
 *   out/agent-greeting-24k.wav     — 24kHz PCM16, what we'd send Realtime
 *
 * If the 24kHz version sounds wrecked, the resampler is the bug. If it
 * sounds clean but Realtime still can't transcribe it in the eval, the
 * issue is somewhere else (chunking, timing, format declaration).
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BaseBrowserDriver } from "@litmus/test";

import { float32ToPcm16, resampleFloat32 } from "./realtime-bridge.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "out");
mkdirSync(OUT, { recursive: true });

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/131.0.0.0 Safari/537.36";

class WidgetDriver extends BaseBrowserDriver {
  async grantMicrophone(): Promise<void> {
    await this.context.grantPermissions(["microphone"], {
      origin: "https://elevenlabs.io",
    });
  }

  async openChat(): Promise<void> {
    await this.page.goto("/docs/overview/intro", {
      waitUntil: "domcontentloaded",
    });
    const ask = this.page.getByText("Ask anything").first();
    await ask.waitFor({ state: "visible", timeout: 30_000 });
    await ask.click();
    const accept = this.page.getByRole("button", { name: /accept/i }).first();
    await accept.waitFor({ state: "visible", timeout: 15_000 });
    await accept.click();
  }

  async startVoiceCall(): Promise<void> {
    const phoneButton = this.page
      .locator('button:has(slot[name="icon-phone"])')
      .first();
    await phoneButton.waitFor({ state: "visible", timeout: 10_000 });
    await phoneButton.click();
  }

  async captureSeconds(
    seconds: number,
  ): Promise<{ samples: number[]; sampleRate: number }> {
    return this.captureAudio(seconds * 1000);
  }
}

function encodeWavInt16(samples: Int16Array, sampleRate: number): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(samples[i]!, offset);
    offset += 2;
  }
  return buf;
}

function encodeWavFloatAsInt16(samples: number[], sampleRate: number): Buffer {
  return encodeWavInt16(float32ToPcm16(samples), sampleRate);
}

async function run(): Promise<void> {
  const driver = new WidgetDriver({
    baseUrl: "https://elevenlabs.io",
    headless: true,
    channel: "chromium",
    audio: true,
    userAgent: CHROME_UA,
    launchArgs: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });

  await driver.init();
  await driver.grantMicrophone();

  console.log("Opening chat + voice call...");
  await driver.openChat();
  await driver.startVoiceCall();

  console.log("Waiting 4s for greeting to start...");
  await new Promise((r) => setTimeout(r, 4_000));

  console.log("Capturing 6s...");
  const { samples, sampleRate } = await driver.captureSeconds(6);
  console.log(`  ${samples.length} samples @ ${sampleRate} Hz`);

  // Original (48kHz Float32 → 16-bit PCM for WAV write).
  const original = encodeWavFloatAsInt16(samples, sampleRate);
  writeFileSync(join(OUT, "agent-greeting.wav"), original);

  // What we'd send Realtime: resample to 24kHz then float-to-PCM16.
  const resampled = resampleFloat32(samples, sampleRate, 24_000);
  const resampledArr = Array.from(resampled);
  const resampledWav = encodeWavFloatAsInt16(resampledArr, 24_000);
  writeFileSync(join(OUT, "agent-greeting-24k.wav"), resampledWav);

  console.log(`Wrote out/agent-greeting.wav and out/agent-greeting-24k.wav`);

  await driver.cleanup();
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
