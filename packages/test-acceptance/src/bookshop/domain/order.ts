import { AggregateRoot, type AggregateData, DomainEvent } from "@litmus/core";
import type { PrefixedUlid } from "@litmus/core/id";

import type { BookId } from "./book.ts";
import type { CartId } from "./cart.ts";
import type { CustomerId } from "./customer.ts";

export type OrderId = PrefixedUlid<"order">;

export interface OrderLine {
  bookId: BookId;
  title: string;
  price: number;
}

export type OrderStatus = "placed" | "failed";

interface OrderData extends AggregateData<OrderId> {
  customerId: CustomerId;
  status: OrderStatus;
  lines: OrderLine[];
}

export class Order extends AggregateRoot<OrderData, OrderId> {
  /**
   * Place a new order with the given lines. The order's lines are a
   * snapshot taken at checkout — later changes to the underlying books
   * (price, title) do not rewrite history. The lines array is copied
   * so callers cannot mutate the order's state after construction.
   */
  static place(init: {
    id: OrderId;
    customerId: CustomerId;
    cartId: CartId;
    lines: readonly OrderLine[];
  }): Order {
    const lines = [...init.lines];
    const order = new Order({
      id: init.id,
      customerId: init.customerId,
      status: "placed",
      lines,
    });
    order.addDomainEvent(
      new OrderPlaced(order.id, order.customerId, init.cartId, lines),
    );
    return order;
  }

  /**
   * Record a failed checkout attempt. Kept as an audit trail so the
   * customer (and operators) can see that a purchase was attempted
   * but payment was rejected — money was never taken.
   */
  static fail(init: {
    id: OrderId;
    customerId: CustomerId;
    lines: readonly OrderLine[];
  }): Order {
    return new Order({ ...init, lines: [...init.lines], status: "failed" });
  }

  get customerId(): CustomerId {
    return this.data.customerId;
  }

  get status(): OrderStatus {
    return this.data.status;
  }

  get lines(): readonly OrderLine[] {
    return this.data.lines;
  }

  get total(): number {
    const cents = this.data.lines.reduce(
      (sum, line) => sum + Math.round(line.price * 100),
      0,
    );
    return cents / 100;
  }
}

export class OrderPlaced extends DomainEvent<Order> {
  constructor(
    readonly orderId: OrderId,
    readonly customerId: CustomerId,
    readonly cartId: CartId,
    readonly lines: readonly OrderLine[],
  ) {
    super();
  }
}
