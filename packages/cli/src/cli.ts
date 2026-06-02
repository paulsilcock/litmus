import { DomainError, type HandlerClass, isAsyncIterable } from "@litmus/core";
import { container } from "tsyringe";
import yargsParser from "yargs-parser";
import { ZodError, type ZodType } from "zod";

export interface CliEnv {
  Variables?: Record<string, unknown>;
}

type VariablesOf<TEnv extends CliEnv> = TEnv extends { Variables: infer V }
  ? V
  : Record<string, never>;

export interface CliContext<TEnv extends CliEnv = CliEnv> {
  get<K extends keyof VariablesOf<TEnv> & string>(key: K): VariablesOf<TEnv>[K];
  set<K extends keyof VariablesOf<TEnv> & string>(
    key: K,
    value: VariablesOf<TEnv>[K],
  ): void;
}

export type CliMiddleware<TEnv extends CliEnv = CliEnv> = (
  ctx: CliContext<TEnv>,
  next: () => Promise<void>,
) => Promise<void>;

interface CommandOptions<TEnv extends CliEnv, TSchema, TInput> {
  description?: string;
  input?: (validated: TSchema, ctx: CliContext<TEnv>) => TInput;
}

interface CommandEntry {
  Handler: HandlerClass<any, any>;
  schema: ZodType<any>;
  description?: string;
  input?: (validated: any, ctx: CliContext<any>) => any;
}

interface GroupEntry {
  subCli: Cli<any, any>;
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
  TEnv extends CliEnv = {},
  TCommands extends Record<string, CommandSchema<any, any>> = {},
> {
  readonly #entries: Map<string, Entry>;
  readonly #middlewares: CliMiddleware<TEnv>[];

  constructor(
    entries?: Map<string, Entry>,
    middlewares?: CliMiddleware<TEnv>[],
  ) {
    this.#entries = entries ?? new Map();
    this.#middlewares = middlewares ?? [];
  }

  /**
   * Register middleware that runs before the command handler. Middleware
   * receives a typed `CliContext` whose `Variables` type is supplied via
   * the `Cli<TEnv>` generic, mirroring Hono's `use`. Compose middleware
   * with `next()` — code before `next()` runs inbound, code after runs
   * outbound.
   *
   * @example
   * ```typescript
   * const cli = new Cli<{ Variables: { userId: string } }>()
   *   .use(async (ctx, next) => {
   *     ctx.set("userId", await resolveUser());
   *     await next();
   *   })
   *   .command("orders:create", PlaceOrder, PlaceOrderWireSchema, {
   *     input: (validated, ctx) => ({ ...validated, userId: ctx.get("userId") }),
   *   });
   * ```
   */
  use(middleware: CliMiddleware<TEnv>): Cli<TEnv, TCommands> {
    return new Cli(this.#entries, [...this.#middlewares, middleware]);
  }

  /**
   * Register a command or mount a command group.
   *
   * @param name - Command name (used in argv and `exec`). Groups prefix
   *   sub-command names with `name:` (e.g. `"orders"` → `"orders:create"`).
   * @param Handler - Use case class. Resolved via tsyringe.
   * @param schema - Zod schema for input validation from argv flags.
   * @param options.description - Shown in `--help` output.
   * @param options.input - Project the validated args and middleware context
   *   into the handler input. Use this to inject middleware-attached values
   *   (e.g. a principal) without including them in the wire schema.
   */
  command<
    TName extends string,
    TInput extends Record<string, unknown>,
    TResult,
  >(
    name: TName,
    Handler: HandlerClass<TInput, TResult>,
    schema: ZodType<TInput>,
    options?: CommandOptions<TEnv, TInput, TInput>,
  ): Cli<TEnv, TCommands & { [K in TName]: CommandSchema<TInput, TResult> }>;
  command<
    TName extends string,
    TInput extends Record<string, unknown>,
    TResult,
    TSchema extends Record<string, unknown>,
  >(
    name: TName,
    Handler: HandlerClass<TInput, TResult>,
    schema: ZodType<TSchema>,
    options: CommandOptions<TEnv, TSchema, TInput> & {
      input: (validated: TSchema, ctx: CliContext<TEnv>) => TInput;
    },
  ): Cli<TEnv, TCommands & { [K in TName]: CommandSchema<TSchema, TResult> }>;

  /** Mount a sub-CLI as a command group. */
  command<
    TName extends string,
    TSub extends Record<string, CommandSchema<any, any>>,
  >(
    name: TName,
    subCli: Cli<TEnv, TSub>,
  ): Cli<TEnv, TCommands & PrefixKeys<TName, TSub>>;

  // oxlint-disable no-unsafe-type-assertion -- overloaded method requires runtime casts
  command(...args: unknown[]) {
    const name = args[0] as string;
    const newEntries = new Map(this.#entries);

    if (args.length >= 3) {
      const Handler = args[1] as HandlerClass<any, any>;
      const schema = args[2] as ZodType<any>;
      const options = args[3] as
        | CommandOptions<TEnv, unknown, unknown>
        | undefined;
      newEntries.set(name, {
        Handler,
        schema,
        description: options?.description,
        input: options?.input,
      });
    } else {
      const subCli = args[1] as Cli<TEnv, any>;
      newEntries.set(name, { subCli });
    }
    // oxlint-enable no-unsafe-type-assertion

    return new Cli<TEnv, any>(newEntries, this.#middlewares);
  }

  async exec<TName extends keyof TCommands & string>(
    name: TName,
    input: TCommands[TName]["input"],
  ): Promise<TCommands[TName]["result"]> {
    // Try flat lookup first
    const flat = this.#entries.get(name);
    if (flat && !isGroup(flat)) {
      const validated = flat.schema.parse(input);
      return this.#runWithMiddleware(flat, validated);
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

  async #runWithMiddleware(entry: CommandEntry, validated: unknown) {
    const ctx = new CliContextImpl<TEnv>();
    let result: unknown;
    const invokeHandler = async () => {
      const handlerInput = entry.input
        ? entry.input(validated, ctx)
        : validated;
      const handler = container.resolve(entry.Handler);
      result = await handler.handle(handlerInput);
    };
    const chain = this.#middlewares.reduceRight<() => Promise<void>>(
      (next, middleware) => () => middleware(ctx, next),
      invokeHandler,
    );
    await chain();
    return result;
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
        for (const issue of e.issues) {
          const field = issue.path.join(".") || "(root)";
          stderr(`${field}: ${issue.message}\n`);
        }
        exit(2);
        return;
      }
      throw e;
    }

    try {
      const result = await this.#runWithMiddleware(entry, input);
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

class CliContextImpl<TEnv extends CliEnv> implements CliContext<TEnv> {
  readonly #variables = new Map<string, any>();

  get<K extends keyof VariablesOf<TEnv> & string>(
    key: K,
  ): VariablesOf<TEnv>[K] {
    return this.#variables.get(key);
  }

  set<K extends keyof VariablesOf<TEnv> & string>(
    key: K,
    value: VariablesOf<TEnv>[K],
  ): void {
    this.#variables.set(key, value);
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
