import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
} from "vite-plus/test";

import { bootstrapBookshop, type RunningBookshop } from "./bookshop.ts";
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
    dsl = new BookshopDsl(bookshop.baseUrl);
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
