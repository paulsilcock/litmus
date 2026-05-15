/**
 * Records the ElevenLabs voice agent's greeting and saves it to a WAV.
 *
 * Proves the round-trip: our `audio: true` driver hooks coexist with the
 * convai widget, and our `AudioContext.destination` tap captures the
 * agent's voice rendered via Web Audio.
 *
 * Output: `out/agent-greeting.wav`
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BaseBrowserDriver } from "@litmus/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "out");
mkdirSync(OUT, { recursive: true });

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
    await this.page.waitForTimeout(3000);
    await this.page.screenshot({ path: join(OUT, "debug-after-load.png") });
    const askButton = this.page.getByText("Ask anything").first();
    await askButton.waitFor({ state: "visible", timeout: 30_000 });
    await askButton.click();
    const accept = this.page.getByRole("button", { name: /accept/i }).first();
    await accept.waitFor({ state: "visible", timeout: 15_000 });
    await accept.click();
  }

  async startVoiceCall(): Promise<void> {
    await this.page
      .locator('button:has(slot[name="icon-phone"])')
      .first()
      .click();
  }

  async captureSeconds(
    seconds: number,
  ): Promise<{ samples: number[]; sampleRate: number }> {
    return this.captureAudio(seconds * 1000);
  }
}

function encodeWav(samples: number[], sampleRate: number): Buffer {
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
  for (const s of samples) {
    const clamped = Math.max(-1, Math.min(1, s));
    buf.writeInt16LE(Math.round(clamped * 32767), offset);
    offset += 2;
  }
  return buf;
}

async function run(): Promise<void> {
  const driver = new WidgetDriver({
    baseUrl: "https://elevenlabs.io",
    headless: true,
    // Full Chromium → new-headless → GPU rasterization → low CPU.
    channel: "chromium",
    audio: true,
    // Spoof a real Chrome UA so the docs page embeds the widget. New-headless
    // Chromium otherwise advertises itself in Sec-CH-UA / navigator.userAgentData
    // as Chromium-not-Chrome, and the page silently skips widget embedding.
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/131.0.0.0 Safari/537.36",
    launchArgs: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });

  await driver.init();
  await driver.grantMicrophone();

  console.log("Opening widget...");
  await driver.openChat();
  console.log("  chat opened");

  console.log("Starting voice call...");
  await driver.startVoiceCall();
  console.log("  phone clicked");

  // Give the WS time to handshake and the agent's greeting to start.
  console.log("Waiting 4s for agent to start speaking...");
  await new Promise((r) => setTimeout(r, 4000));

  const captureSeconds = 5;
  console.log(`Capturing ${captureSeconds}s of agent audio...`);
  const t0 = Date.now();
  const { samples, sampleRate } = await driver.captureSeconds(captureSeconds);
  console.log(
    `  collected ${samples.length} samples @ ${sampleRate} Hz in ${Date.now() - t0}ms`,
  );

  // Sanity: is anything non-silent in there?
  let rms = 0;
  for (const s of samples) rms += s * s;
  rms = Math.sqrt(rms / samples.length);
  const peak = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
  console.log(`  RMS=${rms.toFixed(4)} peak=${peak.toFixed(4)}`);

  const wav = encodeWav(samples, sampleRate);
  const outPath = join(OUT, "agent-greeting.wav");
  writeFileSync(outPath, wav);
  console.log(`Wrote ${outPath} (${wav.length} bytes)`);

  await driver.cleanup();
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
