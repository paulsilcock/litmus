import { AsyncLocalStorage } from "node:async_hooks";

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { DbContext } from "#litmus/db/db-context.ts";
import type { DomainEventDispatcher } from "#litmus/domain/domain-event-dispatcher.ts";
import type { DomainEvent } from "#litmus/domain/domain-event.ts";

type PgDb = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

export class DrizzleDbContext implements DbContext<PgDb> {
  private readonly txStorage = new AsyncLocalStorage<PgDb>();
  private readonly eventBuffer = new AsyncLocalStorage<DomainEvent[]>();

  constructor(
    readonly db: PgDb,
    private readonly dispatcher?: DomainEventDispatcher,
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

    this.dispatchEvents(buffered);
  }

  get connection(): PgDb {
    return this.txStorage.getStore() ?? this.db;
  }

  publishEvents(events: DomainEvent[]): void {
    const buffer = this.eventBuffer.getStore();
    if (buffer) {
      buffer.push(...events);
      return;
    }

    this.dispatchEvents(events);
  }

  private dispatchEvents(events: DomainEvent[]): void {
    if (!this.dispatcher) return;
    for (const event of events) {
      this.dispatcher.publish(event);
    }
  }
}
