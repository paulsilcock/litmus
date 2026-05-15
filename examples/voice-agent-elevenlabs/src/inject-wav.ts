/**
 * A/B test for the simulator→page audio path. We open the live
 * ElevenLabs widget, start a voice call, wait for El's greeting to
 * end, then inject the *known-clean* `agent-greeting-24k.wav` into the
 * page mic. After 15s of conversation we screenshot the widget panel,
 * which shows El's last transcript in its UI.
 *
 * Outcomes:
 *  - El responds with a real reply ("Sure, let's clone..." etc.) →
 *    audio injection is fine, the eval issue is specific to Realtime's
 *    chunked output (and the precise-scheduling fix in sendAudio
 *    should now resolve it).
 *  - El says "I didn't catch that" / "are you still there" → injection
 *    is broken regardless of source. We need to look further into
 *    sendAudio or the getUserMedia path.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BaseBrowserDriver } from "@litmus/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "out");
const WAV_PATH = join(OUT, "agent-greeting-24k.wav");

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

  async pushSamples(samples: number[], sampleRate: number): Promise<void> {
    await this.sendAudio(samples, sampleRate);
  }

  async screenshot(filename: string): Promise<void> {
    await this.page.screenshot({
      path: join(OUT, filename),
      fullPage: false,
    });
  }

  async probe(): Promise<{ peak: number; rms: number; samples: number }> {
    return this.page.evaluate(
      "globalThis.__litmusMicProbe ? globalThis.__litmusMicProbe.snapshot() : { peak: 0, rms: 0, samples: 0 }",
    );
  }

  async probeReset(): Promise<void> {
    await this.page.evaluate("globalThis.__litmusMicProbe?.reset()");
  }

  attachConsoleLogger(): void {
    this.page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("[send debug]")) {
        console.log("PAGE:", text);
      }
    });
  }
}

function readWavSamplesAsFloat32(path: string): {
  samples: number[];
  sampleRate: number;
} {
  const buf = readFileSync(path);
  if (
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("not a wav");
  }
  let offset = 12;
  let sampleRate = 0;
  let dataOffset = 0;
  let dataSize = 0;
  while (offset < buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") sampleRate = buf.readUInt32LE(offset + 12);
    else if (id === "data") {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size;
  }
  const int16Count = Math.floor(dataSize / 2);
  const out = Array.from(
    { length: int16Count },
    (_, i) => buf.readInt16LE(dataOffset + i * 2) / 32768,
  );
  return { samples: out, sampleRate };
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
  driver.attachConsoleLogger();

  console.log("Opening chat + voice call...");
  await driver.openChat();
  await driver.startVoiceCall();

  console.log("Waiting 6s for El's greeting to finish...");
  await new Promise((r) => setTimeout(r, 6_000));

  console.log(`Loading and injecting ${WAV_PATH}...`);
  const { samples, sampleRate } = readWavSamplesAsFloat32(WAV_PATH);
  console.log(`  ${samples.length} samples @ ${sampleRate} Hz`);

  console.log("Probe BEFORE injection:", await driver.probe());
  await driver.probeReset();

  // One big buffer — no chunking, no fragmentation. If this doesn't
  // wake El up, injection itself is the issue.
  await driver.pushSamples(samples, sampleRate);
  console.log("  injection complete");

  console.log("Probe IMMEDIATELY after injection:", await driver.probe());

  console.log("Waiting 12s for El's response...");
  await new Promise((r) => setTimeout(r, 12_000));

  console.log("Probe FINAL (after wait):", await driver.probe());

  await driver.screenshot("inject-wav-result.png");
  console.log("Screenshot saved to out/inject-wav-result.png");

  await driver.cleanup();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
