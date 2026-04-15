import { prefixedUlid } from "@litmus/core/id";
import {
  DrizzleDbContext,
  DrizzlePostgresRepository,
} from "@litmus/db/drizzle/postgres";
import { eq } from "drizzle-orm";
import { singleton } from "tsyringe";

import { Book } from "../../domain/book.ts";
import { books } from "../db/schema.ts";

@singleton()
export class BookRepository extends DrizzlePostgresRepository<
  Book,
  typeof books
> {
  constructor(ctx: DrizzleDbContext) {
    super(ctx, books);
  }

  nextId() {
    return prefixedUlid("book");
  }

  protected toPersistence(book: Book) {
    return {
      title: book.title,
      author: book.author,
      price: book.price,
    };
  }

  async findByTitle(title: string): Promise<Book | null> {
    const rows = await this.db
      .select()
      .from(books)
      .where(eq(books.title, title))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return new Book({
      id: row.id,
      title: row.title,
      author: row.author,
      price: row.price,
      version: row.version,
    });
  }
}
