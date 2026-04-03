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
import { type PgliteDatabase, drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { DrizzlePostgresRepository } from "#litmus/db/drizzle-postgres/repository.ts";
import { DrizzleTransaction } from "#litmus/db/drizzle-postgres/transaction.ts";
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
type Db = PgliteDatabase<typeof schema>;

// --- Test aggregate ---

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
  typeof schema,
  typeof customers
> {
  constructor(db: Db) {
    super(db, customers);
  }

  protected toPersistence(customer: Customer) {
    return {
      data: { name: customer.name },
    };
  }
}

class OrderRepository extends DrizzlePostgresRepository<
  Order,
  typeof schema,
  typeof orders
> {
  constructor(db: Db) {
    super(db, orders);
  }

  protected toPersistence(order: Order) {
    return {
      data: {
        status: order.status,
      },
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
  let db: Db;
  let orederRepo: OrderRepository;
  let customerRepo: CustomerRepository;
  let tx: DrizzleTransaction;

  beforeEach(async () => {
    const client = new PGlite();

    const rawDb = drizzle(client);
    const { apply } = await pushSchema(schema, rawDb);
    await apply();

    db = drizzle(client, { schema });
    orederRepo = new OrderRepository(db);
    customerRepo = new CustomerRepository(db);
    tx = new DrizzleTransaction(db);
  });

  it("can persist new aggregates", async () => {
    const order = new Order({ id: "order-1", status: "placed" });

    await orederRepo.add(order);

    const rows = await db.select().from(orders).where(eq(orders.id, "order-1"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data.status).toBe("placed");
    expect(rows[0]!.version).toBe(0);
    expect(rows[0]!.createdAt).toBeTruthy();
    expect(rows[0]!.updatedAt).toBeTruthy();
  });

  it("can update existing aggregates", async () => {
    const order = new Order({ id: "order-1", status: "placed" });
    await orederRepo.add(order);

    const found = await orederRepo.findById("order-1");
    found!.ship();
    await orederRepo.update(found!);

    const rows = await db.select().from(orders).where(eq(orders.id, "order-1"));
    expect(rows[0]!.data.status).toBe("shipped");
    expect(rows[0]!.version).toBe(1);
    expect(found!.version).toBe(1);
  });

  it("all modifications within a transaction are persisted", async () => {
    const order = new Order({ id: "order-1", status: "placed" });
    const customer = new Customer({ id: "customer-1", name: "Alice" });

    await tx.execute(async () => {
      await orederRepo.add(order);
      await customerRepo.add(customer);
    });

    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.id, "order-1"));
    const customerRows = await db
      .select()
      .from(customers)
      .where(eq(customers.id, "customer-1"));

    expect(orderRows).toHaveLength(1);
    expect(customerRows).toHaveLength(1);
  });

  it("modifications are discarded if the transaction fails", async () => {
    const order = new Order({ id: "order-1", status: "placed" });

    await expect(
      tx.execute(async () => {
        await orederRepo.add(order);
        throw new Error("something went wrong");
      }),
    ).rejects.toThrow("something went wrong");

    const rows = await db.select().from(orders).where(eq(orders.id, "order-1"));
    expect(rows).toHaveLength(0);
  });

  it("rejects stale updates", async () => {
    const order = new Order({ id: "order-1", status: "placed" });
    await orederRepo.add(order);

    const reader1 = await orederRepo.findById("order-1");
    const reader2 = await orederRepo.findById("order-1");

    reader1!.ship();
    await orederRepo.update(reader1!);

    reader2!.cancel();
    await expect(orederRepo.update(reader2!)).rejects.toThrow(
      "ConcurrencyError",
    );
  });
});
