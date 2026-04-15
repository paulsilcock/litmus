import { QueryHandler } from "@litmus/core";
import { DrizzleDbContext } from "@litmus/db/drizzle/postgres";
import { sql } from "drizzle-orm";
import { injectable } from "tsyringe";

import { orders } from "../infra/db/schema.ts";
import { BookRepository } from "../infra/repositories/book-repository.ts";
import { CustomerRepository } from "../infra/repositories/customer-repository.ts";

interface HasPurchasedQuery extends Record<string, unknown> {
  customer: string;
  title: string;
}

@injectable()
export class HasPurchased extends QueryHandler<HasPurchasedQuery, boolean> {
  constructor(
    private readonly ctx: DrizzleDbContext,
    private readonly customers: CustomerRepository,
    private readonly books: BookRepository,
  ) {
    super();
  }

  async handle({ customer, title }: HasPurchasedQuery): Promise<boolean> {
    const c = await this.customers.findByName(customer);
    if (!c) return false;
    const b = await this.books.findByTitle(title);
    if (!b) return false;

    const containsBook = sql`${orders.data}->'lines' @> ${JSON.stringify([{ bookId: b.id }])}::jsonb`;
    const rows = await this.ctx.connection
      .select({ id: orders.id })
      .from(orders)
      .where(sql`${orders.data}->>'customerId' = ${c.id} AND ${containsBook}`)
      .limit(1);

    return rows.length > 0;
  }
}
