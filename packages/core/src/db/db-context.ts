/**
 * Abstraction over a database connection and its transaction boundary.
 *
 * `DbContext` is the seam between the domain layer and a concrete
 * persistence library (Drizzle, Prisma, raw SQL, in-memory). Repositories
 * read from `db` (or its current transaction) and call `transaction()`
 * when several aggregates need to be written together.
 *
 * Implementations are responsible for buffering domain events raised
 * during a transaction and dispatching them only after the transaction
 * commits — events are discarded on rollback.
 *
 * For Postgres + Drizzle, use `DrizzleDbContext` from `@litmus/db/drizzle/postgres`.
 *
 * @example
 * ```typescript
 * import type { DbContext } from "@litmus/core/db";
 *
 * async function placeOrderAndChargeCustomer(
 *   ctx: DbContext<unknown>,
 *   orderRepo: OrderRepository,
 *   paymentRepo: PaymentRepository,
 * ) {
 *   await ctx.transaction(async () => {
 *     await orderRepo.add(order);
 *     await paymentRepo.add(payment);
 *     // Both writes commit together; events dispatch after commit.
 *   });
 * }
 * ```
 */
export interface DbContext<TDb> {
  readonly db: TDb;
  transaction(fn: () => Promise<void>): Promise<void>;
}
