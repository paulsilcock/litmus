import { QueryHandler } from "@litmus/core";
import type { DrizzleDbContext } from "@litmus/db/drizzle/postgres";
import { sql } from "drizzle-orm";
import { inject, injectable } from "tsyringe";

import type { Book } from "../domain/book.ts";
import type { Customer } from "../domain/customer.ts";
import { purchases } from "../infra/schema.ts";

interface CustomerLookup {
  findByName(name: string): Promise<Customer | null>;
}

interface BookLookup {
  findByTitle(title: string): Promise<Book | null>;
}

interface HasPurchasedQuery extends Record<string, unknown> {
  customer: string;
  title: string;
}

@injectable()
export class HasPurchased extends QueryHandler<HasPurchasedQuery, boolean> {
  constructor(
    @inject("DrizzleDbContext") private readonly ctx: DrizzleDbContext,
    @inject("CustomerLookup") private readonly customers: CustomerLookup,
    @inject("BookLookup") private readonly books: BookLookup,
  ) {
    super();
  }

  async handle({ customer, title }: HasPurchasedQuery): Promise<boolean> {
    const c = await this.customers.findByName(customer);
    if (!c) return false;
    const b = await this.books.findByTitle(title);
    if (!b) return false;

    const rows = await this.ctx.connection
      .select({ id: purchases.id })
      .from(purchases)
      .where(
        sql`${purchases.data}->>'customerId' = ${c.id} AND ${purchases.data}->>'bookId' = ${b.id}`,
      )
      .limit(1);

    return rows.length > 0;
  }
}
