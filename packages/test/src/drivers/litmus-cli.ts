import type { Cli, CliClient } from "@litmus/cli";
import { cliClient } from "@litmus/cli";

interface LitmusCliDriverOptions {
  socket: string;
}

type InferCommands<T> = T extends Cli<infer C> ? C : never;

export abstract class BaseLitmusCliDriver<T extends Cli<any>> {
  protected readonly client: CliClient<InferCommands<T>>;

  constructor(options: LitmusCliDriverOptions) {
    this.client = cliClient<T>(options.socket);
  }

  abstract cleanup(): Promise<void>;
}
