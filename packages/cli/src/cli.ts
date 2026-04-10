import { DomainError, type HandlerClass, isAsyncIterable } from "@litmus/core";
import { container } from "tsyringe";
import yargsParser from "yargs-parser";
import { ZodError, type ZodSchema } from "zod";

interface CommandOptions {
  description?: string;
}

interface CommandEntry {
  Handler: HandlerClass<any, any>;
  schema: ZodSchema<any>;
  description?: string;
}

interface GroupEntry {
  subCli: Cli<any>;
  description?: string;
}

type Entry = CommandEntry | GroupEntry;

function isGroup(entry: Entry): entry is GroupEntry {
  return "subCli" in entry;
}

export interface RunOptions {
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
  exit?: (code: number) => void;
}

type CommandSchema<TInput, TResult> = { input: TInput; result: TResult };

type PrefixKeys<
  TPrefix extends string,
  T extends Record<string, CommandSchema<any, any>>,
> = {
  [K in keyof T as K extends string ? `${TPrefix}:${K}` : never]: T[K];
};

/**
 * CLI entrypoint adapter with typed command registration and
 * grouped commands. Follows the same declarative pattern as
 * HTTP routes and system tools.
 *
 * Handler classes are resolved via tsyringe's container, so
 * constructor dependencies are injected automatically.
 *
 * @example
 * ```typescript
 * import { Cli } from "@litmus/cli";
 *
 * const orderCommands = new Cli()
 *   .command("create", PlaceOrder, PlaceOrderSchema)
 *   .command("get", GetOrder, GetOrderSchema);
 *
 * const cli = new Cli()
 *   .command("orders", orderCommands)
 *   .command("healthcheck", Healthcheck, HealthcheckSchema);
 *
 * // Typed programmatic execution
 * const order = await cli.exec("orders:create", { customerId: "cust_1" });
 *
 * // argv execution
 * await cli.run(process.argv.slice(2));
 * ```
 */
export class Cli<
  TCommands extends Record<string, CommandSchema<any, any>> = {},
> {
  readonly #entries: Map<string, Entry>;

  constructor(entries?: Map<string, Entry>) {
    this.#entries = entries ?? new Map();
  }

  /**
   * Register a command or mount a command group.
   *
   * @param name - Command name (used in argv and `exec`). Groups prefix
   *   sub-command names with `name:` (e.g. `"orders"` → `"orders:create"`).
   * @param Handler - Use case class. Resolved via tsyringe.
   * @param schema - Zod schema for input validation from argv flags.
   * @param options.description - Shown in `--help` output.
   */
  command<
    TName extends string,
    TInput extends Record<string, unknown>,
    TResult,
  >(
    name: TName,
    Handler: HandlerClass<TInput, TResult>,
    schema: ZodSchema<TInput>,
    options?: CommandOptions,
  ): Cli<TCommands & { [K in TName]: CommandSchema<TInput, TResult> }>;

  /** Mount a sub-CLI as a command group. */
  command<
    TName extends string,
    TSub extends Record<string, CommandSchema<any, any>>,
  >(name: TName, subCli: Cli<TSub>): Cli<TCommands & PrefixKeys<TName, TSub>>;

  // oxlint-disable no-unsafe-type-assertion -- overloaded method requires runtime casts
  command(...args: unknown[]) {
    const name = args[0] as string;
    const newEntries = new Map(this.#entries);

    if (args.length >= 3) {
      const Handler = args[1] as HandlerClass<any, any>;
      const schema = args[2] as ZodSchema<any>;
      const options = args[3] as CommandOptions | undefined;
      newEntries.set(name, {
        Handler,
        schema,
        description: options?.description,
      });
    } else {
      const subCli = args[1] as Cli<any>;
      newEntries.set(name, { subCli });
    }
    // oxlint-enable no-unsafe-type-assertion

    return new Cli(newEntries);
  }

  async exec<TName extends keyof TCommands & string>(
    name: TName,
    input: TCommands[TName]["input"],
  ): Promise<TCommands[TName]["result"]> {
    // Try flat lookup first
    const flat = this.#entries.get(name);
    if (flat && !isGroup(flat)) {
      const validated = flat.schema.parse(input);
      const handler = container.resolve(flat.Handler);
      return handler.handle(validated);
    }

    // Try group resolution
    const parts = name.split(":");
    const topName = parts[0]!;
    const entry = this.#entries.get(topName);
    if (entry && isGroup(entry)) {
      const subName = parts.slice(1).join(":");
      return entry.subCli.exec(subName, input);
    }

    throw new Error(`Unknown command: ${name}`);
  }

  async run(args: string[], options: RunOptions = {}): Promise<void> {
    const stdout = options.stdout ?? ((s: string) => process.stdout.write(s));
    const stderr = options.stderr ?? ((s: string) => process.stderr.write(s));
    const exit = options.exit ?? ((code: number) => process.exit(code));

    const parsed = yargsParser(args);

    if (parsed.help || parsed.h) {
      printHelp(this.#entries, stdout);
      exit(0);
      return;
    }

    const commandName = String(parsed._[0] ?? "");
    const entry = this.#entries.get(commandName);

    if (entry && isGroup(entry)) {
      await entry.subCli.run(args.slice(1), options);
      return;
    }

    if (!entry) {
      const available = [...this.#entries.keys()].join(", ") || "(none)";
      stderr(
        `Unknown command: ${commandName || "(none)"}\nAvailable commands: ${available}\n`,
      );
      exit(1);
      return;
    }

    const { _, ...flags } = parsed;
    void _;

    let input: unknown;
    try {
      input = entry.schema.parse(flags);
    } catch (e) {
      if (e instanceof ZodError) {
        for (const issue of e.errors) {
          const field = issue.path.join(".") || "(root)";
          stderr(`${field}: ${issue.message}\n`);
        }
        exit(2);
        return;
      }
      throw e;
    }

    const handler = container.resolve(entry.Handler);
    try {
      const result = await handler.handle(input);
      if (isAsyncIterable<unknown>(result)) {
        for await (const chunk of result) {
          stdout(`${JSON.stringify(chunk)}\n`);
        }
      } else {
        stdout(`${JSON.stringify(result)}\n`);
      }
    } catch (e) {
      if (e instanceof DomainError) {
        stderr(`${e.code}: ${e.message}\n`);
        exit(1);
        return;
      }
      throw e;
    }
    exit(0);
  }
}

function printHelp(entries: Map<string, Entry>, stdout: (s: string) => void) {
  const lines = ["Available commands:"];
  for (const [name, entry] of entries) {
    if (isGroup(entry)) {
      lines.push(`  ${name}`);
    } else {
      const desc = entry.description ?? "";
      lines.push(`  ${name.padEnd(20)} ${desc}`);
    }
  }
  stdout(`${lines.join("\n")}\n`);
}
