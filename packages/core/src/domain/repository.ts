import type { AggregateRoot } from "#litmus/domain/aggregate-root.ts";

/**
 * The persistence contract for an aggregate type.
 *
 * A repository represents an in-memory collection of aggregates: you ask
 * it for new IDs, hand it new aggregates to add, and hand it modified
 * aggregates to update. Lookup methods (`findById`, `findByCustomer`, etc.)
 * are intentionally not part of this base interface — define them on the
 * concrete subclass with names that fit the domain.
 *
 * `nextId()` lives on the repository because ID generation is a persistence
 * concern: the repository decides the format (prefixed ULID, UUID, sequence)
 * and the prefix that identifies the aggregate type.
 *
 * `update()` is expected to enforce optimistic concurrency by checking the
 * aggregate's current version against the stored version, and to dispatch
 * any collected domain events after a successful save.
 *
 * Repositories return fully hydrated aggregates and are optimised for the
 * write side (commands). They are usually a poor fit for read-heavy work
 * like list views or reports — those typically belong in a `QueryHandler`
 * that talks to the database directly and returns shape-tailored DTOs
 * (CQRS read side).
 *
 * @example
 * ```typescript
 * import type { Repository } from "@litmus/core";
 *
 * interface OrderRepository extends Repository<Order> {
 *   findById(id: string): Promise<Order | null>;
 *   findByCustomer(customerId: string): Promise<Order[]>;
 * }
 * ```
 */
export interface Repository<T extends AggregateRoot<any>> {
  nextId(): T["id"];
  add(aggregate: T): Promise<void>;
  update(aggregate: T): Promise<void>;
}
