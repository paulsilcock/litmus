import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { BaseHttpDriver } from "#litmus-test/drivers/http.ts";

class TestDriver extends BaseHttpDriver {
  async cleanup() {}
}

const app = new Hono()
  .get("/orders", (c) => {
    const status = c.req.query("status");
    if (status) return c.json([{ id: "order_1", status }]);
    return c.json([{ id: "order_1" }]);
  })
  .post("/orders", async (c) => {
    const body = await c.req.json();
    return c.json({ id: "order_2", ...body }, 201);
  })
  .post("/login", async (c) => {
    const body = await c.req.parseBody();
    return c.json({ username: body.username, authenticated: true });
  })
  .put("/orders/:id", async (c) => {
    const body = await c.req.json();
    return c.json({ id: c.req.param("id"), ...body });
  })
  .patch("/orders/:id", async (c) => {
    const body = await c.req.json();
    return c.json({ id: c.req.param("id"), ...body });
  })
  .delete("/orders/:id", (c) => {
    return c.json({ deleted: c.req.param("id") });
  })
  .post("/raw", async (c) => {
    const text = await c.req.text();
    const type = c.req.header("Content-Type") ?? "unknown";
    return c.json({ received: text, contentType: type });
  });

describe("BaseHttpDriver", () => {
  let server: ReturnType<typeof serve>;
  let driver: TestDriver;

  beforeAll(async () => {
    server = serve({ fetch: app.fetch, port: 0 });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    driver = new TestDriver({ baseUrl: `http://localhost:${port}` });
  });

  afterAll(() => {
    server.close();
  });

  it("makes a GET request to the base URL", async () => {
    const res = await driver.get("/orders");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "order_1" }]);
  });

  it("posts JSON with automatic content-type", async () => {
    const res = await driver.post("/orders", {
      json: { customerId: "cust_1" },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "order_2", customerId: "cust_1" });
  });

  it("posts form data with automatic content-type", async () => {
    const res = await driver.post("/login", {
      form: { username: "alice", password: "secret" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      username: "alice",
      authenticated: true,
    });
  });

  it("posts raw body with custom headers", async () => {
    const res = await driver.post("/raw", {
      body: "<order><id>1</id></order>",
      headers: { "Content-Type": "application/xml" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      received: "<order><id>1</id></order>",
      contentType: "application/xml",
    });
  });

  it("makes a PUT request with JSON body", async () => {
    const res = await driver.put("/orders/order_1", {
      json: { status: "shipped" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "order_1", status: "shipped" });
  });

  it("makes a PATCH request with JSON body", async () => {
    const res = await driver.patch("/orders/order_1", {
      json: { status: "cancelled" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "order_1", status: "cancelled" });
  });

  it("makes a DELETE request", async () => {
    const res = await driver.delete("/orders/order_1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: "order_1" });
  });

  it("appends query params to GET requests", async () => {
    const res = await driver.get("/orders", {
      query: { status: "shipped" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "order_1", status: "shipped" }]);
  });
});
