import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { eq } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { DrizzleDbContext } from "#litmus/db/drizzle-postgres/db-context.ts";
import { DrizzlePostgresRepository } from "#litmus/db/drizzle-postgres/repository.ts";
import {
  type AggregateData,
  AggregateRoot,
} from "#litmus/domain/aggregate-root.ts";

// --- Test schema ---

const orders = pgTable("orders", {
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

const customers = pgTable("customers", {
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

const schema = { orders, customers };

// --- Test aggregates ---

interface OrderData extends AggregateData {
  status: string;
}

class Order extends AggregateRoot<OrderData> {
  get status() {
    return this.data.status;
  }

  ship() {
    this.data.status = "shipped";
  }

  cancel() {
    this.data.status = "cancelled";
  }
}

interface CustomerData extends AggregateData {
  name: string;
}

class Customer extends AggregateRoot<CustomerData> {
  get name() {
    return this.data.name;
  }
}

// --- Test repositories ---

class CustomerRepository extends DrizzlePostgresRepository<
  Customer,
  typeof customers
> {
  constructor(ctx: DrizzleDbContext) {
    super(ctx, customers);
  }

  protected toPersistence(customer: Customer) {
    return {
      data: { name: customer.name },
    };
  }
}

class OrderRepository extends DrizzlePostgresRepository<Order, typeof orders> {
  constructor(ctx: DrizzleDbContext) {
    super(ctx, orders);
  }

  protected toPersistence(order: Order) {
    return {
      data: { status: order.status },
    };
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

// --- Tests ---

describe("DrizzlePostgresRepository", () => {
  let ctx: DrizzleDbContext;
  let orderRepo: OrderRepository;
  let customerRepo: CustomerRepository;

  beforeEach(async () => {
    const client = new PGlite();

    const rawDb = drizzle(client);
    const { apply } = await pushSchema(schema, rawDb);
    await apply();

    const db = drizzle(client, { schema });
    ctx = new DrizzleDbContext(db);
    orderRepo = new OrderRepository(ctx);
    customerRepo = new CustomerRepository(ctx);
  });

  it("can persist new aggregates", async () => {
    const order = new Order({ id: "order-1", status: "placed" });

    await orderRepo.add(order);

    const rows = await ctx.db
      .select()
      .from(orders)
      .where(eq(orders.id, "order-1"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data.status).toBe("placed");
    expect(rows[0]!.version).toBe(0);
    expect(rows[0]!.createdAt).toBeTruthy();
    expect(rows[0]!.updatedAt).toBeTruthy();
  });

  it("can update existing aggregates", async () => {
    const order = new Order({ id: "order-1", status: "placed" });
    await orderRepo.add(order);

    const found = await orderRepo.findById("order-1");
    found!.ship();
    await orderRepo.update(found!);

    const rows = await ctx.db
      .select()
      .from(orders)
      .where(eq(orders.id, "order-1"));
    expect(rows[0]!.data.status).toBe("shipped");
    expect(rows[0]!.version).toBe(1);
    expect(found!.version).toBe(1);
  });

  it("all modifications within a transaction are persisted", async () => {
    const order = new Order({ id: "order-1", status: "placed" });
    const customer = new Customer({
      id: "customer-1",
      name: "Alice",
    });

    await ctx.transaction(async () => {
      await orderRepo.add(order);
      await customerRepo.add(customer);
    });

    const orderRows = await ctx.db
      .select()
      .from(orders)
      .where(eq(orders.id, "order-1"));
    const customerRows = await ctx.db
      .select()
      .from(customers)
      .where(eq(customers.id, "customer-1"));

    expect(orderRows).toHaveLength(1);
    expect(customerRows).toHaveLength(1);
  });

  it("modifications are discarded if the transaction fails", async () => {
    const order = new Order({ id: "order-1", status: "placed" });

    await expect(
      ctx.transaction(async () => {
        await orderRepo.add(order);
        throw new Error("something went wrong");
      }),
    ).rejects.toThrow("something went wrong");

    const rows = await ctx.db
      .select()
      .from(orders)
      .where(eq(orders.id, "order-1"));
    expect(rows).toHaveLength(0);
  });

  it("rejects stale updates", async () => {
    const order = new Order({ id: "order-1", status: "placed" });
    await orderRepo.add(order);

    const reader1 = await orderRepo.findById("order-1");
    const reader2 = await orderRepo.findById("order-1");

    reader1!.ship();
    await orderRepo.update(reader1!);

    reader2!.cancel();
    await expect(orderRepo.update(reader2!)).rejects.toThrow(
      "ConcurrencyError",
    );
  });
});
