import { container } from "tsyringe";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { Book } from "../domain/book.ts";
import { BookRepository } from "../infra/repositories/book-repository.ts";
import { initBookshopTestContainer } from "../test-support/init-test-container.ts";
import { SearchBooksByAuthor } from "./search-books-by-author.ts";

describe("SearchBooksByAuthor", () => {
  beforeEach(async () => {
    await initBookshopTestContainer();
  });

  afterEach(() => {
    container.reset();
  });

  it("matches author name case-insensitively", async () => {
    const books = container.resolve(BookRepository);
    await books.add(
      new Book({
        id: books.nextId(),
        title: "The Hobbit",
        author: "Tolkien",
        price: 12.99,
      }),
    );

    const results = await container
      .resolve(SearchBooksByAuthor)
      .handle({ author: "TOLKIEN" });

    expect(results).toEqual([
      { title: "The Hobbit", author: "Tolkien", price: 12.99 },
    ]);
  });
});
