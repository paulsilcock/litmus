import { type AggregateData, AggregateRoot, DomainEvent } from "@litmus/core";
import { prefixedUlid } from "@litmus/core/id";
import { eq } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import type { DrizzleDbContext } from "#litmus-db/drizzle/postgres/db-context.ts";
import { DrizzlePostgresRepository } from "#litmus-db/drizzle/postgres/repository.ts";

// --- Schema ---

export const orders = pgTable("orders", {
  id: varchar("id").primaryKey(),
  data: jsonb("data").notNull().$type<{ status: string }>(),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const customers = pgTable("customers", {
  id: varchar("id").primaryKey(),
  data: jsonb("data").notNull().$type<{ name: string }>(),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const schema = { orders, customers };

// --- Aggregates ---

interface OrderData extends AggregateData {
  status: string;
}

export class Order extends AggregateRoot<OrderData> {
  get status() {
    return this.data.status;
  }

  place() {
    this.data.status = "placed";
    this.addDomainEvent(new OrderPlaced());
  }

  ship() {
    this.data.status = "shipped";
    this.addDomainEvent(new OrderShipped());
  }

  cancel() {
    this.data.status = "cancelled";
  }
}

interface CustomerData extends AggregateData {
  name: string;
}

export class Customer extends AggregateRoot<CustomerData> {
  get name() {
    return this.data.name;
  }

  register() {
    this.addDomainEvent(new CustomerCreated());
  }
}

// --- Domain Events ---

export class OrderPlaced extends DomainEvent<Order> {}
export class OrderShipped extends DomainEvent<Order> {}
export class CustomerCreated extends DomainEvent<Customer> {}

// --- Repositories ---

export class OrderRepository extends DrizzlePostgresRepository<
  Order,
  typeof orders
> {
  constructor(ctx: DrizzleDbContext) {
    super(ctx, orders);
  }

  nextId() {
    return prefixedUlid("order");
  }

  protected toPersistence(order: Order) {
    return { data: { status: order.status } };
  }

  async findById(id: string): Promise<Order | null> {
    const rows = await this.db
      .select()
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);
    if (!rows[0]) return null;
    return new Order({
      id: rows[0].id,
      status: rows[0].data.status,
      version: rows[0].version,
    });
  }
}

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
}
