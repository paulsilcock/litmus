import { randomUUID } from "node:crypto";

/**
 * Aliasing context shared across a Dsl and its sub-DSLs.
 *
 * Each `DslContext` instance holds a prefix that is unique to this test
 * run and worker, and to the instance. Pass `context.alias(value)` through identifier params that
 * the SUT enforces uniqueness on (emails, ids, etc.) so concurrent tests
 * and repeated runs against a shared SUT don't collide.
 *
 * @example
 * ```typescript
 * const ctx = new DslContext();
 * const a = ctx.alias("alice@example.com");
 * const b = ctx.alias("alice@example.com");
 * // a === b — every call on the same instance returns the same alias.
 *
 * const other = new DslContext();
 * other.alias("alice@example.com") !== a; // distinct instances → distinct aliases.
 * ```
 */
export class DslContext {
  static readonly #runId = randomUUID().slice(0, 8);
  static #count = 0;
  readonly #prefix: string;

  constructor() {
    DslContext.#count += 1;
    this.#prefix = `${DslContext.#runId}-${DslContext.#count}-`;
  }

  alias(value: string): string {
    return `${this.#prefix}${value}`;
  }
}

/**
 * Base class for the root DSL of an acceptance test suite.
 *
 * A root DSL owns the driver and the aliasing context. Disposing the
 * DSL (via `await using` or the `acceptance()` fixture) disposes the
 * driver — subclasses don't need to override `[Symbol.asyncDispose]`
 * unless they hold additional resources.
 *
 * Stateless. A DSL must not hold domain state — no "current customer",
 * no "last order ID". State belongs in the driver (protocol state) or
 * the test itself.
 *
 * ## When to split into sub-DSLs
 *
 * If the root DSL grows past ~5 methods or starts grouping by concept
 * (`registerCustomer` / `logInAs` / ... vs `putBookOnSale` / `searchBy` / ...),
 * split each concept into a sub-DSL. Sub-DSLs are plain classes — they
 * don't extend `Dsl`. They receive the same driver and context from the
 * root so aliases stay coherent within a single test.
 *
 * @example Single-class DSL
 * ```typescript
 * class TodoDsl extends Dsl<TodoDriver> {
 *   async hasItem(input: { title: string }) {
 *     await this.driver.addItem(this.context.alias(input.title));
 *   }
 * }
 * ```
 *
 * @example Composed root + sub-DSLs
 * ```typescript
 * class BookshopDsl extends Dsl<BookshopDriver> {
 *   readonly customers: CustomersDsl;
 *   readonly books: BooksDsl;
 *
 *   constructor(driver: BookshopDriver) {
 *     super(driver);
 *     this.customers = new CustomersDsl(driver, this.context);
 *     this.books = new BooksDsl(driver, this.context);
 *   }
 * }
 *
 * // Sub-DSL: plain class, no inheritance.
 * class CustomersDsl {
 *   constructor(
 *     private readonly driver: BookshopDriver,
 *     private readonly context: DslContext,
 *   ) {}
 *
 *   async hasAccount({ email }: { email: string }) {
 *     await this.driver.registerCustomer({ email: this.context.alias(email) });
 *   }
 * }
 * ```
 */
export abstract class Dsl<
  TDriver extends AsyncDisposable = AsyncDisposable,
> implements AsyncDisposable {
  protected readonly driver: TDriver;
  protected readonly context: DslContext;

  constructor(driver: TDriver, context?: DslContext) {
    this.driver = driver;
    this.context = context ?? new DslContext();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.driver[Symbol.asyncDispose]();
  }
}
