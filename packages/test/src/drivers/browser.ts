import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "playwright";

import { BaseDriver } from "#litmus-test/drivers/base.ts";
import { installAudioPump } from "#litmus-test/drivers/browser-audio.ts";

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
      }
    | undefined;
}

interface BrowserDriverOptions {
  baseUrl: string;
  headless?: boolean;
  audio?: boolean;
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
    this.#browser = await chromium.launch({
      headless: this.#options.headless ?? true,
      args: this.#options.audio
        ? ["--autoplay-policy=no-user-gesture-required"]
        : undefined,
    });
    this.#context = await this.#browser.newContext({
      baseURL: this.#options.baseUrl,
    });
    if (this.#options.audio) {
      await this.#context.addInitScript(installAudioPump);
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
