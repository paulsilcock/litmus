/**
 * Aliasing context shared across a Dsl and its sub-DSLs.
 *
 * Each `DslContext` instance holds a unique suffix scoped to the current
 * test worker. Pass `context.alias(value)` through identifier params that
 * the SUT enforces uniqueness on (emails, ids, etc.) so concurrent tests
 * and repeated runs against a shared SUT don't collide.
 *
 * @example
 * ```typescript
 * const ctx = new DslContext();
 * ctx.alias("alice@example.com"); // "3alice@example.com"
 * ctx.alias("alice@example.com"); // "3alice@example.com" — deterministic per instance
 * ```
 */
export class DslContext {
  static readonly #counters = new Map<string, number>();
  readonly #suffix: string;

  constructor() {
    this.#suffix = DslContext.#nextSuffix();
  }

  static #nextSuffix(): string {
    const key = process.env["VITEST_POOL_ID"] ?? `pid${process.pid}`;
    const next = (DslContext.#counters.get(key) ?? 0) + 1;
    DslContext.#counters.set(key, next);
    return String(next);
  }

  alias(value: string): string {
    return `${this.#suffix}${value}`;
  }
}

/**
 * Base class for acceptance-test DSLs and their sub-DSLs.
 *
 * Holds a `DslContext` for identifier aliasing. A root DSL constructs a
 * fresh context if none is provided; sub-DSLs accept the root's context
 * so all aliases within one test share the same suffix.
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
}
