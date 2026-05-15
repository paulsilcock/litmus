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
        stopStream(id: number): { samples: number[]; sampleRate: number };
      }
    | undefined;
}

interface BrowserDriverOptions {
  baseUrl: string;
  headless?: boolean;
  audio?: boolean;
  /** Extra Chromium launch arguments. Merged with whatever the driver itself sets. */
  launchArgs?: string[];
  /**
   * Playwright `channel` for the underlying browser. Default `undefined`
   * uses `chrome-headless-shell` (the lightweight legacy build, software
   * rendering only). Set to `"chromium"` for the full Chromium build with
   * new-headless mode + GPU rasterization — important for pages with
   * non-trivial animations.
   */
  channel?: string;
  /**
   * Override the User-Agent string for navigation requests. Use when a
   * target site behaves differently for non-Chrome browsers — Chromium and
   * `chrome-headless-shell` both report themselves with different Sec-CH-UA
   * brand hints than real Chrome, which some pages reject for widget
   * embedding etc. Sets both `navigator.userAgent` and the `User-Agent`
   * header. Also fudges `navigator.userAgentData` to match.
   */
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
 * @param options.audio - Enable audio I/O support. When `true`,
 *   `navigator.mediaDevices.getUserMedia({ audio: true })` returns a
 *   synthetic `MediaStream` controlled by the driver, and `sendAudio`
 *   becomes available for pushing PCM into the page's mic. Video and
 *   other constraints fall through to the real `getUserMedia`.
 *   Defaults to `false`.
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
    const args: string[] = [];
    if (this.#options.audio) {
      args.push("--autoplay-policy=no-user-gesture-required");
    }
    if (this.#options.launchArgs) {
      args.push(...this.#options.launchArgs);
    }
    this.#browser = await chromium.launch({
      headless: this.#options.headless ?? true,
      channel: this.#options.channel,
      args: args.length > 0 ? args : undefined,
    });
    this.#context = await this.#browser.newContext({
      baseURL: this.#options.baseUrl,
      userAgent: this.#options.userAgent,
    });
    if (this.#options.audio) {
      await this.#context.addInitScript(installAudioPump);
    }
    if (this.#options.userAgent) {
      await this.#context.addInitScript(spoofUserAgentData, {
        userAgent: this.#options.userAgent,
      });
    }
    this.#page = await this.#context.newPage();
  }

  async cleanup(): Promise<void> {
    await this.#browser?.close();
  }

  /**
   * Capture audio the page plays for the given duration. Requires
   * the driver to have been constructed with `audio: true`. Returns
   * the PCM samples collected during the window plus the sample rate
   * at which they were captured.
   *
   * @param durationMs - How long to capture, in milliseconds.
   */
  protected async captureAudio(
    durationMs: number,
  ): Promise<{ samples: number[]; sampleRate: number }> {
    if (!this.#options.audio) {
      throw new Error(
        "BaseBrowserDriver: captureAudio requires `audio: true` in constructor options",
      );
    }
    return this.page.evaluate(
      ({ durationMs }) => {
        const audio = globalThis.__litmusAudio;
        if (audio === undefined) {
          throw new Error("__litmusAudio not initialised in page");
        }
        return audio.capture(durationMs);
      },
      { durationMs },
    );
  }

  /**
   * Open a streaming capture session. Returns an async iterable of
   * sample chunks plus a `stop()` method that drains and closes the
   * session. Each chunk is read at the configured `pollMs` interval —
   * smaller polls reduce end-to-end latency at the cost of more
   * `page.evaluate` round-trips.
   *
   * Use this when you need to forward page audio to an external system
   * in real time (e.g. a Realtime API session). For a fixed-window
   * recording, prefer `captureAudio(durationMs)`.
   *
   * Requires the driver to have been constructed with `audio: true`.
   *
   * @param options.pollMs - How often to drain the page-side buffer.
   *   Defaults to 100ms. Lower values reduce latency but increase
   *   overhead. Values below 25ms are unlikely to help — the
   *   underlying ScriptProcessor fires at ~85ms intervals at 48kHz.
   */
  protected captureAudioStream(options: { pollMs?: number } = {}): {
    chunks: AsyncIterable<{ samples: number[]; sampleRate: number }>;
    stop: () => Promise<{ samples: number[]; sampleRate: number }>;
  } {
    if (!this.#options.audio) {
      throw new Error(
        "BaseBrowserDriver: captureAudioStream requires `audio: true` in constructor options",
      );
    }
    const pollMs = options.pollMs ?? 100;
    const page = this.page;
    let stopped = false;
    let streamHandle: { id: number; sampleRate: number } | undefined;
    const buffered: { samples: number[]; sampleRate: number }[] = [];
    let waitingResolve: (() => void) | undefined;

    function notify(): void {
      if (waitingResolve) {
        const r = waitingResolve;
        waitingResolve = undefined;
        r();
      }
    }

    const pollLoop = (async () => {
      streamHandle = await page.evaluate(() => {
        const audio = globalThis.__litmusAudio;
        if (audio === undefined) {
          throw new Error("__litmusAudio not initialised in page");
        }
        return audio.startStream();
      });
      while (!stopped) {
        await new Promise<void>((r) => setTimeout(r, pollMs));
        if (stopped) break;
        const chunk = await page.evaluate(
          ({ id }) => {
            const audio = globalThis.__litmusAudio;
            if (audio === undefined) {
              throw new Error("__litmusAudio not initialised in page");
            }
            return audio.readStream(id);
          },
          { id: streamHandle.id },
        );
        if (chunk.samples.length > 0) {
          buffered.push(chunk);
          notify();
        }
      }
    })();

    const chunks: AsyncIterable<{ samples: number[]; sampleRate: number }> = {
      [Symbol.asyncIterator](): AsyncIterator<{
        samples: number[];
        sampleRate: number;
      }> {
        return {
          async next() {
            while (buffered.length === 0 && !stopped) {
              await new Promise<void>((r) => {
                waitingResolve = r;
              });
            }
            const value = buffered.shift();
            if (value === undefined) return { value: undefined, done: true };
            return { value, done: false };
          },
        };
      },
    };

    const stop = async (): Promise<{
      samples: number[];
      sampleRate: number;
    }> => {
      stopped = true;
      notify();
      await pollLoop;
      if (!streamHandle) {
        return { samples: [], sampleRate: 48000 };
      }
      return page.evaluate(
        ({ id }) => {
          const audio = globalThis.__litmusAudio;
          if (audio === undefined) {
            throw new Error("__litmusAudio not initialised in page");
          }
          return audio.stopStream(id);
        },
        { id: streamHandle.id },
      );
    };

    return { chunks, stop };
  }

  /**
   * Push a buffer of PCM samples into the page's microphone. Requires
   * the driver to have been constructed with `audio: true`. Resolves
   * once playback completes, so subclasses can chain further actions
   * (e.g. read a response from the page) without manual waits.
   *
   * @param samples - Mono PCM samples in the range `[-1, 1]`.
   * @param sampleRate - Sample rate of `samples`, in Hz (e.g. `48000`).
   */
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
}
