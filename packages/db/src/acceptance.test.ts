import { PGlite } from "@electric-sql/pglite";
import { DomainEventDispatcher } from "@litmus/core/events";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DrizzleDbContext } from "#litmus-db/drizzle/postgres/db-context.ts";
import {
  Customer,
  CustomerCreated,
  CustomerRepository,
  Order,
  OrderPlaced,
  OrderRepository,
  schema,
} from "#litmus-db/test-support/fixtures.ts";

describe("saving aggregates with domain events", () => {
  let ctx: DrizzleDbContext;
  let orderRepo: OrderRepository;
  let customerRepo: CustomerRepository;
  let dispatcher: DomainEventDispatcher;

  beforeEach(async () => {
    const client = new PGlite();
    const rawDb = drizzle(client);
    const { apply } = await pushSchema(schema, rawDb);
    await apply();

    const db = drizzle(client, { schema });
    dispatcher = new DomainEventDispatcher();
    ctx = new DrizzleDbContext(db, dispatcher);
    orderRepo = new OrderRepository(ctx);
    customerRepo = new CustomerRepository(ctx);
  });

  it("event handlers are called after saving", async () => {
    const handler = vi.fn();
    dispatcher.on(OrderPlaced, handler);

    const id = orderRepo.nextId();
    const order = new Order({ id, status: "draft" });
    order.place();
    await orderRepo.add(order);

    expect(handler).toHaveBeenCalledOnce();
    expect(order.domainEvents).toHaveLength(0);
  });

  it("event handlers are called after a transaction commits", async () => {
    const orderHandler = vi.fn();
    const customerHandler = vi.fn();
    dispatcher.on(OrderPlaced, orderHandler);
    dispatcher.on(CustomerCreated, customerHandler);

    await ctx.transaction(async () => {
      const order = new Order({
        id: orderRepo.nextId(),
        status: "draft",
      });
      order.place();
      await orderRepo.add(order);

      const customer = new Customer({
        id: customerRepo.nextId(),
        name: "Alice",
      });
      customer.register();
      await customerRepo.add(customer);

      expect(orderHandler).not.toHaveBeenCalled();
      expect(customerHandler).not.toHaveBeenCalled();
    });

    expect(orderHandler).toHaveBeenCalledOnce();
    expect(customerHandler).toHaveBeenCalledOnce();
  });
});
