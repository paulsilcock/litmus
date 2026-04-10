import { PGlite } from "@electric-sql/pglite";
import { DomainEvent } from "@litmus/core";
import { DomainEventDispatcher } from "@litmus/core/events";
import { pushSchema } from "drizzle-kit/api";
import { integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { DrizzleDbContext } from "#litmus-db/drizzle/postgres/db-context.ts";

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

  beforeAll(async () => {
    const client = new PGlite();
    const rawDb = drizzle(client);
    const { apply } = await pushSchema(schema, rawDb);
    await apply();

    const db = drizzle(client, { schema });
    ctx = new DrizzleDbContext(db, new DomainEventDispatcher());
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

  it("buffers events during a transaction and dispatches after commit", async () => {
    class TestEvent extends DomainEvent {}

    const dispatcher = new DomainEventDispatcher();
    const handler = vi.fn();
    dispatcher.on(TestEvent, handler);

    const ctxWithDispatcher = new DrizzleDbContext(ctx.db, dispatcher);

    await ctxWithDispatcher.transaction(async () => {
      ctxWithDispatcher.publishEvents([new TestEvent()]);
      expect(handler).not.toHaveBeenCalled();
    });

    expect(handler).toHaveBeenCalledOnce();
  });
});
