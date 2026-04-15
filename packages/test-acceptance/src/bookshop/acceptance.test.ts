import { afterEach, beforeEach, describe, it } from "vite-plus/test";

import { BookshopDsl } from "./dsl.ts";

describe("bookshop", () => {
  let dsl: BookshopDsl;

  beforeEach(async () => {
    dsl = new BookshopDsl();
    await dsl.init();
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
    await dsl.ensureCustomerIsRegistered({ name: "Alice" });

    await dsl.loginAsCustomer({ name: "Alice" });
    await dsl.searchForBook({ author: "Tolkien" });
    await dsl.addBookToCart({ title: "The Hobbit" });
    await dsl.checkOut();

    await dsl.assertBookPurchased({ title: "The Hobbit" });
  });
});
