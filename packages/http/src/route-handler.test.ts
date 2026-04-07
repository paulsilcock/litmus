import {
  CommandHandler,
  DomainError,
  isAsyncIterable,
  QueryHandler,
} from "@litmus/core";
import { Hono } from "hono";
import { hc } from "hono/client";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { domainErrorHandler } from "#litmus-http/error-handler.ts";
import { routeHandler } from "#litmus-http/route-handler.ts";

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
    .post("/orders", ...routeHandler(PlaceOrder, PlaceOrderSchema))
    .get(
      "/items/:id",
      ...routeHandler(GetOrder, GetOrderSchema, { target: "param" }),
    );

  type AppRoutes = typeof app;
  const client = hc<AppRoutes>("http://localhost:3000");

  void client.orders.$post;
  void client.items[":id"].$get;
}

describe("routeHandler", () => {
  it("valid input is validated and passed to the handler", async () => {
    const app = new Hono().post(
      "/orders",
      ...routeHandler(PlaceOrder, PlaceOrderSchema),
    );

    const res = await app.request("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: "cust_1",
        items: [{ productId: "prod_1", quantity: 2 }],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ orderId: "order_cust_1" });
  });

  it("invalid input returns 422 with validation errors", async () => {
    const app = new Hono().post(
      "/orders",
      ...routeHandler(PlaceOrder, PlaceOrderSchema),
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

  it("handler returning void yields 204 with no body", async () => {
    const ShipOrderSchema = z.object({ id: z.string() });
    type ShipOrderCommand = z.infer<typeof ShipOrderSchema>;

    class ShipOrder extends CommandHandler<ShipOrderCommand, void> {
      async handle(_cmd: ShipOrderCommand) {
        // intentionally returns nothing
      }
    }

    const app = new Hono().post(
      "/orders/ship",
      ...routeHandler(ShipOrder, ShipOrderSchema),
    );

    const res = await app.request("/orders/ship", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "order_1" }),
    });

    expect(res.status).toBe(204);
    const text = await res.text();
    expect(text).toBe("");
  });

  describe("default status codes by HTTP verb", () => {
    const NoopSchema = z.object({});
    type NoopInput = z.infer<typeof NoopSchema>;

    class Noop extends CommandHandler<NoopInput, { ok: boolean }> {
      async handle(_input: NoopInput) {
        return { ok: true };
      }
    }

    it("POST defaults to 201", async () => {
      const app = new Hono().post("/x", ...routeHandler(Noop, NoopSchema));
      const res = await app.request("/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(201);
    });

    it("GET defaults to 200", async () => {
      const app = new Hono().get(
        "/x",
        ...routeHandler(Noop, NoopSchema, { target: "query" }),
      );
      const res = await app.request("/x");
      expect(res.status).toBe(200);
    });

    it("PUT defaults to 200", async () => {
      const app = new Hono().put("/x", ...routeHandler(Noop, NoopSchema));
      const res = await app.request("/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(200);
    });

    it("PATCH defaults to 200", async () => {
      const app = new Hono().patch("/x", ...routeHandler(Noop, NoopSchema));
      const res = await app.request("/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(200);
    });

    it("DELETE defaults to 200 when handler returns a body", async () => {
      const app = new Hono().delete(
        "/x",
        ...routeHandler(Noop, NoopSchema, { target: "query" }),
      );
      const res = await app.request("/x", { method: "DELETE" });
      expect(res.status).toBe(200);
    });
  });

  it("can specify response codes for domain errors", async () => {
    class OrderNotFound extends DomainError {
      constructor(id: string) {
        super("ORDER_NOT_FOUND", `Order ${id} not found`);
      }
    }

    const FindOrderSchema = z.object({ id: z.string() });
    type FindOrderQuery = z.infer<typeof FindOrderSchema>;

    class FindOrder extends QueryHandler<FindOrderQuery, { id: string }> {
      async handle(query: FindOrderQuery): Promise<{ id: string }> {
        throw new OrderNotFound(query.id);
      }
    }

    const app = new Hono()
      .onError(domainErrorHandler({ OrderNotFound: 404 }))
      .get(
        "/orders/:id",
        ...routeHandler(FindOrder, FindOrderSchema, { target: "param" }),
      );

    const res = await app.request("/orders/order_missing");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      code: "ORDER_NOT_FOUND",
      message: "Order order_missing not found",
    });
  });

  it("unmapped DomainError defaults to 400", async () => {
    class SomethingWentWrong extends DomainError {
      constructor() {
        super("SOMETHING_WENT_WRONG", "Generic failure");
      }
    }

    const NoopSchema = z.object({});
    type NoopInput = z.infer<typeof NoopSchema>;

    class FailingHandler extends CommandHandler<NoopInput, void> {
      async handle(_input: NoopInput): Promise<void> {
        throw new SomethingWentWrong();
      }
    }

    const app = new Hono()
      .onError(domainErrorHandler({}))
      .post("/x", ...routeHandler(FailingHandler, NoopSchema));

    const res = await app.request("/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      code: "SOMETHING_WENT_WRONG",
      message: "Generic failure",
    });
  });

  it("non-DomainError yields 500 with no body", async () => {
    const NoopSchema = z.object({});
    type NoopInput = z.infer<typeof NoopSchema>;

    class CrashingHandler extends CommandHandler<NoopInput, void> {
      async handle(_input: NoopInput): Promise<void> {
        throw new Error("kaboom");
      }
    }

    const app = new Hono()
      .onError(domainErrorHandler({}))
      .post("/x", ...routeHandler(CrashingHandler, NoopSchema));

    const res = await app.request("/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(500);
  });

  it("streams AsyncIterable results as SSE", async () => {
    const StreamSchema = z.object({ count: z.number() });
    type StreamInput = z.infer<typeof StreamSchema>;

    class StreamTokens extends CommandHandler<StreamInput, { token: string }> {
      async *handle(input: StreamInput): AsyncIterable<{ token: string }> {
        for (let i = 0; i < input.count; i++) {
          yield { token: `tok_${i}` };
        }
      }
    }

    const app = new Hono().post(
      "/stream",
      ...routeHandler(StreamTokens, StreamSchema),
    );

    const res = await app.request("/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: 3 }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const body = await res.text();
    expect(body).toContain('data: {"token":"tok_0"}');
    expect(body).toContain('data: {"token":"tok_1"}');
    expect(body).toContain('data: {"token":"tok_2"}');
  });

  it("respond callback overrides default response handling", async () => {
    const StreamSchema = z.object({ count: z.number() });
    type StreamInput = z.infer<typeof StreamSchema>;

    class StreamTokens extends CommandHandler<StreamInput, { token: string }> {
      async *handle(input: StreamInput): AsyncIterable<{ token: string }> {
        for (let i = 0; i < input.count; i++) {
          yield { token: `tok_${i}` };
        }
      }
    }

    const app = new Hono().post(
      "/stream",
      ...routeHandler(StreamTokens, StreamSchema, {
        respond: async (result, c) => {
          const chunks: string[] = [];
          if (isAsyncIterable<{ token: string }>(result)) {
            for await (const chunk of result) {
              chunks.push(JSON.stringify(chunk));
            }
          }
          return c.body(chunks.join("\n"), 200, {
            "Content-Type": "application/x-ndjson",
          });
        },
      }),
    );

    const res = await app.request("/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: 2 }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");
    const body = await res.text();
    expect(body).toBe('{"token":"tok_0"}\n{"token":"tok_1"}');
  });

  it("explicit status option overrides the default", async () => {
    const app = new Hono().post(
      "/orders",
      ...routeHandler(PlaceOrder, PlaceOrderSchema, { status: 202 }),
    );

    const res = await app.request("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: "cust_1",
        items: [{ productId: "prod_1", quantity: 2 }],
      }),
    });

    expect(res.status).toBe(202);
  });

  it("invalid path params return 422 with validation errors", async () => {
    const app = new Hono().get(
      "/orders/:id",
      ...routeHandler(GetOrder, GetOrderSchema, { target: "param" }),
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
