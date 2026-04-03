import { AsyncLocalStorage } from "node:async_hooks";

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { Transaction } from "#litmus/db/transaction.ts";

const storage = new AsyncLocalStorage<
  PgDatabase<PgQueryResultHKT, Record<string, unknown>>
>();

export class DrizzleTransaction implements Transaction {
  constructor(
    private readonly db: PgDatabase<PgQueryResultHKT, Record<string, unknown>>,
  ) {}

  async execute(fn: () => Promise<void>): Promise<void> {
    // If already inside a transaction, reuse it
    if (storage.getStore()) {
      await fn();
      return;
    }

    await this.db.transaction(async (tx) => {
      await storage.run(tx, fn);
    });
  }

  static active():
    | PgDatabase<PgQueryResultHKT, Record<string, unknown>>
    | undefined {
    return storage.getStore();
  }
}
