import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "playwright";

import { BaseDriver } from "#litmus-test/drivers/base.ts";
import { installAudioPump } from "#litmus-test/drivers/browser-audio.ts";
import { spoofUserAgentData } from "#litmus-test/drivers/browser-ua.ts";

declare global {
  // Installed inside the browser by `installAudioPump` when `audio: true`.
  // Only valid inside `page.evaluate` callbacks.
  // oxlint-disable-next-line no-var
  var __litmusAudio:
    | {
        send(samples: number[], sampleRate: number): Promise<void>;
        capture(
          durationMs: number,
        ): Promise<{ samples: number[]; sampleRate: number }>;
        startStream(): { id: number; sampleRate: number };
        readStream(id: number): { samples: number[]; sampleRate: number };
        stopStream(id: number): void;
      }
    | undefined;
}

/**
 * Open stream of captured audio. Each `read()` returns samples that
 * have flowed through the page's audio outputs since the previous
 * read (or since the stream was opened). Call `close()` to detach.
 */
export interface AudioStream {
  read(): Promise<{ samples: number[]; sampleRate: number }>;
  close(): Promise<void>;
}

interface BrowserDriverOptions {
  baseUrl: string;
  headless?: boolean;
  audio?: boolean;
  userAgent?: string;
}

/**
 * Base driver for acceptance tests that interact with a web app
 * through a real browser via Playwright. Each driver instance gets
 * its own browser context with isolated cookies and storage —
 * safe for concurrent test runs.
 *
 * Subclasses use `this.page` for navigation and queries. Construct
 * synchronously, then call `await driver.init()` to launch the
 * browser before use, and `await driver.cleanup()` to release it.
 *
 * **Prefer semantic locators** like `page.getByRole("button", { name: "Submit" })`
 * over CSS or XPath selectors. They're resilient to markup changes,
 * mirror how users find elements, and surface accessibility issues.
 * Avoid IDs and class names tied to styling.
 *
 * **Setup:** Playwright is a peer dependency. Install it and the
 * Chromium binary before running browser tests:
 *
 * ```
 * vp install
 * vp dlx playwright install --with-deps chromium
 * ```
 *
 * @param options.baseUrl - Root URL navigations are resolved against.
 *   Allows `this.page.goto("/orders")` instead of full URLs.
 * @param options.headless - Run the browser headlessly. Defaults to
 *   `true`. Set to `false` for debugging.
 *
 * @example
 * ```typescript
 * class OrderDriver extends BaseBrowserDriver {
 *   async placeOrder(customerId: string) {
 *     await this.page.goto("/orders/new");
 *     await this.page.getByLabel("Customer").fill(customerId);
 *     await this.page.getByRole("button", { name: "Place order" }).click();
 *   }
 * }
 *
 * const driver = new OrderDriver({ baseUrl: "http://localhost:3000" });
 * await driver.init();
 * await driver.placeOrder("cust_1");
 * await driver.cleanup();
 * ```
 */
export abstract class BaseBrowserDriver extends BaseDriver {
  readonly #options: BrowserDriverOptions;
  #browser?: Browser;
  #context?: BrowserContext;
  #page?: Page;

  constructor(options: BrowserDriverOptions) {
    super();
    this.#options = options;
  }

  protected get page(): Page {
    if (!this.#page) {
      throw new Error("BaseBrowserDriver: call init() before using page");
    }
    return this.#page;
  }

  protected get context(): BrowserContext {
    if (!this.#context) {
      throw new Error("BaseBrowserDriver: call init() before using context");
    }
    return this.#context;
  }

  async init(): Promise<void> {
    // Use Chromium's new headless mode (real Chromium binary, GPU
    // rasterization) rather than Playwright's default
    // `chrome-headless-shell` (legacy headless, software rendering).
    // New-headless handles audio/video work without the CPU spikes
    // that the legacy shell hits when pages do heavy rendering.
    this.#browser = await chromium.launch({
      headless: this.#options.headless ?? true,
      channel: "chromium",
      args: this.#options.audio
        ? [
            "--autoplay-policy=no-user-gesture-required",
            // Skip the mic permission prompt — without it, the
            // first call to getUserMedia hangs waiting for user
            // approval that never comes in a headless context.
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ]
        : undefined,
    });
    this.#context = await this.#browser.newContext({
      baseURL: this.#options.baseUrl,
      userAgent: this.#options.userAgent,
    });
    if (this.#options.userAgent) {
      // Playwright's `userAgent` only sets the UA string + HTTP
      // header. Mirror it onto `navigator.userAgentData` so sites
      // that read Client Hints see the same identity.
      const userAgent = this.#options.userAgent;
      await this.#context.addInitScript(spoofUserAgentData, { userAgent });
    }
    if (this.#options.audio) {
      await this.#context.addInitScript(installAudioPump);
    }
    this.#page = await this.#context.newPage();
  }

  async cleanup(): Promise<void> {
    await this.#browser?.close();
  }

  protected async sendAudio(
    samples: number[],
    sampleRate: number,
  ): Promise<void> {
    if (!this.#options.audio) {
      throw new Error(
        "BaseBrowserDriver: sendAudio requires `audio: true` in constructor options",
      );
    }
    await this.page.evaluate(
      ({ samples, sampleRate }) => {
        const audio = globalThis.__litmusAudio;
        if (audio === undefined) {
          throw new Error("__litmusAudio not initialised in page");
        }
        return audio.send(samples, sampleRate);
      },
      { samples, sampleRate },
    );
  }

  protected async captureAudio(
    durationMs: number,
  ): Promise<{ samples: number[]; sampleRate: number }> {
    if (!this.#options.audio) {
      throw new Error(
        "BaseBrowserDriver: captureAudio requires `audio: true` in constructor options",
      );
    }
    return this.page.evaluate((d) => {
      const audio = globalThis.__litmusAudio;
      if (audio === undefined) {
        throw new Error("__litmusAudio not initialised in page");
      }
      return audio.capture(d);
    }, durationMs);
  }

  protected async captureAudioStream(): Promise<AudioStream> {
    if (!this.#options.audio) {
      throw new Error(
        "BaseBrowserDriver: captureAudioStream requires `audio: true` in constructor options",
      );
    }
    const { id } = await this.page.evaluate(() => {
      const audio = globalThis.__litmusAudio;
      if (audio === undefined) {
        throw new Error("__litmusAudio not initialised in page");
      }
      return audio.startStream();
    });
    const page = this.page;
    return {
      async read() {
        return page.evaluate((streamId) => {
          const audio = globalThis.__litmusAudio;
          if (audio === undefined) {
            throw new Error("__litmusAudio not initialised in page");
          }
          return audio.readStream(streamId);
        }, id);
      },
      async close() {
        await page.evaluate((streamId) => {
          const audio = globalThis.__litmusAudio;
          if (audio === undefined) return;
          audio.stopStream(streamId);
        }, id);
      },
    };
  }
}
