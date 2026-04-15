import { prefixedUlid } from "@litmus/core/id";
import {
  type DrizzleDbContext,
  DrizzlePostgresRepository,
} from "@litmus/db/drizzle/postgres";
import { sql } from "drizzle-orm";

import { Customer } from "../domain/customer.ts";
import { customers } from "./schema.ts";

export class CustomerRepository extends DrizzlePostgresRepository<
  Customer,
  typeof customers
> {
  constructor(ctx: DrizzleDbContext) {
    super(ctx, customers);
  }

  nextId() {
    return prefixedUlid("customer");
  }

  protected toPersistence(customer: Customer) {
    return { data: { name: customer.name } };
  }

  async findByName(name: string): Promise<Customer | null> {
    const rows = await this.db
      .select()
      .from(customers)
      .where(sql`${customers.data}->>'name' = ${name}`)
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return new Customer({
      id: row.id,
      name: row.data.name,
      version: row.version,
    });
  }
}
