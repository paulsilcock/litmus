import { prefixedUlid } from "@litmus/core/id";
import {
  DrizzleDbContext,
  DrizzlePostgresRepository,
} from "@litmus/db/drizzle/postgres";
import { eq } from "drizzle-orm";
import { singleton } from "tsyringe";

import type { CustomerId } from "../../domain/customer.ts";
import { Customer, CustomerNotFound } from "../../domain/customer.ts";
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
    return { name: customer.name, email: customer.email };
  }

  async findByEmail(email: string): Promise<Customer> {
    const rows = await this.db
      .select()
      .from(customers)
      .where(eq(customers.email, email))
      .limit(1);
    const row = rows[0];
    if (!row) throw new CustomerNotFound({ email });
    return this.hydrate(row);
  }

  async findById(id: CustomerId): Promise<Customer> {
    const rows = await this.db
      .select()
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new CustomerNotFound({ id });
    return this.hydrate(row);
  }

  private hydrate(row: {
    id: CustomerId;
    name: string;
    email: string;
    version: number;
  }): Customer {
    return new Customer({
      id: row.id,
      name: row.name,
      email: row.email,
      version: row.version,
    });
  }
}
