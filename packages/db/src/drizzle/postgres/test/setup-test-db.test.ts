import { relations } from "drizzle-orm";
import { integer, pgTable, varchar } from "drizzle-orm/pg-core";
import "reflect-metadata";
import { container } from "tsyringe";
import { describe, expect, it } from "vite-plus/test";

import { DrizzleDbContext } from "#litmus-db/drizzle/postgres/db-context.ts";
import { setupTestDb } from "#litmus-db/drizzle/postgres/test/setup-test-db.ts";

const items = pgTable("items", {
  id: varchar("id").primaryKey(),
  version: integer("version").notNull().default(0),
});
const schema = { items };

describe("setupTestDb", () => {
  setupTestDb({ schema });

  it("registers a DbContext backed by pglite with the schema applied", async () => {
    const ctx = container.resolve(DrizzleDbContext);

    await ctx.db.insert(items).values({ id: "1" });
    const rows = await ctx.db.select().from(items);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("1");
  });

  it("isolates data between tests", async () => {
    const ctx = container.resolve(DrizzleDbContext);

    const rows = await ctx.db.select().from(items);
    expect(rows).toHaveLength(0);

    await ctx.db.insert(items).values({ id: "leak-check" });
  });
});

describe("setupTestDb with non-table schema entries", () => {
  const itemsRelations = relations(items, () => ({}));
  const mixedSchema = { items, itemsRelations };

  setupTestDb({ schema: mixedSchema });

  it("ignores non-table values when truncating", async () => {
    const ctx = container.resolve(DrizzleDbContext);

    await ctx.db.insert(items).values({ id: "1" });
    const rows = await ctx.db.select().from(items);

    expect(rows).toHaveLength(1);
  });
});
