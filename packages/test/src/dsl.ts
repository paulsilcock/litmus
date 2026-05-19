/**
 * Aliasing context shared across a Dsl and its sub-DSLs.
 *
 * Each `DslContext` instance holds a unique prefix scoped to the current
 * test worker. Pass `context.alias(value)` through identifier params that
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
  static readonly #counters = new Map<string, number>();
  readonly #prefix: string;

  constructor() {
    this.#prefix = DslContext.#nextPrefix();
  }

  static #nextPrefix(): string {
    const key = process.env["VITEST_POOL_ID"] ?? `pid${process.pid}`;
    const next = (DslContext.#counters.get(key) ?? 0) + 1;
    DslContext.#counters.set(key, next);
    return String(next);
  }

  alias(value: string): string {
    return `${this.#prefix}${value}`;
  }
}

/**
 * Base class for acceptance-test DSLs and their sub-DSLs.
 *
 * Holds a `DslContext` for identifier aliasing. A root DSL constructs a
 * fresh context if none is provided; sub-DSLs accept the root's context
 * so all aliases within one test share the same prefix.
 *
 * Stateless. A DSL must not hold domain state — no "current customer",
 * no "last order ID". State belongs in the driver (protocol state) or
 * the test itself.
 *
 * @example
 * ```typescript
 * class BookshopDsl extends Dsl {
 *   readonly customers: CustomersDsl;
 *   readonly books: BooksDsl;
 *
 *   constructor(driver: BookshopDriver) {
 *     super(); // fresh DslContext
 *     this.customers = new CustomersDsl(driver, this.context);
 *     this.books = new BooksDsl(driver, this.context);
 *   }
 * }
 *
 * class CustomersDsl extends Dsl {
 *   constructor(private readonly driver: BookshopDriver, context: DslContext) {
 *     super(context);
 *   }
 *
 *   async hasAccount({ email }: { email: string }) {
 *     await this.driver.registerCustomer({ email: this.context.alias(email) });
 *   }
 * }
 * ```
 */
export abstract class Dsl {
  protected readonly context: DslContext;

  constructor(context?: DslContext) {
    this.context = context ?? new DslContext();
  }

  /**
   * Default dispose hook is a no-op. Override to release resources
   * (close a browser, tear down a connection, etc.). Test fixtures
   * scope the dsl's lifetime with `await using`, so this runs after
   * the test body even on throw.
   */
  async [Symbol.asyncDispose](): Promise<void> {}
}
