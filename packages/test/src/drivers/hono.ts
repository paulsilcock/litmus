import type { Hono } from "hono";
import { hc } from "hono/client";

import { BaseDriver } from "#litmus-test/drivers/base.ts";

interface HonoDriverOptions {
  baseUrl: string;
}

/**
 * Base driver for acceptance tests that interact with a Hono app.
 * Subclasses get a typed Hono RPC client via `this.client`, with
 * autocomplete on routes and typed request/response bodies.
 *
 * For non-Hono APIs use {@link BaseHttpDriver} which exposes raw
 * HTTP methods.
 *
 * @typeParam T - The Hono app type. Pass `typeof app` so the
 *   client knows the route schema.
 * @param options.baseUrl - Root URL the client sends requests to.
 *
 * @example
 * ```typescript
 * import type app from "./app";
 *
 * class OrderDriver extends BaseHonoDriver<typeof app> {
 *   async placeOrder(input: { customerId: string }) {
 *     const res = await this.client.orders.$post({ json: input });
 *     return res.json();
 *   }
 *   async cleanup() {}
 * }
 * ```
 */
export abstract class BaseHonoDriver<T extends Hono> extends BaseDriver {
  protected client: ReturnType<typeof hc<T>>;

  constructor(options: HonoDriverOptions) {
    super();
    this.client = hc<T>(options.baseUrl);
  }

  /**
   * Rebind the RPC client to a new base URL. Useful when the server's
   * address is only known after `init()` — e.g. when binding to port 0.
   */
  protected setBaseUrl(baseUrl: string): void {
    this.client = hc<T>(baseUrl);
  }
}
