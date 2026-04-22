import { CommandHandler, DomainError } from "@litmus/core";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Hono } from "hono";
import { routePath } from "hono/route";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
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

describe("serve tracing", () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
  });

  afterEach(async () => {
    trace.disable();
    context.disable();
    await provider.shutdown();
  });

  it("incoming requests are observable in traces by the route they hit", async () => {
    const app = new Hono().get("/users/:id", (c) =>
      c.json({ id: c.req.param("id") }),
    );

    const server = await serve(app, { port: 0 });

    try {
      const res = await fetch(`http://localhost:${server.port}/users/123`);
      expect(res.status).toBe(200);
    } finally {
      await server.stop();
    }

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("GET /users/:id");
  });

  it("callers can override how incoming requests are labelled in traces", async () => {
    const app = new Hono().get("/users/:id", (c) =>
      c.json({ id: c.req.param("id") }),
    );

    const server = await serve(app, {
      port: 0,
      tracing: {
        spanName: (c) => `user.lookup ${routePath(c)}`,
      },
    });

    try {
      const res = await fetch(`http://localhost:${server.port}/users/123`);
      expect(res.status).toBe(200);
    } finally {
      await server.stop();
    }

    const spans = exporter.getFinishedSpans();
    expect(spans[0]!.name).toBe("user.lookup /users/:id");
  });

  it("nominated request and response headers are recorded against the trace", async () => {
    const app = new Hono().get("/", (c) => {
      c.header("x-correlation-id", "corr-789");
      return c.text("ok");
    });

    const server = await serve(app, {
      port: 0,
      tracing: {
        captureRequestHeaders: ["x-tenant-id"],
        captureResponseHeaders: ["x-correlation-id"],
      },
    });

    try {
      const res = await fetch(`http://localhost:${server.port}/`, {
        headers: { "x-tenant-id": "tenant-42" },
      });
      expect(res.status).toBe(200);
    } finally {
      await server.stop();
    }

    const attributes = exporter.getFinishedSpans()[0]!.attributes;
    expect(attributes["http.request.header.x-tenant-id"]).toBe("tenant-42");
    expect(attributes["http.response.header.x-correlation-id"]).toBe(
      "corr-789",
    );
  });
});
