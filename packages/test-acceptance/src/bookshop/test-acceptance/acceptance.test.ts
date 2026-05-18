import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
} from "vite-plus/test";

import { bootstrapBookshop, type RunningBookshop } from "../bookshop.ts";
import { BookshopDriver } from "./driver.ts";
import { BookshopDsl } from "./dsl.ts";

describe("bookshop", () => {
  let bookshop: RunningBookshop;
  let driver: BookshopDriver;
  let dsl: BookshopDsl;

  beforeAll(async () => {
    bookshop = await bootstrapBookshop();
  });

  afterAll(async () => {
    await bookshop.stop();
  });

  beforeEach(() => {
    driver = new BookshopDriver(bookshop.baseUrl, bookshop.emailStubBaseUrl);
    dsl = new BookshopDsl(driver);
  });

  afterEach(async () => {
    await driver.cleanup();
  });

  it("customer can purchase a book", async () => {
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

  it("customer is emailed a confirmation after purchase", async () => {
    throw new Error("not yet refactored to the new DSL shape");
  });
});
