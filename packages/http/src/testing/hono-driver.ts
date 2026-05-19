import { Driver } from "@litmus/test";
import type { Hono } from "hono";
import { hc } from "hono/client";

interface HonoDriverOptions {
  baseUrl: string;
}

/**
 * Driver for acceptance tests that interact with a Hono app.
 * Subclasses get a typed Hono RPC client via `this.client`, with
 * autocomplete on routes and typed request/response bodies.
 *
 * For non-Hono APIs use {@link HttpDriver} which exposes raw
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
 * class OrderDriver extends HonoDriver<typeof app> {
 *   async placeOrder(input: { customerId: string }) {
 *     const res = await this.client.orders.$post({ json: input });
 *     return res.json();
 *   }
 * }
 * ```
 */
export abstract class HonoDriver<T extends Hono> extends Driver {
  protected readonly client: ReturnType<typeof hc<T>>;

  constructor(options: HonoDriverOptions) {
    super();
    this.client = hc<T>(options.baseUrl);
  }
}
