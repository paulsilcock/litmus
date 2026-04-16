import { describe, expect, it } from "vite-plus/test";

import { Order, type OrderLine, OrderPlaced } from "./order.ts";

describe("Order", () => {
  it("New orders record items purchased", () => {
    const order = Order.place({
      id: "order_1",
      customerId: "customer_1",
      cartId: "cart_1",
      lines: [
        { bookId: "book_1", title: "The Hobbit", price: 12.99 },
        { bookId: "book_2", title: "Dune", price: 14.5 },
      ],
    });

    expect(order.status).toBe("placed");
    expect(order.lines).toEqual([
      { bookId: "book_1", title: "The Hobbit", price: 12.99 },
      { bookId: "book_2", title: "Dune", price: 14.5 },
    ]);
    expect(order.total).toBe(27.49);
  });

  it("New orders emit OrderPlaced event", () => {
    const order = Order.place({
      id: "order_1",
      customerId: "customer_1",
      cartId: "cart_1",
      lines: [{ bookId: "book_1", title: "The Hobbit", price: 12.99 }],
    });

    const [event] = order.domainEvents;
    expect(event).toBeInstanceOf(OrderPlaced);
    expect(event).toMatchObject({
      orderId: "order_1",
      customerId: "customer_1",
      cartId: "cart_1",
      lines: [{ bookId: "book_1", title: "The Hobbit", price: 12.99 }],
    });
  });

  it("copies lines defensively so callers cannot mutate the order after construction", () => {
    const lines: OrderLine[] = [
      { bookId: "book_1", title: "The Hobbit", price: 12.99 },
    ];
    const order = Order.place({
      id: "order_1",
      customerId: "customer_1",
      cartId: "cart_1",
      lines,
    });

    lines.push({ bookId: "book_2", title: "Dune", price: 14.5 });

    expect(order.lines).toHaveLength(1);
    const [event] = order.domainEvents;
    expect(event).toBeInstanceOf(OrderPlaced);
    if (!(event instanceof OrderPlaced)) return;
    expect(event.lines).toHaveLength(1);
  });
});
