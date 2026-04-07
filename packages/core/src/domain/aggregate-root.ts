import type { DomainEvent } from "#litmus/domain/domain-event.ts";
import { Entity } from "#litmus/domain/entity.ts";

/**
 * Shape that all aggregate state must satisfy. Provides the `id` for
 * identity and an optional `version` for optimistic concurrency
 * (managed by the framework — defaults to 0 on construction).
 *
 * Subclasses extend this with the aggregate's actual fields.
 *
 * @example
 * ```typescript
 * import type { AggregateData } from "@litmus/core";
 *
 * interface OrderData extends AggregateData {
 *   status: "draft" | "placed" | "shipped" | "cancelled";
 *   total: number;
 * }
 * ```
 */
export type AggregateData<TId = string> = {
  id: TId;
  version?: number;
};

/**
 * Base class for aggregate roots — entities that own a consistency
 * boundary, manage their own state transitions, and emit domain events.
 *
 * State lives in a private `#data` field accessed via the protected `data`
 * getter. Mutations should happen through intention-revealing methods
 * (`place()`, `ship()`, `cancel()`) rather than ad-hoc property writes,
 * and those methods should add domain events for anything an interested
 * party would want to react to.
 *
 * Versioning is handled by the framework: aggregates start at version 0,
 * the repository checks the version on update (optimistic concurrency)
 * and increments it on success. Domain events are collected via
 * `addDomainEvent()` during state transitions and dispatched after the
 * aggregate is persisted.
 *
 * @example
 * ```typescript
 * import { AggregateRoot, DomainEvent, type AggregateData } from "@litmus/core";
 *
 * interface OrderData extends AggregateData {
 *   status: "draft" | "placed" | "shipped";
 * }
 *
 * class OrderPlaced extends DomainEvent<OrderData> {}
 * class OrderShipped extends DomainEvent<OrderData> {}
 *
 * class Order extends AggregateRoot<OrderData> {
 *   get status() {
 *     return this.data.status;
 *   }
 *
 *   place() {
 *     if (this.data.status !== "draft") {
 *       throw new Error("Order already placed");
 *     }
 *     this.data.status = "placed";
 *     this.addDomainEvent(new OrderPlaced());
 *   }
 *
 *   ship() {
 *     this.data.status = "shipped";
 *     this.addDomainEvent(new OrderShipped());
 *   }
 * }
 *
 * const order = new Order({ id: "order_1", status: "draft" });
 * order.place();
 * // order.domainEvents now contains [OrderPlaced]
 * // The repository will dispatch them after a successful save.
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
