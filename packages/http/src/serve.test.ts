import { CommandHandler, DomainError } from "@litmus/core";
import { useInMemoryTracing } from "@litmus/test";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { Hono } from "hono";
import { routePath } from "hono/route";
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

  it("returns a structured body when no route matches the request", async () => {
    const app = new Hono().get("/", (c) => c.text("ok"));
    const server = await serve(app, { port: 0 });

    try {
      const res = await fetch(`http://localhost:${server.port}/missing`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({
        code: "ROUTE_NOT_FOUND",
        message: "Route not found",
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

  it("serves requests normally when no tracing is configured", async () => {
    trace.disable();

    const app = new Hono().get("/", (c) => c.text("ok"));
    const server = await serve(app, { port: 0 });

    try {
      const res = await fetch(`http://localhost:${server.port}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    } finally {
      await server.stop();
    }
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
  const tracing = useInMemoryTracing();

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

    const spans = tracing.spans();
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

    const spans = tracing.spans();
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

    const attributes = tracing.spans()[0]!.attributes;
    expect(attributes["http.request.header.x-tenant-id"]).toBe("tenant-42");
    expect(attributes["http.response.header.x-correlation-id"]).toBe(
      "corr-789",
    );
  });

  it("work performed to fulfil a request is observable as part of the same trace", async () => {
    class PlaceOrder extends CommandHandler<Record<string, never>, void> {
      async handle() {}
    }

    const app = new Hono().post(
      "/orders",
      ...routeHandler(PlaceOrder, z.object({})),
    );

    const server = await serve(app, { port: 0 });

    try {
      const res = await fetch(`http://localhost:${server.port}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(204);
    } finally {
      await server.stop();
    }

    const spans = tracing.spans();
    const request = spans.find((s) => s.name === "POST /orders");
    const handler = spans.find((s) => s.name === "PlaceOrder");
    expect(request).toBeDefined();
    expect(handler).toBeDefined();
    expect(handler!.parentSpanContext?.spanId).toBe(
      request!.spanContext().spanId,
    );
    expect(handler!.spanContext().traceId).toBe(request!.spanContext().traceId);
  });

  it("incoming requests carrying an upstream trace context join that trace", async () => {
    const app = new Hono().get("/", (c) => c.text("ok"));

    const server = await serve(app, { port: 0 });

    const upstreamTraceId = "0af7651916cd43dd8448eb211c80319c";
    const upstreamSpanId = "b7ad6b7169203331";

    try {
      const res = await fetch(`http://localhost:${server.port}/`, {
        headers: {
          traceparent: `00-${upstreamTraceId}-${upstreamSpanId}-01`,
        },
      });
      expect(res.status).toBe(200);
    } finally {
      await server.stop();
    }

    const span = tracing.spans()[0]!;
    expect(span.spanContext().traceId).toBe(upstreamTraceId);
    expect(span.parentSpanContext?.spanId).toBe(upstreamSpanId);
  });

  it("uncaught failures handling a request surface in traces with the error", async () => {
    const app = new Hono().get("/", () => {
      throw new Error("kaboom");
    });

    const server = await serve(app, { port: 0 });

    try {
      const res = await fetch(`http://localhost:${server.port}/`);
      expect(res.status).toBe(500);
    } finally {
      await server.stop();
    }

    const span = tracing.spans()[0]!;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.events[0]?.attributes?.["exception.message"]).toBe("kaboom");
  });

  it("domain failures mapped to 4xx are not flagged as server errors in traces", async () => {
    class OrderNotFound extends DomainError {
      constructor() {
        super("ORDER_NOT_FOUND", "Order not found");
      }
    }

    class FindOrder extends CommandHandler<Record<string, never>, void> {
      async handle() {
        throw new OrderNotFound();
      }
    }

    const app = new Hono().post(
      "/orders/find",
      ...routeHandler(FindOrder, z.object({})),
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
    } finally {
      await server.stop();
    }

    const requestSpan = tracing
      .spans()
      .find((s) => s.name === "POST /orders/find")!;
    expect(requestSpan.status.code).not.toBe(SpanStatusCode.ERROR);
  });

  it("requests that match no route are not flagged as server errors in traces", async () => {
    const app = new Hono().get("/", (c) => c.text("ok"));
    const server = await serve(app, { port: 0 });

    try {
      const res = await fetch(`http://localhost:${server.port}/missing`);
      expect(res.status).toBe(404);
    } finally {
      await server.stop();
    }

    const span = tracing.spans()[0]!;
    expect(span.status.code).not.toBe(SpanStatusCode.ERROR);
  });
});
