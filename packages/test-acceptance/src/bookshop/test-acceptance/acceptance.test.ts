import { acceptance } from "@litmus/test";
import { afterAll, beforeAll, describe } from "vite-plus/test";

import { bootstrapBookshop, type RunningBookshop } from "#bookshop/bookshop.ts";

import { createBookshopDriver } from "./driver.ts";
import { BookshopDsl } from "./dsl.ts";

describe("bookshop", () => {
  let bookshop: RunningBookshop;

  beforeAll(async () => {
    bookshop = await bootstrapBookshop();
  });

  afterAll(async () => {
    await bookshop.stop();
  });

  const { it } = acceptance(
    () => new BookshopDsl(createBookshopDriver(bookshop)),
  );

  it("customer can purchase a book", async ({ dsl }) => {
    await dsl.books.hasOnSale({
      title: "The Hobbit",
      author: "Tolkien",
      price: 12.99,
    });
    await dsl.customers.hasAccount({
      name: "Alice",
      email: "alice@example.com",
    });

    await dsl.customers.logIn({ email: "alice@example.com" });
    await dsl.books.searchBy({ author: "Tolkien" });
    await dsl.cart.addBook({ title: "The Hobbit" });
    await dsl.cart.checkOut();

    await dsl.orders.confirmPurchased({ title: "The Hobbit" });
  });

  it("customer is emailed a confirmation after purchase", async ({ dsl }) => {
    await dsl.books.hasOnSale({
      title: "The Fellowship of the Ring",
      author: "Tolkien",
      price: 14.99,
    });
    await dsl.customers.hasAccount({
      name: "Bob",
      email: "bob@example.com",
    });

    await dsl.customers.logIn({ email: "bob@example.com" });
    await dsl.books.searchBy({ author: "Tolkien" });
    await dsl.cart.addBook({ title: "The Fellowship of the Ring" });
    await dsl.cart.checkOut();

    await dsl.orders.confirmConfirmationSent({ to: "bob@example.com" });
  });
});
