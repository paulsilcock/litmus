import type { AggregateData } from "#litmus/domain/aggregate-root.ts";

declare const sourceSymbol: unique symbol;

/**
 * Base class for domain events.
 *
 * Domain events represent something meaningful that happened inside an
 * aggregate. Each event records an `occurredAt` timestamp automatically.
 * The `TData` phantom type parameter brands the event to a specific
 * aggregate, so `addDomainEvent` only accepts events that belong to
 * the aggregate that raises them.
 *
 * @example
 * ```typescript
 * import { DomainEvent } from "@litmus/core";
 * import type { OrderData } from "./order";
 *
 * class OrderPlaced extends DomainEvent<OrderData> {}
 *
 * class OrderShipped extends DomainEvent<OrderData> {
 *   constructor(readonly trackingNumber: string) {
 *     super();
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
