import { container } from "tsyringe";
import { describe, expect, it } from "vite-plus/test";

import { Book, BookNotFound } from "../../domain/book.ts";
import { setupBookshopTest } from "../../test-support/init-test-container.ts";
import { BookRepository } from "./book-repository.ts";

describe("BookRepository", () => {
  setupBookshopTest();

  it("finds a book by title", async () => {
    const books = container.resolve(BookRepository);
    const hobbit = new Book({
      id: books.nextId(),
      title: "The Hobbit",
      author: "Tolkien",
      price: 12.99,
    });
    await books.add(hobbit);

    const found = await books.findByTitle("The Hobbit");

    expect(found.id).toBe(hobbit.id);
  });

  it("throws BookNotFound when no book matches the title", async () => {
    const books = container.resolve(BookRepository);

    await expect(books.findByTitle("Nonexistent")).rejects.toBeInstanceOf(
      BookNotFound,
    );
  });
});
