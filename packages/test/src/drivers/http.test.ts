import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { BaseHttpDriver } from "#litmus-test/drivers/http.ts";

class TestDriver extends BaseHttpDriver {
  async cleanup() {}
}

const app = new Hono()
  .get("/orders", (c) => c.json([{ id: "order_1" }]))
  .post("/orders", async (c) => {
    const body = await c.req.json();
    return c.json({ id: "order_2", ...body }, 201);
  })
  .post("/login", async (c) => {
    const body = await c.req.parseBody();
    return c.json({ username: body.username, authenticated: true });
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
});
