import { CommandHandler, DomainError } from "@litmus/core";
import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { routeHandler } from "#litmus-http/route-handler.ts";
import { serve } from "#litmus-http/serve.ts";

describe("serve", () => {
  it("auto-installs domain error mapping from the errors option", async () => {
    class OrderNotFound extends DomainError {
      constructor() {
        super("ORDER_NOT_FOUND", "Order not found");
      }
    }

    const FindOrderSchema = z.object({});
    type FindOrderQuery = z.infer<typeof FindOrderSchema>;

    class FindOrder extends CommandHandler<FindOrderQuery, void> {
      async handle(_q: FindOrderQuery): Promise<void> {
        throw new OrderNotFound();
      }
    }

    const app = new Hono().post(
      "/orders/find",
      ...routeHandler(FindOrder, FindOrderSchema),
    );

    const server = await serve(app, {
      port: 0,
      errors: { OrderNotFound: 404 },
    });

    try {
      const res = await fetch(`http://localhost:${server.port}/orders/find`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({
        code: "ORDER_NOT_FOUND",
        message: "Order not found",
      });
    } finally {
      await server.stop();
    }
  });

  it("runs onBeforeStop when stopping and closes the server", async () => {
    const app = new Hono().get("/", (c) => c.text("ok"));

    let stopped = false;
    const server = await serve(app, {
      port: 0,
      onBeforeStop: () => {
        stopped = true;
      },
    });

    const res = await fetch(`http://localhost:${server.port}/`);
    expect(res.status).toBe(200);

    await server.stop();

    expect(stopped).toBe(true);
    await expect(fetch(`http://localhost:${server.port}/`)).rejects.toThrow();
  });

  it("rejects and does not start the server if onBeforeStart throws", async () => {
    const app = new Hono().get("/", (c) => c.text("ok"));

    await expect(
      serve(app, {
        port: 0,
        onBeforeStart: () => {
          throw new Error("init failed");
        },
      }),
    ).rejects.toThrow("init failed");
  });

  it("does not accept connections until onBeforeStart completes", async () => {
    const app = new Hono().get("/", (c) => c.text("ok"));

    let completeBeforeStartHandler: () => void = () => {};

    const servePending = serve(app, {
      port: 0,
      onBeforeStart: () =>
        new Promise<void>((resolve) => {
          completeBeforeStartHandler = resolve;
        }),
    });

    completeBeforeStartHandler();
    const server = await servePending;

    try {
      const res = await fetch(`http://localhost:${server.port}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    } finally {
      await server.stop();
    }
  });
});
