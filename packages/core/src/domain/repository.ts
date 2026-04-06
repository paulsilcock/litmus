import type { AggregateRoot } from "#litmus/domain/aggregate-root.ts";

/**
 * Persistence contract for aggregates.
 *
 * `Repository` defines the minimal operations every aggregate store must
 * support: generating a new identity, adding a new aggregate, and updating
 * an existing one. Implement this interface per aggregate type.
 *
 * @example
 * ```typescript
 * import type { Repository } from "@litmus/core";
 * import type { Order } from "./order";
 *
 * class PlaceOrder {
 *   constructor(private readonly orders: Repository<Order>) {}
 *
 *   async execute(): Promise<string> {
 *     const id = this.orders.nextId();
 *     const order = Order.create(id);
 *     await this.orders.add(order);
 *     return id;
 *   }
 * }
 * ```
 */
export interface Repository<T extends AggregateRoot<any>> {
  nextId(): T["id"];
  add(aggregate: T): Promise<void>;
  update(aggregate: T): Promise<void>;
}
