/**
 * Bypass Web Audio entirely: use Chromium's
 * `--use-file-for-fake-audio-capture` to inject our pre-recorded WAV
 * directly at the mic device level. If El understands this audio, the
 * device-flag approach works against the convai widget and we should
 * refactor sendAudio to use it (FIFO-based for streaming).
 *
 * The WAV file is fed continuously (loops) — for a one-shot
 * verification that's fine, we just want to see ANY transcribed
 * response from El.
 */

import "dotenv/config";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "out");
const WAV_PATH = join(OUT, "agent-greeting-24k.wav");

async function run(): Promise<void> {
  // Bypass our driver entirely for this experiment — use raw Playwright
  // so we know exactly which flags are in effect.
  const browser = await chromium.launch({
    headless: true,
    channel: "chromium",
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${WAV_PATH}`,
    ],
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/131.0.0.0 Safari/537.36",
  });
  await context.grantPermissions(["microphone"], {
    origin: "https://elevenlabs.io",
  });
  const page = await context.newPage();

  console.log("Opening docs page...");
  await page.goto("https://elevenlabs.io/docs/overview/intro", {
    waitUntil: "domcontentloaded",
  });

  const ask = page.getByText("Ask anything").first();
  await ask.waitFor({ state: "visible", timeout: 30_000 });
  await ask.click();
  const accept = page.getByRole("button", { name: /accept/i }).first();
  await accept.waitFor({ state: "visible", timeout: 15_000 });
  await accept.click();

  const phone = page.locator('button:has(slot[name="icon-phone"])').first();
  await phone.waitFor({ state: "visible", timeout: 10_000 });
  await phone.click();

  console.log("Voice call started. Waiting 15s for El to respond...");
  await new Promise((r) => setTimeout(r, 15_000));

  await page.screenshot({ path: join(OUT, "fake-device-result.png") });
  console.log("Screenshot saved to out/fake-device-result.png");

  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
