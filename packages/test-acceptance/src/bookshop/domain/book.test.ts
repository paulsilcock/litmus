import { describe, expect, it } from "vite-plus/test";

import { Book } from "./book.ts";

describe("Book", () => {
  it("exposes its title, author, and price", () => {
    const book = new Book({
      id: "book_1",
      title: "The Hobbit",
      author: "Tolkien",
      price: 12.99,
    });

    expect(book.title).toBe("The Hobbit");
    expect(book.author).toBe("Tolkien");
    expect(book.price).toBe(12.99);
  });
});
