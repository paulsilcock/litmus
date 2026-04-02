import type { AggregateRoot } from "#litmus/domain/aggregate-root.ts";

export interface Repository<T extends AggregateRoot> {
  add(aggregate: T): Promise<void>;
  update(aggregate: T): Promise<void>;
}
