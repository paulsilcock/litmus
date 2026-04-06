/**
 * Abstraction for a database connection with transaction support.
 *
 * `DbContext` exposes the underlying database client via `db` and
 * provides a `transaction()` method that runs a callback inside a
 * database transaction. Implement this interface for each database
 * driver (e.g. Drizzle, Prisma, Knex).
 *
 * @example
 * ```typescript
 * import type { DbContext } from "@litmus/core";
 *
 * async function transferFunds(
 *   dbContext: DbContext<DrizzleClient>,
 *   from: string,
 *   to: string,
 *   amount: number,
 * ): Promise<void> {
 *   await dbContext.transaction(async () => {
 *     // both operations share the same transaction
 *     await debit(dbContext.db, from, amount);
 *     await credit(dbContext.db, to, amount);
 *   });
 * }
 * ```
 */
export interface DbContext<TDb> {
  readonly db: TDb;
  transaction(fn: () => Promise<void>): Promise<void>;
}
