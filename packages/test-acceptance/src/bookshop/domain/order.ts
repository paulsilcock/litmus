import { AggregateRoot, type AggregateData } from "@litmus/core";

export interface OrderLine {
  bookId: string;
  title: string;
  price: number;
}

export type OrderStatus = "placed";

interface OrderData extends AggregateData {
  customerId: string;
  status: OrderStatus;
  lines: OrderLine[];
}

export class Order extends AggregateRoot<OrderData> {
  /**
   * Place a new order with the given lines. The order's lines are a
   * snapshot taken at checkout — later changes to the underlying books
   * (price, title) do not rewrite history.
   */
  static place(init: {
    id: string;
    customerId: string;
    lines: OrderLine[];
  }): Order {
    return new Order({ ...init, status: "placed" });
  }

  get customerId(): string {
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
