import { PGlite } from "@electric-sql/pglite";
import { DomainEventDispatcher } from "@litmus/core/events";
import { pushSchema } from "drizzle-kit/api";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { DrizzleDbContext } from "#litmus-db/drizzle/postgres/db-context.ts";
import {
  Customer,
  CustomerRepository,
  Order,
  OrderRepository,
  customers,
  orders,
  schema,
} from "#litmus-db/test-support/fixtures.ts";

describe("DrizzlePostgresRepository", () => {
  let ctx: DrizzleDbContext;
  let orderRepo: OrderRepository;
  let customerRepo: CustomerRepository;

  beforeAll(async () => {
    const client = new PGlite();
    const rawDb = drizzle(client);
    const { apply } = await pushSchema(schema, rawDb);
    await apply();

    const db = drizzle(client, { schema });
    ctx = new DrizzleDbContext(db, new DomainEventDispatcher());
    orderRepo = new OrderRepository(ctx);
    customerRepo = new CustomerRepository(ctx);
  });

  beforeEach(async () => {
    await ctx.db.execute(sql`TRUNCATE orders, customers`);
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

  it("drains domain events from aggregate after add", async () => {
    const order = new Order({ id: "order-1", status: "draft" });
    order.place();
    expect(order.domainEvents).toHaveLength(1);

    await orderRepo.add(order);

    expect(order.domainEvents).toHaveLength(0);
  });

  it("drains domain events from aggregate after update", async () => {
    const order = new Order({ id: "order-1", status: "placed" });
    await orderRepo.add(order);

    const found = await orderRepo.findById("order-1");
    found!.ship();
    expect(found!.domainEvents).toHaveLength(1);

    await orderRepo.update(found!);

    expect(found!.domainEvents).toHaveLength(0);
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
