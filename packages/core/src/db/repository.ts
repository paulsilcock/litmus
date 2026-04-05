import type { AggregateRoot } from "#litmus/domain/aggregate-root.ts";

export interface Repository<T extends AggregateRoot<any>> {
  nextId(): T["id"];
  add(aggregate: T): Promise<void>;
  update(aggregate: T): Promise<void>;
}
