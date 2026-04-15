import { QueryHandler } from "@litmus/core";
import { DrizzleDbContext } from "@litmus/db/drizzle/postgres";
import { sql } from "drizzle-orm";
import { injectable } from "tsyringe";

import { orders } from "../infra/db/schema.ts";
import { CustomerRepository } from "../infra/repositories/customer-repository.ts";

interface GetCustomerOrdersQuery extends Record<string, unknown> {
  customer: string;
}

interface OrderSummary {
  id: string;
  status: string;
  total: number;
  lines: Array<{ title: string; price: number }>;
}

@injectable()
export class GetCustomerOrders extends QueryHandler<
  GetCustomerOrdersQuery,
  OrderSummary[]
> {
  constructor(
    private readonly ctx: DrizzleDbContext,
    private readonly customers: CustomerRepository,
  ) {
    super();
  }

  async handle({ customer }: GetCustomerOrdersQuery): Promise<OrderSummary[]> {
    const c = await this.customers.findByName(customer);
    if (!c) return [];

    const rows = await this.ctx.connection
      .select()
      .from(orders)
      .where(sql`${orders.data}->>'customerId' = ${c.id}`)
      .orderBy(orders.createdAt);

    return rows.map((row) => {
      const cents = row.data.lines.reduce(
        (sum, line) => sum + Math.round(line.price * 100),
        0,
      );
      return {
        id: row.id,
        status: row.data.status,
        total: cents / 100,
        lines: row.data.lines.map((line) => ({
          title: line.title,
          price: line.price,
        })),
      };
    });
  }
}
