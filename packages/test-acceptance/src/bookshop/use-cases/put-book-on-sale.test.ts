import { describe, expect, it } from "vite-plus/test";

import type { Book } from "../domain/book.ts";
import { PutBookOnSale } from "./put-book-on-sale.ts";

describe("PutBookOnSale", () => {
  it("records a new book with its title, author, and price", async () => {
    const saved: Book[] = [];
    const handler = new PutBookOnSale({
      nextId: () => "book_1",
      add: async (book) => {
        saved.push(book);
      },
    });

    await handler.handle({
      title: "The Hobbit",
      author: "Tolkien",
      price: 12.99,
    });

    expect(saved).toHaveLength(1);
    expect(saved[0]?.title).toBe("The Hobbit");
    expect(saved[0]?.author).toBe("Tolkien");
    expect(saved[0]?.price).toBe(12.99);
  });
});
