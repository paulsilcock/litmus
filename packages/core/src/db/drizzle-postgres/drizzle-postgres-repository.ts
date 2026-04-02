import { ConcurrencyError } from "#litmus/db/concurrency-error.ts";
import type { Repository } from "#litmus/db/repository.ts";
import type { AggregateRoot } from "#litmus/domain/aggregate-root.ts";
import type { ColumnBaseConfig } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import type { PgColumn, PgDatabase, PgQueryResultHKT, PgTable } from "drizzle-orm/pg-core";

type HasAggregateColumns = PgTable & {
  id: PgColumn<any>;
  version: PgColumn<ColumnBaseConfig<"number", string>>;
  createdAt: PgColumn<ColumnBaseConfig<"date", string>>;
  updatedAt: PgColumn<ColumnBaseConfig<"date", string>>;
};

export abstract class DrizzlePostgresRepository<
  TAggregate extends AggregateRoot<any>,
  TSchema extends Record<string, unknown> = Record<string, unknown>,
  TTable extends HasAggregateColumns = HasAggregateColumns,
> implements Repository<TAggregate> {
  constructor(
    protected readonly db: PgDatabase<PgQueryResultHKT, TSchema>,
    private readonly table: TTable,
  ) {}

  protected abstract toPersistence(
    aggregate: TAggregate,
  ): Omit<TTable["$inferInsert"], "id" | "version" | "createdAt" | "updatedAt">;

  async add(aggregate: TAggregate): Promise<void> {
    const data: TTable["$inferInsert"] = {
      ...this.toPersistence(aggregate),
      id: aggregate.id,
      version: 0,
    };

    await this.db.insert(this.table).values(data);
  }

  async update(aggregate: TAggregate): Promise<void> {
    const data: TTable["$inferInsert"] = {
      ...this.toPersistence(aggregate),
      version: aggregate.version + 1,
      updatedAt: new Date(),
    };

    const updated = await this.db
      .update(this.table)
      .set(data)
      .where(and(eq(this.table.id, aggregate.id), eq(this.table.version, aggregate.version)))
      .returning({ id: this.table.id });

    if (updated.length === 0) {
      throw new ConcurrencyError(aggregate.id, aggregate.version);
    }

    aggregate._incrementVersion();
  }
}
