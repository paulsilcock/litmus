import { PGlite } from "@electric-sql/pglite";
import { DomainEventDispatcher } from "@litmus/core/events";
import { DrizzleDbContext } from "@litmus/db/drizzle/postgres";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { Book } from "../domain/book.ts";
import { BookRepository } from "../infra/book-repository.ts";
import { schema } from "../infra/schema.ts";
import { SearchBooksByAuthor } from "./search-books-by-author.ts";

describe("SearchBooksByAuthor", () => {
  let ctx: DrizzleDbContext;
  let bookRepo: BookRepository;
  let handler: SearchBooksByAuthor;

  beforeEach(async () => {
    const pg = new PGlite();
    const rawDb = drizzle(pg);
    const { apply } = await pushSchema(schema, rawDb);
    await apply();

    const db = drizzle(pg, { schema });
    ctx = new DrizzleDbContext(db, new DomainEventDispatcher());
    bookRepo = new BookRepository(ctx);
    handler = new SearchBooksByAuthor(ctx);
  });

  it("returns books whose author matches (case-insensitive)", async () => {
    await bookRepo.add(
      new Book({
        id: "book_1",
        title: "The Hobbit",
        author: "Tolkien",
        price: 12.99,
      }),
    );
    await bookRepo.add(
      new Book({
        id: "book_2",
        title: "Dune",
        author: "Herbert",
        price: 14.5,
      }),
    );

    const results = await handler.handle({ author: "tolkien" });

    expect(results).toEqual([
      { title: "The Hobbit", author: "Tolkien", price: 12.99 },
    ]);
  });

  it("returns an empty list when no books match", async () => {
    const results = await handler.handle({ author: "asimov" });

    expect(results).toEqual([]);
  });
});
