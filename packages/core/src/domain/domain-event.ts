import type { AggregateData } from "#litmus/domain/aggregate-root.ts";

declare const sourceSymbol: unique symbol;

/**
 * Base class for domain events — immutable records of something that
 * has happened in the domain. Events are emitted by aggregates from
 * within state-changing methods, collected on the aggregate, and
 * dispatched after the aggregate is successfully persisted.
 *
 * The `TData` type parameter brands an event to its source aggregate.
 * This prevents an aggregate from accidentally raising an event that
 * belongs to a different aggregate — `Order` cannot emit `UserRegistered`,
 * the type system catches it at compile time.
 *
 * Carry only the data needed by handlers. Past tense names (`OrderPlaced`,
 * `PaymentReceived`) make events read as facts about history.
 *
 * @example
 * ```typescript
 * import { AggregateRoot, DomainEvent, type AggregateData } from "@litmus/core";
 *
 * interface OrderData extends AggregateData {
 *   status: string;
 * }
 *
 * class OrderPlaced extends DomainEvent<OrderData> {
 *   constructor(readonly orderId: string) {
 *     super();
 *   }
 * }
 *
 * class Order extends AggregateRoot<OrderData> {
 *   place() {
 *     this.data.status = "placed";
 *     this.addDomainEvent(new OrderPlaced(this.id));
 *   }
 * }
 * ```
 */
export abstract class DomainEvent<
  TData extends AggregateData<any> = AggregateData<any>,
> {
  readonly occurredAt: Date;
  declare readonly [sourceSymbol]: TData;

  constructor() {
    this.occurredAt = new Date();
  }
}
