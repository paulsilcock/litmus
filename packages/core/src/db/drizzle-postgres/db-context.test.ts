import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DrizzleDbContext } from "#litmus/db/drizzle-postgres/db-context.ts";

const items = pgTable("items", {
  id: varchar("id").primaryKey(),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

const schema = { items };

describe("DrizzleDbContext", () => {
  let ctx: DrizzleDbContext;

  beforeEach(async () => {
    const client = new PGlite();

    const rawDb = drizzle(client);
    const { apply } = await pushSchema(schema, rawDb);
    await apply();

    const db = drizzle(client, { schema });
    ctx = new DrizzleDbContext(db);
  });

  it("nested transaction reuses the existing transaction", async () => {
    const transactionSpy = vi.spyOn(ctx.db, "transaction");

    await ctx.transaction(async () => {
      await ctx.transaction(async () => {
        // inner work
      });
    });

    expect(transactionSpy).toHaveBeenCalledOnce();
  });
});
