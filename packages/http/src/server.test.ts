import { CommandHandler, QueryHandler } from "@litmus/core";
import { Hono } from "hono";
import { hc } from "hono/client";
import { describe, expect, test } from "vite-plus/test";
import { z } from "zod";

import { useCase } from "#litmus-http/server.ts";

const PlaceOrderSchema = z.object({
  customerId: z.string(),
  items: z.array(z.object({ productId: z.string(), quantity: z.number() })),
});

type PlaceOrderCommand = z.infer<typeof PlaceOrderSchema>;

class PlaceOrder extends CommandHandler<
  PlaceOrderCommand,
  { orderId: string }
> {
  async handle(cmd: PlaceOrderCommand) {
    return { orderId: `order_${cmd.customerId}` };
  }
}

const GetOrderSchema = z.object({
  id: z.string().startsWith("order_"),
});

type GetOrderQuery = z.infer<typeof GetOrderSchema>;

class GetOrder extends QueryHandler<
  GetOrderQuery,
  { id: string; status: string }
> {
  async handle(query: GetOrderQuery) {
    return { id: query.id, status: "placed" };
  }
}

// Type-level regression: RPC types must be preserved across chained routes.
// If type inference breaks, these property accesses will fail the type check.
{
  const app = new Hono()
    .post("/orders", ...useCase(PlaceOrder, PlaceOrderSchema))
    .get("/items/:id", ...useCase(GetOrder, GetOrderSchema, "param"));

  type AppRoutes = typeof app;
  const client = hc<AppRoutes>("http://localhost:3000");

  void client.orders.$post;
  void client.items[":id"].$get;
}

describe("useCase", () => {
  test("valid input is validated and passed to the handler", async () => {
    const app = new Hono().post(
      "/orders",
      ...useCase(PlaceOrder, PlaceOrderSchema),
    );

    const res = await app.request("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: "cust_1",
        items: [{ productId: "prod_1", quantity: 2 }],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ orderId: "order_cust_1" });
  });

  test("invalid input returns 422 with validation errors", async () => {
    const app = new Hono().post(
      "/orders",
      ...useCase(PlaceOrder, PlaceOrderSchema),
    );

    const res = await app.request("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: 123 }),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toEqual({
      errors: [
        { field: "customerId", message: "Expected string, received number" },
        { field: "items", message: "Required" },
      ],
    });
  });

  test("invalid path params return 422 with validation errors", async () => {
    const app = new Hono().get(
      "/orders/:id",
      ...useCase(GetOrder, GetOrderSchema, "param"),
    );

    const res = await app.request("/orders/bad-id");

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toEqual({
      errors: [
        {
          field: "id",
          message: 'Invalid input: must start with "order_"',
        },
      ],
    });
  });
});
