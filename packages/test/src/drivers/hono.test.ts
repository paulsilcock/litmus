import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { BaseHonoDriver } from "#litmus-test/drivers/hono.ts";

const app = new Hono().get("/orders", (c) => c.json([{ id: "order_1" }]));

type App = typeof app;

class TestDriver extends BaseHonoDriver<App> {
  async listOrders() {
    const res = await this.client.orders.$get();
    return res.json();
  }
  async cleanup() {}
}

describe("BaseHonoDriver", () => {
  let server: ReturnType<typeof serve>;
  let driver: TestDriver;

  beforeAll(() => {
    server = serve({ fetch: app.fetch, port: 0 });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    driver = new TestDriver({ baseUrl: `http://localhost:${port}` });
  });

  afterAll(() => {
    server.close();
  });

  it("subclasses can make type-safe requests via the hono client", async () => {
    const orders = await driver.listOrders();

    expect(orders).toEqual([{ id: "order_1" }]);
  });
});
