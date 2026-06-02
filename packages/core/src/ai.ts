import { container } from "tsyringe";
import type { ZodSchema } from "zod";

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
 * Scalar metadata attached to a {@link Chunk}, kept to the value
 * types vector stores can reliably filter on across vendors.
 */
export type ChunkMetadata = Record<string, string | number | boolean>;

/**
 * A source document, before it is split into {@link Chunk}s.
 *
 * Its `id` becomes the `documentId` on every chunk derived from it,
 * which is what ties chunks back to their source for document-scoped
 * re-indexing. Loading or parsing a raw file into `content` is an
 * upstream concern; a {@link Chunker} starts from text.
 */
export interface Document<M extends ChunkMetadata = ChunkMetadata> {
  id: string;
  content: string;
  metadata?: M;
}

/**
 * A unit of retrievable content carved out of a source document.
 *
 * Litmus owns the identity graph — `id`, the originating
 * `documentId`, and the `content` — while the application owns the
 * payload via `metadata`. The `documentId` is what makes
 * document-scoped re-indexing possible (replace every chunk for a
 * document rather than reconcile chunk by chunk) and lets a
 * retrieved chunk be traced back to its source without a lookup.
 */
export interface Chunk<M extends ChunkMetadata = ChunkMetadata> {
  id: string;
  documentId: string;
  content: string;
  metadata?: M;
}

/**
 * A {@link Chunk} that also carries its position in a chunk graph —
 * its parent (hierarchical, small-to-big) and its neighbours either
 * side (sequential, sentence-window).
 *
 * Opt-in: any interface bounded on {@link Chunk} accepts a
 * `LinkedChunk` transparently. `parentId` is nullable so the root of
 * a hierarchy is representable; the store keeps chunks flat and the
 * graph is reconstructed from these links at read time.
 */
export interface LinkedChunk<
  M extends ChunkMetadata = ChunkMetadata,
> extends Chunk<M> {
  relationships: {
    parentId: string | null;
    previousId: string | null;
    nextId: string | null;
  };
}

/**
 * A single retrieved result paired with its relevance score.
 *
 * The score rides on the envelope rather than the result so the
 * application's own result type stays clean, and so the next stage
 * — a reranker or a relevance threshold — has the signal it needs.
 */
export interface Retrieved<TResult> {
  result: TResult;
  score: number;
}

/**
 * The read side of a retrieval store: given a query, return the `k`
 * most relevant chunks, each carrying a score.
 *
 * Naming the seam keeps retrieval out of inline vendor SDK calls and
 * behind an interface the application owns — injectable, swappable,
 * and evaluable stage by stage. `TQuery` is left open so an embedded
 * vector, a raw string, or a hybrid `{ text, filter }` query all fit
 * without prescribing a vendor-shaped filter on the port. Results are
 * {@link Chunk}s so they carry their `documentId` and content back to
 * the caller.
 *
 * @example
 * ```typescript
 * import type { Chunk, Retriever } from "@litmus/core/ai";
 *
 * interface Article extends Chunk {
 *   metadata?: { title: string };
 * }
 *
 * class AnswerSupportQuestion {
 *   constructor(private knowledgeBase: Retriever<string, Article>) {}
 *
 *   async handle({ question }: { question: string }) {
 *     const hits = await this.knowledgeBase.retrieve(question, 5);
 *     // ...rank, summarise, answer
 *   }
 * }
 * ```
 */
export interface Retriever<TQuery, TResult extends Chunk> {
  retrieve(query: TQuery, k: number): Promise<Retrieved<TResult>[]>;
}

/**
 * Splits a source {@link Document} into the {@link Chunk}s that get
 * embedded and indexed.
 *
 * Naming the seam keeps chunking — easily the most overlooked stage,
 * where silent ingestion failures originate — out of an inline blob
 * and behind an interface that can be tested and evaluated on its
 * own. The return is a promise so an agentic chunker (one that asks
 * an LLM where to split) fits the same shape as a deterministic one.
 * `TChunk` is open so a chunker can emit {@link LinkedChunk}s when it
 * builds a hierarchy.
 *
 * @example
 * ```typescript
 * import type { Chunk, Chunker, Document } from "@litmus/core/ai";
 *
 * class FixedSizeChunker implements Chunker<Document, Chunk> {
 *   async chunk(document: Document): Promise<Chunk[]> {
 *     // ...split document.content, stamp each chunk's documentId
 *   }
 * }
 * ```
 */
export interface Chunker<TDoc extends Document, TChunk extends Chunk> {
  chunk(document: TDoc): Promise<TChunk[]>;
}

/**
 * The write side of a retrieval store, scoped to the document.
 *
 * `index(documentId, chunks)` makes the stored chunks for a document
 * become *exactly* the supplied set — the store drops whatever it
 * held for that document and writes these. Re-ingesting a document
 * therefore can't orphan stale chunks, which sidesteps the genuinely
 * hard problem of reconciling shifted chunk boundaries after an edit.
 * `delete(documentId)` removes a document's chunks wholesale (source
 * removal). This is the grain mature frameworks settled on.
 *
 * Deliberately split from {@link Retriever} — ingestion code doesn't
 * need read capability and query-time use cases don't need write, so
 * each depends only on the half it uses. A concrete store can satisfy
 * both interfaces when it makes sense to share a connection or config.
 *
 * @example
 * ```typescript
 * import type { Chunk, Indexer } from "@litmus/core/ai";
 *
 * class IngestDocument {
 *   constructor(private index: Indexer<Chunk>) {}
 *
 *   async handle({ documentId, chunks }: { documentId: string; chunks: Chunk[] }) {
 *     await this.index.index(documentId, chunks);
 *   }
 * }
 * ```
 */
export interface Indexer<TChunk extends Chunk> {
  index(documentId: string, chunks: TChunk[]): Promise<void>;
  delete(documentId: string): Promise<void>;
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
export interface Tool {
  description: string;
  schema: ZodSchema;
  handler: {
    handle(input: unknown): Promise<unknown> | AsyncIterable<unknown>;
  };
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
    schema: ZodSchema<TInput>,
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
