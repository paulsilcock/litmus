import { prefixedUlid } from "@litmus/core/id";
import {
  DrizzleDbContext,
  DrizzlePostgresRepository,
} from "@litmus/db/drizzle/postgres";
import { eq } from "drizzle-orm";
import { singleton } from "tsyringe";

import { Customer } from "../../domain/customer.ts";
import { customers } from "../db/schema.ts";

@singleton()
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
    return { name: customer.name };
  }

  async findByName(name: string): Promise<Customer | null> {
    const rows = await this.db
      .select()
      .from(customers)
      .where(eq(customers.name, name))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return new Customer({
      id: row.id,
      name: row.name,
      version: row.version,
    });
  }
}
