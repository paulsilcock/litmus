import { QueryHandler } from "@litmus/core";
import { DrizzleDbContext } from "@litmus/db/drizzle/postgres";
import { sql } from "drizzle-orm";
import { injectable } from "tsyringe";

import { books } from "../infra/db/schema.ts";

interface SearchBooksByAuthorQuery extends Record<string, unknown> {
  author: string;
}

interface SearchResult {
  title: string;
  author: string;
  price: number;
}

@injectable()
export class SearchBooksByAuthor extends QueryHandler<
  SearchBooksByAuthorQuery,
  SearchResult[]
> {
  constructor(private readonly ctx: DrizzleDbContext) {
    super();
  }

  async handle({ author }: SearchBooksByAuthorQuery): Promise<SearchResult[]> {
    const rows = await this.ctx.connection
      .select({
        title: sql<string>`${books.data}->>'title'`,
        author: sql<string>`${books.data}->>'author'`,
        price: sql<number>`(${books.data}->>'price')::numeric`,
      })
      .from(books)
      .where(sql`LOWER(${books.data}->>'author') = LOWER(${author})`);

    return rows.map((row) => ({
      title: row.title,
      author: row.author,
      price: Number(row.price),
    }));
  }
}
