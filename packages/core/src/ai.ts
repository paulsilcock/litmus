import { container } from "tsyringe";
import type { ZodType } from "zod";

import { Traceable } from "#litmus/tracing.ts";
import type { HandlerClass } from "#litmus/use-case/handlers.ts";

/**
 * A bounded unit of AI reasoning with a typed input and output.
 *
 * AI tasks wrap any non-deterministic AI operation — text
 * generation, embeddings, reranking, classification, extraction.
 * This keeps non-deterministic behaviour isolated and provides a
 * clean test seam — mock the task in consumer tests, use a fake
 * model (e.g. Vercel's `MockLanguageModelV1`) in task-level tests.
 *
 * @example
 * ```typescript
 * import type { AiTask } from "@litmus/core/ai";
 * import { generateText, embed } from "ai";
 *
 * // Text generation
 * class TriageRequest extends AiTask<string, TriageResult> {
 *   async run(message: string): Promise<TriageResult> {
 *     const { output } = await generateText({ ... });
 *     return output;
 *   }
 * }
 *
 * // Embeddings
 * class EmbedDocument extends AiTask<string, number[]> {
 *   async run(text: string): Promise<number[]> {
 *     const { embedding } = await embed({ ... });
 *     return embedding;
 *   }
 * }
 * ```
 */
export abstract class AiTask<TInput, TOutput = void> extends Traceable {
  constructor() {
    super("run");
  }

  abstract run(input: TInput): Promise<TOutput> | AsyncIterable<TOutput>;
}

/**
 * An autonomous actor with a goal that interacts with the system
 * through use cases — the same way a user would via HTTP or CLI.
 *
 * Agents orchestrate AI tasks (for reasoning) and system tools
 * (for use case access). The agent decides what to do, in what
 * order, and when it's done.
 *
 * @example
 * ```typescript
 * import type { Agent } from "@litmus/core/ai";
 *
 * class DisputeAgent extends Agent<{ customerId: string }, string> {
 *   constructor(
 *     private triage: TriageRequest,       // AiTask
 *     private analyse: AnalyseDispute,     // AiTask
 *     private summarise: SummariseResult,  // AiTask
 *   ) { super(); }
 *
 *   async run(input: { customerId: string }): Promise<string> {
 *     const intent = await this.triage.run(input.message);
 *     const analysis = await this.analyse.run({ intent, ...data });
 *     return this.summarise.run({ analysis });
 *   }
 * }
 * ```
 */
export abstract class Agent<TInput, TOutput = void> extends Traceable {
  constructor() {
    super("run");
  }

  abstract run(input: TInput): Promise<TOutput> | AsyncIterable<TOutput>;
}

/**
 * A use case exposed as a tool that agents can invoke.
 * Registered via {@link Toolbox.tool} and converted to a
 * vendor-specific format (e.g. Vercel AI SDK) before being
 * passed to an LLM.
 */
export interface Tool<TInput = unknown> {
  description: string;
  schema: ZodType<TInput>;
  handler: {
    handle(input: TInput): Promise<unknown> | AsyncIterable<unknown>;
  };
}

/**
 * A single message in a prompt: role plus text. The common
 * denominator across AI frameworks, so contracts built on it don't
 * inherit any one framework's richer message type.
 */
export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Audio as raw samples at a given rate. */
export interface Audio {
  samples: number[];
  sampleRate: number;
}

/** A fully-resolved prompt: either flat text or role-tagged messages. */
export type Prompt = string | readonly Message[];

/**
 * Generates a typed output from a fully-resolved prompt, optionally
 * offering tools the model may invoke along the way. The caller owns
 * prompt assembly and decides which tools are available per call; a
 * `GenerationFunction` owns only how the output is produced — which
 * model, which framework, or none at all in tests.
 */
export type GenerationFunction<TOutput> = (
  prompt: Prompt,
  tools?: Record<string, Tool<any>>,
) => Promise<TOutput>;

/**
 * Something the simulated user does: speaks, hears, or finishes its turn —
 * saying whether that turn met its goal.
 */
export type SimulatedUserAction =
  | { type: "speak"; audio: Audio }
  | { type: "said"; text: string }
  | { type: "hearing" }
  | { type: "heard"; text: string }
  | { type: "unclear"; reason: string }
  | { type: "finishedTurn"; goalMet: boolean };

/** A voice model that can play a simulated user in a spoken conversation. */
export interface VoiceModel {
  /** The sample rate, in Hz, of the audio the model can listen to. */
  readonly inputSampleRate: number;
  /** Opens a conversation, with the model playing `persona`. */
  connect(who: { persona: string }): Promise<VoiceSession>;
}

/** An open conversation with the model, lasting until it's disposed. */
export interface VoiceSession extends AsyncDisposable {
  /**
   * What the simulated user does, for as long as the session is open.
   * Throws if the conversation fails.
   */
  actions(): AsyncIterable<SimulatedUserAction>;
  /** Passes on a chunk of what the system under test says. */
  listenTo(audio: Audio): void;
  /** Gives the simulated user a goal, and has it start working towards it. */
  pursue(goal: string): void;
}

/**
 * A scoped subset of tools picked from a {@link Toolbox}.
 *
 * Created by {@link Toolbox.pick} to explicitly scope which tools
 * an agent has access to. Pass to an SDK adapter (e.g.
 * `toVercelTools`) to convert to the vendor-specific format.
 */
export class ToolSelection {
  readonly #entries: Map<string, Tool>;

  constructor(entries: Map<string, Tool>) {
    this.#entries = entries;
  }

  entries(): ReadonlyMap<string, Tool> {
    return this.#entries;
  }
}

/**
 * A typed registry of system tools that wrap use cases, making
 * them accessible to agents. Follows the same declarative pattern
 * as HTTP routes and CLI commands.
 *
 * Tools must be explicitly {@link pick | picked} before they can
 * be passed to an agent — this prevents accidentally exposing
 * every tool to every LLM call.
 *
 * @example
 * ```typescript
 * import { Toolbox } from "@litmus/core/ai";
 *
 * const systemTools = new Toolbox()
 *   .tool("getTransactions", GetRecentTransactions, GetTransactionsSchema, {
 *     description: "Look up a customer's recent transactions",
 *   })
 *   .tool("initiateRefund", InitiateRefund, z.object({
 *     transaction_id: z.string().describe("The ID of the transaction to refund"),
 *   }).transform(({ transaction_id }) => ({ transactionId: transaction_id })), {
 *     description: "Initiate a refund for a transaction",
 *   });
 *
 * // Scope tools per agent
 * const disputeTools = systemTools.pick("getTransactions", "initiateRefund");
 * const vercelTools = toVercelTools(disputeTools);
 * ```
 */
export class Toolbox<TNames extends string = never> {
  readonly #entries: Map<string, Tool>;

  constructor(entries?: Map<string, Tool>) {
    this.#entries = entries ?? new Map();
  }

  /**
   * Register a use case as a system tool.
   *
   * @param name - Tool name visible to the LLM.
   * @param Handler - Use case class (CommandHandler or QueryHandler). Resolved via tsyringe.
   * @param schema - Zod schema describing the tool's input. Field descriptions
   *   help the LLM generate correct arguments. Use `.transform()` to map
   *   LLM-friendly field names to the handler's expected input shape.
   * @param options.description - Tool description used by the LLM for tool selection.
   */
  tool<TName extends string, TInput extends Record<string, unknown>, TOutput>(
    name: TName,
    Handler: HandlerClass<TInput, TOutput>,
    schema: ZodType<TInput>,
    options: { description: string },
  ): Toolbox<TNames | TName> {
    const newEntries = new Map(this.#entries);
    newEntries.set(name, {
      description: options.description,
      schema,
      handler: container.resolve(Handler) as Tool["handler"],
    });
    return new Toolbox(newEntries);
  }

  /**
   * Select a subset of tools by name. Returns a {@link ToolSelection}
   * that can be converted to a vendor-specific format.
   *
   * Only accepts names that have been registered via {@link tool}.
   */
  pick(...names: TNames[]): ToolSelection {
    const newEntries = new Map<string, Tool>();
    for (const name of names) {
      const entry = this.#entries.get(name);
      if (entry) newEntries.set(name, entry);
    }
    return new ToolSelection(newEntries);
  }
}
