import { AsyncLocalStorage } from "node:async_hooks";

import type { DomainEvent } from "@litmus/core";
import type { DbContext } from "@litmus/core/db";
import { DomainEventDispatcher } from "@litmus/core/events";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { container, inject, singleton } from "tsyringe";

type PgDb = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

/**
 * Injection token for the raw Drizzle database instance. Bootstrap
 * registers the constructed Drizzle handle under this token so
 * `DrizzleDbContext` can be DI-resolved.
 */
export const DRIZZLE_DB = Symbol.for("@litmus/db/DrizzleDb");

@singleton()
export class DrizzleDbContext implements DbContext<PgDb> {
  private readonly txStorage = new AsyncLocalStorage<PgDb>();
  private readonly eventBuffer = new AsyncLocalStorage<DomainEvent[]>();

  /**
   * Register the Drizzle database handle so `DrizzleDbContext` can
   * be resolved from the container. Call once during bootstrap.
   */
  static register(db: PgDb): void {
    container.registerInstance(DRIZZLE_DB, db);
  }

  constructor(
    @inject(DRIZZLE_DB) readonly db: PgDb,
    @inject(DomainEventDispatcher)
    private readonly dispatcher: DomainEventDispatcher,
  ) {}

  async transaction(fn: () => Promise<void>): Promise<void> {
    if (this.txStorage.getStore()) {
      await fn();
      return;
    }

    const buffered: DomainEvent[] = [];

    await this.eventBuffer.run(buffered, async () => {
      await this.db.transaction(async (tx) => {
        await this.txStorage.run(tx, fn);
      });
    });

    await this.dispatchEvents(buffered);
  }

  get connection(): PgDb {
    return this.txStorage.getStore() ?? this.db;
  }

  async publishEvents(events: DomainEvent[]): Promise<void> {
    const buffer = this.eventBuffer.getStore();
    if (buffer) {
      buffer.push(...events);
      return;
    }

    await this.dispatchEvents(events);
  }

  private async dispatchEvents(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.dispatcher.publish(event);
    }
  }
}
