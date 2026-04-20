import type { Cli, CliClient } from "@litmus/cli";
import { cliClient } from "@litmus/cli";

import { BaseDriver } from "#litmus-test/drivers/base.ts";

interface LitmusCliDriverOptions {
  socket: string;
}

type InferCommands<T> = T extends Cli<any, infer C> ? C : never;

/**
 * Base driver for acceptance tests that interact with a Litmus CLI
 * over its unix socket transport. Subclasses get a typed `cliClient`
 * via `this.client`, with autocomplete on command names and typed
 * inputs and outputs.
 *
 * The CLI must be running with `serveCli(cli, { socket })` for the
 * driver to connect.
 *
 * @typeParam T - The Cli type. Pass `typeof cli` so the client knows
 *   the command schema.
 * @param options.socket - Path to the unix socket the CLI is serving on.
 *
 * @example
 * ```typescript
 * import type cli from "./cli";
 *
 * class OrderDriver extends BaseLitmusCliDriver<typeof cli> {
 *   async placeOrder(input: { customerId: string }) {
 *     return this.client.exec("orders:create", input);
 *   }
 *   async cleanup() {}
 * }
 * ```
 */
export abstract class BaseLitmusCliDriver<
  T extends Cli<any, any>,
> extends BaseDriver {
  protected readonly client: CliClient<InferCommands<T>>;

  constructor(options: LitmusCliDriverOptions) {
    super();
    this.client = cliClient<T>(options.socket);
  }
}
