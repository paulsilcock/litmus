import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DrizzleTransaction } from "#litmus/db/drizzle-postgres/transaction.ts";

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

describe("DrizzleTransaction", () => {
  let db: ReturnType<typeof drizzle>;
  let tx: DrizzleTransaction;

  beforeEach(async () => {
    const client = new PGlite();

    const rawDb = drizzle(client);
    const { apply } = await pushSchema(schema, rawDb);
    await apply();

    db = drizzle(client, { schema });
    tx = new DrizzleTransaction(db);
  });

  it("nested execute reuses the existing transaction", async () => {
    const transactionSpy = vi.spyOn(db, "transaction");

    await tx.execute(async () => {
      await tx.execute(async () => {
        // inner work
      });
    });

    expect(transactionSpy).toHaveBeenCalledOnce();
  });
});
