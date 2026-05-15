/**
 * Page-level driver for the ElevenLabs docs voice widget.
 *
 * Exposes the protocol-level actions the DSL needs (open chat, start
 * voice, stream/capture audio) and *only those*. Business vocabulary
 * (`customerSpeaksToAgent` etc.) lives in the DSL above.
 */

import { BaseBrowserDriver } from "@litmus/test";

const ELEVENLABS_BASE_URL = "https://elevenlabs.io";

// Spoofing a real Chrome UA is the difference between the docs page
// embedding the convai widget vs silently skipping it under new-headless
// Chromium. See examples/voice-agent-elevenlabs/out/findings.md.
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/131.0.0.0 Safari/537.36";

export interface ElevenLabsDocsDriverOptions {
  /** Run with a visible window. Defaults to `true` (headless). */
  headless?: boolean;
}

export class ElevenLabsDocsDriver extends BaseBrowserDriver {
  constructor(options: ElevenLabsDocsDriverOptions = {}) {
    super({
      baseUrl: ELEVENLABS_BASE_URL,
      headless: options.headless ?? true,
      channel: "chromium",
      audio: true,
      userAgent: CHROME_UA,
      launchArgs: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    });
  }

  override async init(): Promise<void> {
    await super.init();
    await this.context.grantPermissions(["microphone"], {
      origin: ELEVENLABS_BASE_URL,
    });
  }

  /** Open the docs page, click "Ask anything", and accept the T&C. */
  async openChat(): Promise<void> {
    await this.page.goto("/docs/overview/intro", {
      waitUntil: "domcontentloaded",
    });
    const askButton = this.page.getByText("Ask anything").first();
    await askButton.waitFor({ state: "visible", timeout: 30_000 });
    await askButton.click();
    const accept = this.page.getByRole("button", { name: /accept/i }).first();
    await accept.waitFor({ state: "visible", timeout: 15_000 });
    await accept.click();
  }

  /**
   * Click the phone-icon button inside the chat panel. Returns once the
   * click has been issued; the WebSocket handshake and agent greeting
   * happen asynchronously after.
   *
   * Locator note: the button has `aria-label="Ask anything"` (same as
   * the entry pill) so we disambiguate via the `<slot name="icon-phone">`.
   */
  async startVoiceCall(): Promise<void> {
    const phoneButton = this.page
      .locator('button:has(slot[name="icon-phone"])')
      .first();
    await phoneButton.waitFor({ state: "visible", timeout: 10_000 });
    await phoneButton.click();
  }

  /**
   * Public wrappers around the base driver's `protected` audio methods.
   * The DSL composes us by reference, and `protected` access doesn't
   * carry through composition — so we re-expose the surface here under
   * names that read naturally from the DSL.
   */
  startCapture(opts: { pollMs?: number } = {}): AudioStreamHandle {
    return this.captureAudioStream(opts);
  }

  async pushUserAudio(samples: number[], sampleRate: number): Promise<void> {
    await this.sendAudio(samples, sampleRate);
  }
}

export interface AudioStreamHandle {
  chunks: AsyncIterable<{ samples: number[]; sampleRate: number }>;
  stop: () => Promise<{ samples: number[]; sampleRate: number }>;
}
