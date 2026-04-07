import { CommandHandler, DomainError } from "@litmus/core";
import getPort from "get-port";
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
    const port = await getPort();

    const server = await serve(app, {
      port,
      errors: { OrderNotFound: 404 },
    });

    try {
      const res = await fetch(`http://localhost:${port}/orders/find`, {
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
    const port = await getPort();

    let stopped = false;
    const server = await serve(app, {
      port,
      onBeforeStop: () => {
        stopped = true;
      },
    });

    // Server is listening.
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);

    await server.stop();

    expect(stopped).toBe(true);
    // Nothing should be listening any more.
    await expect(fetch(`http://localhost:${port}/`)).rejects.toThrow();
  });

  it("rejects and does not start the server if onBeforeStart throws", async () => {
    const app = new Hono().get("/", (c) => c.text("ok"));
    const port = await getPort();

    const initError = new Error("init failed");

    await expect(
      serve(app, {
        port,
        onBeforeStart: () => {
          throw initError;
        },
      }),
    ).rejects.toThrow("init failed");

    // Nothing should be listening on the port.
    await expect(fetch(`http://localhost:${port}/`)).rejects.toThrow();
  });

  it("does not accept connections until onBeforeStart completes", async () => {
    const app = new Hono().get("/", (c) => c.text("ok"));
    const port = await getPort();

    let completeBeforeStartHandler: () => void = () => {};

    const servePending = serve(app, {
      port,
      onBeforeStart: () =>
        new Promise<void>((resolve) => {
          completeBeforeStartHandler = resolve;
        }),
    });

    // While onBeforeStart is pending, the port should refuse connections.
    await expect(fetch(`http://localhost:${port}/`)).rejects.toThrow();

    completeBeforeStartHandler();
    const server = await servePending;

    try {
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    } finally {
      await server.stop();
    }
  });
});
