import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "playwright";

import { BaseDriver } from "#litmus-test/drivers/base.ts";

interface BrowserDriverOptions {
  baseUrl: string;
  headless?: boolean;
}

/**
 * Base driver for acceptance tests that interact with a web app
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
 * class OrderDriver extends BaseBrowserDriver {
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
    });
    this.#context = await this.#browser.newContext({
      baseURL: this.#options.baseUrl,
    });
    this.#page = await this.#context.newPage();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.#browser?.close();
  }
}
