import { QueryHandler } from "@litmus/core";
import { DrizzleDbContext } from "@litmus/db/drizzle/postgres";
import { sql } from "drizzle-orm";
import { injectable } from "tsyringe";
import { z } from "zod";

import { books } from "#bookshop/infra/db/schema.ts";

export const SearchBooksByAuthorSchema = z.object({
  author: z.string(),
});

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
        title: books.title,
        author: books.author,
        price: books.price,
      })
      .from(books)
      .where(sql`LOWER(${books.author}) = LOWER(${author})`);

    return rows;
  }
}
