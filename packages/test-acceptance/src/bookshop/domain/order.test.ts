import { describe, expect, it } from "vite-plus/test";

import { Order } from "./order.ts";

describe("Order", () => {
  it("is placed when placed, with the lines and total it was given", () => {
    const order = Order.place({
      id: "order_1",
      customerId: "customer_1",
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
});
