import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { CommandHandler, QueryHandler } from "#litmus/use-case/handlers.ts";

describe("use case handler tracing", () => {
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

  it("records a span named after the handler class", async () => {
    class PlaceOrder extends CommandHandler<
      { customerId: string },
      { orderId: string }
    > {
      async handle(cmd: { customerId: string }) {
        return { orderId: `order_${cmd.customerId}` };
      }
    }

    await new PlaceOrder().handle({ customerId: "cust_1" });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("PlaceOrder");
  });

  it("marks the span as errored and records the exception when the handler throws", async () => {
    class FailingPlaceOrder extends CommandHandler<
      { customerId: string },
      { orderId: string }
    > {
      async handle(_cmd: { customerId: string }): Promise<{ orderId: string }> {
        throw new Error("boom");
      }
    }

    await expect(
      new FailingPlaceOrder().handle({ customerId: "cust_1" }),
    ).rejects.toThrow("boom");

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
    expect(span!.status.message).toBe("boom");
    expect(span!.events).toHaveLength(1);
    expect(span!.events[0]!.name).toBe("exception");
    expect(span!.events[0]!.attributes?.["exception.message"]).toBe("boom");
  });

  it("runs successfully with no global tracer provider configured", async () => {
    trace.disable();

    class PlaceOrder extends CommandHandler<
      { customerId: string },
      { orderId: string }
    > {
      async handle(cmd: { customerId: string }) {
        return { orderId: `order_${cmd.customerId}` };
      }
    }

    const result = await new PlaceOrder().handle({ customerId: "cust_1" });

    expect(result).toEqual({ orderId: "order_cust_1" });
  });

  it("exposes the handler's span to the handler body for attaching attributes", async () => {
    class PlaceOrder extends CommandHandler<
      { customerId: string },
      { orderId: string }
    > {
      async handle(cmd: { customerId: string }) {
        const orderId = `order_${cmd.customerId}`;
        trace.getActiveSpan()?.setAttributes({
          "order.customerId": cmd.customerId,
          "order.id": orderId,
        });
        return { orderId };
      }
    }

    await new PlaceOrder().handle({ customerId: "cust_1" });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.attributes["order.customerId"]).toBe("cust_1");
    expect(spans[0]!.attributes["order.id"]).toBe("order_cust_1");
  });

  it("records a span for query handlers too", async () => {
    class GetOrder extends QueryHandler<
      { orderId: string },
      { status: string }
    > {
      async handle(_q: { orderId: string }) {
        return { status: "placed" };
      }
    }

    await new GetOrder().handle({ orderId: "order_1" });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("GetOrder");
  });
});
