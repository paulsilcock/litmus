import { ConcurrencyError } from "#litmus/db/concurrency-error.ts";
import type { Repository } from "#litmus/db/repository.ts";
import type { AggregateRoot } from "#litmus/domain/aggregate-root.ts";
import { and, eq } from "drizzle-orm";
import type { ColumnBaseConfig } from "drizzle-orm";
import {
  type PgColumn,
  PgDatabase,
  type PgQueryResultHKT,
  type PgTable,
} from "drizzle-orm/pg-core";

type HasAggregateColumns = PgTable & {
  id: PgColumn<any>;
  version: PgColumn<ColumnBaseConfig<"number", string>>;
  createdAt: PgColumn<ColumnBaseConfig<"date", string>>;
  updatedAt: PgColumn<ColumnBaseConfig<"date", string>>;
};

export abstract class DrizzlePostgresRepository<
  TAggregate extends AggregateRoot,
  TTable extends HasAggregateColumns = HasAggregateColumns,
> implements Repository<TAggregate> {
  constructor(
    protected readonly db: PgDatabase<PgQueryResultHKT, any>,
    protected readonly table: TTable,
  ) {}

  protected abstract toPersistence(
    aggregate: TAggregate,
  ): Omit<TTable["$inferInsert"], "id" | "version" | "createdAt" | "updatedAt">;

  async add(aggregate: TAggregate): Promise<void> {
    const data = this.toPersistence(aggregate);
    await (this.db as any).insert(this.table).values({
      ...data,
      id: aggregate.id,
      version: 0,
    });
  }

  async update(aggregate: TAggregate): Promise<void> {
    const data = this.toPersistence(aggregate);
    const updated = await (this.db as any)
      .update(this.table)
      .set({
        ...data,
        version: aggregate.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(eq(this.table.id, aggregate.id as string), eq(this.table.version, aggregate.version)),
      )
      .returning({ id: this.table.id });

    if (updated.length === 0) {
      const rows = await (this.db as any)
        .select({ version: this.table.version })
        .from(this.table)
        .where(eq(this.table.id, aggregate.id as string))
        .limit(1);

      throw new ConcurrencyError(aggregate.id as string, aggregate.version, rows[0]?.version ?? -1);
    }

    aggregate._incrementVersion();
  }
}
