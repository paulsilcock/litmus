import { AsyncLocalStorage } from "node:async_hooks";

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { DbContext } from "#litmus/db/db-context.ts";

type PgDb = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

const storage = new AsyncLocalStorage<PgDb>();

export class DrizzleDbContext implements DbContext<PgDb> {
  constructor(readonly db: PgDb) {}

  async transaction(fn: () => Promise<void>): Promise<void> {
    if (storage.getStore()) {
      await fn();
      return;
    }

    await this.db.transaction(async (tx) => {
      await storage.run(tx, fn);
    });
  }

  get connection(): PgDb {
    return storage.getStore() ?? this.db;
  }
}
