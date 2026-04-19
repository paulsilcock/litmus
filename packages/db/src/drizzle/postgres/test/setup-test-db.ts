import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import "reflect-metadata";
import { container } from "tsyringe";
import { beforeAll, beforeEach } from "vite-plus/test";

import { DrizzleDbContext } from "#litmus-db/drizzle/postgres/db-context.ts";

/**
 * Spins up an in-memory PGlite database for the enclosing describe
 * block, pushes the supplied drizzle schema, and registers
 * `DrizzleDbContext` with the DI container so tests can resolve it.
 *
 * Tables in the schema are truncated with `RESTART IDENTITY CASCADE`
 * before each test so state does not leak between cases. Non-table
 * schema values (e.g. `relations(...)`) are ignored.
 *
 * Call once at the top of a `describe` block. Register any seed
 * hooks (`beforeAll` / `beforeEach`) *after* this call so the
 * `DrizzleDbContext` registration has happened by the time they run.
 *
 * @example
 * ```ts
 * import { container } from "tsyringe";
 * import { describe, expect, it } from "vite-plus/test";
 * import { DrizzleDbContext } from "@litmus/db/drizzle/postgres";
 * import { setupTestDb } from "@litmus/db/drizzle/postgres/test";
 * import { orders, schema } from "./schema.ts";
 *
 * describe("OrderRepository", () => {
 *   setupTestDb({ schema });
 *
 *   it("persists orders", async () => {
 *     const ctx = container.resolve(DrizzleDbContext);
 *     await ctx.db.insert(orders).values({ id: "o1" });
 *     expect(await ctx.db.select().from(orders)).toHaveLength(1);
 *   });
 * });
 * ```
 */
export function setupTestDb(options: {
  schema: Record<string, unknown>;
}): void {
  const tableNames = Object.values(options.schema)
    .filter((v): v is PgTable => is(v, PgTable))
    .map((t) => `"${getTableName(t)}"`)
    .join(", ");

  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    const client = new PGlite();
    const rawDb = drizzle(client);
    const { apply } = await pushSchema(options.schema, rawDb);
    await apply();

    db = drizzle(client, { schema: options.schema });
    DrizzleDbContext.register(db);
  });

  beforeEach(async () => {
    await db.execute(
      sql.raw(`TRUNCATE ${tableNames} RESTART IDENTITY CASCADE`),
    );
    container.clearInstances();
    DrizzleDbContext.register(db);
  });
}
