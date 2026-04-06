import type { DomainEvent } from "#litmus/domain/domain-event.ts";
import { Entity } from "#litmus/domain/entity.ts";

/**
 * Shape of the plain data object that backs an aggregate.
 *
 * Every aggregate stores its state in a plain object conforming to this type.
 * `id` is required; `version` defaults to `0` on first creation and is
 * incremented by the repository after each successful save.
 */
export type AggregateData<TId = string> = {
  id: TId;
  version?: number;
};

/**
 * Base class for domain aggregates with identity, versioning, and
 * domain event collection.
 *
 * An aggregate root is the entry point to a consistency boundary.
 * It holds state via the `data` accessor, tracks a `version` for
 * optimistic concurrency, and collects domain events that are
 * cleared and dispatched after a successful save.
 *
 * @example
 * ```typescript
 * import { AggregateRoot, DomainEvent, type AggregateData } from "@litmus/core";
 *
 * type OrderData = AggregateData & {
 *   status: "draft" | "placed";
 * };
 *
 * class OrderPlaced extends DomainEvent<OrderData> {}
 *
 * class Order extends AggregateRoot<OrderData> {
 *   static create(id: string): Order {
 *     return new Order({ id, status: "draft" });
 *   }
 *
 *   place(): void {
 *     this.data.status = "placed";
 *     this.addDomainEvent(new OrderPlaced());
 *   }
 * }
 * ```
 */
export abstract class AggregateRoot<
  TData extends AggregateData<TId>,
  TId = string,
> extends Entity<TId> {
  #data: TData;
  #domainEvents: DomainEvent<any>[] = [];

  constructor(data: TData) {
    super(data.id);
    this.#data = { ...data, version: data.version ?? 0 };
  }

  get version(): number {
    return this.#data.version!;
  }

  get domainEvents(): readonly DomainEvent<any>[] {
    return this.#domainEvents;
  }

  protected get data(): TData {
    return this.#data;
  }

  /** @internal Called by repository after successful save. */
  _incrementVersion(): void {
    this.#data = { ...this.#data, version: this.#data.version! + 1 };
  }

  protected addDomainEvent(event: DomainEvent<TData>): void {
    this.#domainEvents.push(event);
  }

  clearDomainEvents(): DomainEvent[] {
    const events = [...this.#domainEvents];
    this.#domainEvents = [];
    return events;
  }
}
