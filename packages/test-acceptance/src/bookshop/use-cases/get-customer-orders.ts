import { QueryHandler } from "@litmus/core";
import { DrizzleDbContext } from "@litmus/db/drizzle/postgres";
import { eq } from "drizzle-orm";
import { injectable } from "tsyringe";
import { z } from "zod";

import { orders } from "#bookshop/infra/db/schema.ts";
import { CustomerRepository } from "#bookshop/infra/repositories/customer-repository.ts";

export const GetCustomerOrdersSchema = z.object({
  customerEmail: z.string().email(),
});

interface GetCustomerOrdersQuery extends Record<string, unknown> {
  customerEmail: string;
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

  async handle({
    customerEmail,
  }: GetCustomerOrdersQuery): Promise<OrderSummary[]> {
    const customer = await this.customers.findByEmail(customerEmail);

    const rows = await this.ctx.connection
      .select()
      .from(orders)
      .where(eq(orders.customerId, customer.id))
      .orderBy(orders.createdAt);

    return rows.map((row) => {
      const cents = row.lines.reduce(
        (sum, line) => sum + Math.round(line.price * 100),
        0,
      );
      return {
        id: row.id,
        status: row.status,
        total: cents / 100,
        lines: row.lines.map((line) => ({
          title: line.title,
          price: line.price,
        })),
      };
    });
  }
}
