import { useInMemoryTracing } from "@litmus/test";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { describe, expect, it } from "vite-plus/test";

import { CommandHandler } from "#litmus/use-case/handlers.ts";

describe("use case handler tracing", () => {
  const tracing = useInMemoryTracing();

  it("each handler invocation is individually observable", async () => {
    class PlaceOrder extends CommandHandler<
      { customerId: string },
      { orderId: string }
    > {
      async handle(cmd: { customerId: string }) {
        return { orderId: `order_${cmd.customerId}` };
      }
    }

    await new PlaceOrder().handle({ customerId: "cust_1" });

    const spans = tracing.spans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("PlaceOrder");
  });

  it("failures surface in traces with the underlying error", async () => {
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

    const span = tracing.spans()[0]!;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe("boom");
    expect(span.events[0]?.attributes?.["exception.message"]).toBe("boom");
  });

  it("handlers behave normally when tracing is not configured", async () => {
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

  it("handlers can attach domain context to their trace", async () => {
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

    const attributes = tracing.spans()[0]!.attributes;
    expect(attributes["order.customerId"]).toBe("cust_1");
    expect(attributes["order.id"]).toBe("order_cust_1");
  });
});
