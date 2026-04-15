import { describe, expect, it } from "vite-plus/test";

import { Cart } from "./cart.ts";

describe("Cart", () => {
  it("starts empty", () => {
    const cart = new Cart({ id: "cart_1", customerId: "customer_1" });

    expect(cart.items).toEqual([]);
  });

  it("records the books added to it", () => {
    const cart = new Cart({ id: "cart_1", customerId: "customer_1" });

    cart.add({ bookId: "book_1", title: "The Hobbit", price: 12.99 });
    cart.add({ bookId: "book_2", title: "Dune", price: 14.5 });

    expect(cart.items).toEqual([
      { bookId: "book_1", title: "The Hobbit", price: 12.99 },
      { bookId: "book_2", title: "Dune", price: 14.5 },
    ]);
  });

  it("totals the price of its items", () => {
    const cart = new Cart({ id: "cart_1", customerId: "customer_1" });

    cart.add({ bookId: "book_1", title: "The Hobbit", price: 12.99 });
    cart.add({ bookId: "book_2", title: "Dune", price: 14.5 });

    expect(cart.total).toBe(27.49);
  });

  it("becomes checked out when checked out", () => {
    const cart = new Cart({ id: "cart_1", customerId: "customer_1" });
    cart.add({ bookId: "book_1", title: "The Hobbit", price: 12.99 });

    cart.checkOut();

    expect(cart.status).toBe("checked-out");
  });

  it("cannot be checked out when empty", () => {
    const cart = new Cart({ id: "cart_1", customerId: "customer_1" });

    expect(() => cart.checkOut()).toThrow("Cannot check out an empty cart");
  });
});
