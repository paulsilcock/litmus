import { type AudioStream, BaseBrowserDriver } from "@litmus/test";

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/131.0.0.0 Safari/537.36";

interface ElevenLabsDocsDriverOptions {
  headless?: boolean;
}

/**
 * Drives the ElevenLabs documentation site, where the El voice
 * support agent is embedded via the convai widget. Opens the docs
 * page, accepts the chat dialog, and starts a live voice call. After
 * `openVoiceCall()` returns, the page's mic is connected to whatever
 * we push via `sendAudio`, and `captureAudioStream` drains El's
 * spoken responses.
 */
export class ElevenLabsDocsDriver extends BaseBrowserDriver {
  constructor(options: ElevenLabsDocsDriverOptions = {}) {
    super({
      baseUrl: "https://elevenlabs.io",
      audio: true,
      userAgent: CHROME_UA,
      headless: options.headless ?? true,
    });
  }

  async openVoiceCall(): Promise<void> {
    await this.page.goto("/docs/overview/intro", {
      waitUntil: "domcontentloaded",
    });
    const ask = this.page.getByText("Ask anything").first();
    await ask.waitFor({ state: "visible", timeout: 30_000 });
    await ask.click();

    const accept = this.page.getByRole("button", { name: /accept/i }).first();
    await accept.waitFor({ state: "visible", timeout: 15_000 });
    await accept.click();

    const phone = this.page
      .locator('button:has(slot[name="icon-phone"])')
      .first();
    await phone.waitFor({ state: "visible", timeout: 10_000 });
    await phone.click();
  }

  async sendUserAudio(samples: number[], sampleRate: number): Promise<void> {
    await this.sendAudio(samples, sampleRate);
  }

  async openAgentAudioStream(): Promise<AudioStream> {
    return this.captureAudioStream();
  }
}
