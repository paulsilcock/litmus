import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
} from "vite-plus/test";

import { bootstrapBookshop, type RunningBookshop } from "../bookshop.ts";
import { BookshopDsl } from "./dsl.ts";

describe("bookshop", () => {
  let bookshop: RunningBookshop;
  let dsl: BookshopDsl;

  beforeAll(async () => {
    bookshop = await bootstrapBookshop();
  });

  afterAll(async () => {
    await bookshop.stop();
  });

  beforeEach(() => {
    dsl = new BookshopDsl(bookshop.baseUrl, bookshop.emailStubBaseUrl);
  });

  afterEach(async () => {
    await dsl.cleanup();
  });

  it("customer can purchase a book", async () => {
    await dsl.ensureBookIsInStock({
      title: "The Hobbit",
      author: "Tolkien",
      price: 12.99,
    });
    await dsl.ensureCustomerIsRegistered({
      name: "Alice",
      email: "alice@example.com",
    });

    await dsl.loginAsCustomer({ name: "Alice" });
    await dsl.searchForBook({ author: "Tolkien" });
    await dsl.addBookToCart({ title: "The Hobbit" });
    await dsl.checkOut();

    await dsl.assertBookPurchased({ title: "The Hobbit" });
  });

  it("customer is emailed a confirmation after purchase", async () => {
    await dsl.ensureBookIsInStock({
      title: "The Fellowship of the Ring",
      author: "Tolkien",
      price: 14.99,
    });
    await dsl.ensureCustomerIsRegistered({
      name: "Bob",
      email: "bob@example.com",
    });

    await dsl.loginAsCustomer({ name: "Bob" });
    await dsl.searchForBook({ author: "Tolkien" });
    await dsl.addBookToCart({ title: "The Fellowship of the Ring" });
    await dsl.checkOut();

    await dsl.assertOrderConfirmationEmailSentTo("bob@example.com");
  });
});
