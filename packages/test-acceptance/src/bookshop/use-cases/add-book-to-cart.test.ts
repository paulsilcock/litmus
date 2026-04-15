import { describe, expect, it } from "vite-plus/test";

import { Book } from "../domain/book.ts";
import { Cart } from "../domain/cart.ts";
import { Customer } from "../domain/customer.ts";
import { AddBookToCart } from "./add-book-to-cart.ts";

describe("AddBookToCart", () => {
  it("adds the book to the customer's open cart", async () => {
    const alice = new Customer({ id: "customer_1", name: "Alice" });
    const hobbit = new Book({
      id: "book_1",
      title: "The Hobbit",
      author: "Tolkien",
      price: 12.99,
    });
    const existingCart = new Cart({
      id: "cart_1",
      customerId: alice.id,
    });

    let updated: Cart | undefined;
    const handler = new AddBookToCart(
      {
        findByName: async (name) => (name === "Alice" ? alice : null),
      },
      {
        findByTitle: async (title) => (title === "The Hobbit" ? hobbit : null),
      },
      {
        nextId: () => "cart_new",
        findOpenForCustomer: async () => existingCart,
        add: async () => {},
        update: async (cart) => {
          updated = cart;
        },
      },
    );

    await handler.handle({ customer: "Alice", title: "The Hobbit" });

    expect(updated).toBe(existingCart);
    expect(existingCart.items).toEqual([
      { bookId: "book_1", title: "The Hobbit", price: 12.99 },
    ]);
  });

  it("creates a new cart if the customer has none open", async () => {
    const alice = new Customer({ id: "customer_1", name: "Alice" });
    const hobbit = new Book({
      id: "book_1",
      title: "The Hobbit",
      author: "Tolkien",
      price: 12.99,
    });
    let added: Cart | undefined;

    const handler = new AddBookToCart(
      { findByName: async () => alice },
      { findByTitle: async () => hobbit },
      {
        nextId: () => "cart_new",
        findOpenForCustomer: async () => null,
        add: async (cart) => {
          added = cart;
        },
        update: async () => {},
      },
    );

    await handler.handle({ customer: "Alice", title: "The Hobbit" });

    expect(added?.id).toBe("cart_new");
    expect(added?.customerId).toBe("customer_1");
    expect(added?.items).toEqual([
      { bookId: "book_1", title: "The Hobbit", price: 12.99 },
    ]);
  });
});
