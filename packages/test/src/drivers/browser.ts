import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "playwright";

import { Driver } from "#litmus-test/drivers/base.ts";
import { installAudioPump } from "#litmus-test/drivers/browser-audio.ts";
import { spoofUserAgentData } from "#litmus-test/drivers/browser-ua.ts";

/**
 * A realistic current Chrome UA string used by default when no
 * `userAgent` option is provided. Spoofing this prevents headless
 * Chromium's `HeadlessChrome/...` UA from being sniffed by sites that
 * refuse to render their Chrome-only paths for headless agents.
 *
 * Pass `userAgent: null` to opt out and use Playwright's raw default.
 */
export const DEFAULT_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/136.0.0.0 Safari/537.36";

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
  /**
   * User-agent string to use for the browser context.
   *
   * - `undefined` (omitted) — use the default spoofed Chrome UA
   *   (`DEFAULT_CHROME_UA`). Prevents sites from detecting headless
   *   Chromium via the `HeadlessChrome/...` UA string.
   * - `null` — opt out of UA spoofing; Playwright's raw default is used.
   * - `string` — use the given UA string exactly.
   */
  userAgent?: string | null;
  /**
   * Sample rate for the capture AudioContext in Hz.
   * Defaults to the browser's default (typically 48000). Set to match
   * the rate expected by downstream consumers (e.g. 24000 for systems
   * that process 24kHz audio). WebAudio's polyphase resampler handles
   * the conversion in-page.
   */
  captureSampleRate?: number;
  /**
   * Which audio sources to intercept. Defaults to all three.
   * Exclude `"web-audio"` when the page routes the mic through an
   * AudioContext (e.g. for level meters) to prevent a feedback loop.
   */
  captureSources?: ReadonlyArray<"webrtc" | "web-audio" | "media-element">;
}

/**
 * Driver for acceptance tests that interact with a web app
 * through a real browser via Playwright. Each driver instance gets
 * its own browser context with isolated cookies and storage —
 * safe for concurrent test runs.
 *
 * Subclasses use `this.page` for navigation and queries. Construct
 * synchronously, then call `await driver.init()` to launch the
 * browser before use. Scope the driver's lifetime with `await using`
 * so the browser is released when the block exits.
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
 * class OrderDriver extends BrowserDriver {
 *   async placeOrder(customerId: string) {
 *     await this.page.goto("/orders/new");
 *     await this.page.getByLabel("Customer").fill(customerId);
 *     await this.page.getByRole("button", { name: "Place order" }).click();
 *   }
 * }
 *
 * await using driver = new OrderDriver({ baseUrl: "http://localhost:3000" });
 * await driver.init();
 * await driver.placeOrder("cust_1");
 * // driver disposed when the block exits — browser closed automatically
 * ```
 */
export abstract class BrowserDriver extends Driver {
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
      throw new Error("BrowserDriver: call init() before using page");
    }
    return this.#page;
  }

  protected get context(): BrowserContext {
    if (!this.#context) {
      throw new Error("BrowserDriver: call init() before using context");
    }
    return this.#context;
  }

  async init(): Promise<void> {
    this.#browser = await chromium.launch({
      headless: this.#options.headless ?? true,
      args: this.#options.audio
        ? [
            "--autoplay-policy=no-user-gesture-required",
            // Skip the mic permission prompt — without it, the
            // first call to getUserMedia hangs waiting for user
            // approval that never comes in a headless context.
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            // Prevent new-headless Chromium from throttling timers and
            // audio scheduling in background tabs (delays WebRTC ICE
            // setup by multiple seconds, losing the first utterances).
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-features=AudioServiceOutOfProcess",
          ]
        : undefined,
    });
    // Resolve the effective UA:
    //   undefined → apply DEFAULT_CHROME_UA (hide headless fingerprint)
    //   null      → let Playwright use its own default (opt-out)
    //   string    → use exactly what the consumer provided
    const effectiveUserAgent =
      this.#options.userAgent === undefined
        ? DEFAULT_CHROME_UA
        : (this.#options.userAgent ?? undefined);
    this.#context = await this.#browser.newContext({
      baseURL: this.#options.baseUrl,
      userAgent: effectiveUserAgent,
    });
    if (effectiveUserAgent !== undefined) {
      // Playwright's `userAgent` only sets the UA string + HTTP
      // header. Mirror it onto `navigator.userAgentData` so sites
      // that read Client Hints see the same identity.
      await this.#context.addInitScript(spoofUserAgentData, {
        userAgent: effectiveUserAgent,
      });
    }
    if (this.#options.audio) {
      const audioOpts: {
        captureSampleRate?: number;
        captureSources?: string[];
      } = {};
      if (this.#options.captureSampleRate !== undefined) {
        audioOpts.captureSampleRate = this.#options.captureSampleRate;
      }
      if (this.#options.captureSources !== undefined) {
        audioOpts.captureSources = [...this.#options.captureSources];
      }
      await this.#context.addInitScript(
        installAudioPump,
        Object.keys(audioOpts).length > 0 ? audioOpts : undefined,
      );
    }
    this.#page = await this.#context.newPage();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.#browser?.close();
  }

  protected async sendAudio(
    samples: number[],
    sampleRate: number,
  ): Promise<void> {
    if (!this.#options.audio) {
      throw new Error(
        "BrowserDriver: sendAudio requires `audio: true` in constructor options",
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
