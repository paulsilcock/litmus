import { useInMemoryTracing } from "@litmus/test";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { Agent, Toolbox } from "#litmus/ai.ts";

const schema = z.object({ id: z.string() });

class GetBalance {
  async handle(_input: { id: string }) {
    return { balance: 100 };
  }
}

describe("Toolbox", () => {
  // Type-level regression: pick only accepts registered tool names.
  // If the constraint is removed, @ts-expect-error will fail the type check.
  const typed = new Toolbox().tool("getBalance", GetBalance, schema, {
    description: "Get balance",
  });
  // @ts-expect-error — "nonExistent" is not a registered tool name
  typed.pick("nonExistent");

  it("registers a tool and exposes it via pick", () => {
    const toolbox = new Toolbox().tool("getBalance", GetBalance, schema, {
      description: "Get account balance",
    });

    const selection = toolbox.pick("getBalance");
    const entries = selection.entries();

    expect(entries.size).toBe(1);
    expect(entries.get("getBalance")?.description).toBe("Get account balance");
  });

  it("pick returns only the selected tools", () => {
    const toolbox = new Toolbox()
      .tool("getBalance", GetBalance, schema, {
        description: "Get balance",
      })
      .tool("transfer", GetBalance, schema, {
        description: "Transfer funds",
      })
      .tool("closeAccount", GetBalance, schema, {
        description: "Close account",
      });

    const selection = toolbox.pick("getBalance", "transfer");
    const entries = selection.entries();

    expect(entries.size).toBe(2);
    expect(entries.has("getBalance")).toBe(true);
    expect(entries.has("transfer")).toBe(true);
    expect(entries.has("closeAccount")).toBe(false);
  });

  it("tool handler is callable through picked selection", async () => {
    const toolbox = new Toolbox().tool("getBalance", GetBalance, schema, {
      description: "Get balance",
    });

    const entry = toolbox.pick("getBalance").entries().get("getBalance");
    expect(entry).toBeDefined();

    const result = await entry?.handler.handle({ id: "acc_123" });
    expect(result).toEqual({ balance: 100 });
  });
});

describe("tools with trusted parameters", () => {
  const cancelOrderSchema = z.object({
    orderId: z.string(),
    userId: z.string(),
  });

  let received: unknown;

  class CancelOrder {
    async handle(input: { orderId: string; userId: string }) {
      received = input;
      return { cancelled: true };
    }
  }

  // Type-level regression: trusted values must match the declared
  // trusted params exactly. If the constraint is removed, the
  // expect-error directives below fail the type check.
  const typedSelection = new Toolbox()
    .tool("cancelOrder", CancelOrder, cancelOrderSchema, {
      description: "Cancel an order",
      trustedParams: ["userId"],
    })
    .pick("cancelOrder");
  // @ts-expect-error — a binding for "cancelOrder" is required
  typedSelection.withTrustedValues({});
  // @ts-expect-error — the trusted value for "userId" is missing
  typedSelection.withTrustedValues({ cancelOrder: {} });
  // @ts-expect-error — "sessionId" is not a declared trusted param
  typedSelection.withTrustedValues({ cancelOrder: { sessionId: "s_1" } });
  // @ts-expect-error — "getBalance" is not a tool with trusted params
  typedSelection.withTrustedValues({ getBalance: { userId: "user_123" } });

  it("tools can be invoked without the LLM supplying every parameter — the application fills in the rest at runtime", async () => {
    const toolbox = new Toolbox().tool(
      "cancelOrder",
      CancelOrder,
      cancelOrderSchema,
      { description: "Cancel an order", trustedParams: ["userId"] },
    );

    const entry = toolbox
      .pick("cancelOrder")
      .withTrustedValues({ cancelOrder: { userId: "user_123" } })
      .entries()
      .get("cancelOrder");
    expect(entry).toBeDefined();

    // The exposed schema asks for exactly the LLM-decidable fields.
    expect(entry?.schema.safeParse({ orderId: "order_456" }).success).toBe(
      true,
    );

    // The use case still receives the trusted value, filled in by the
    // application.
    await entry?.handler.handle({ orderId: "order_456" });
    expect(received).toEqual({ orderId: "order_456", userId: "user_123" });
  });

  // Type-level regression: declaring trusted params on a schema whose
  // fields cannot be removed (e.g. transformed) is a compile error.
  // Never invoked — registration would (rightly) throw at runtime.
  const _refusedAtCompileTime = () => {
    const transformedSchema = z
      .object({ order_id: z.string(), user_id: z.string() })
      .transform(({ order_id, user_id }) => ({
        orderId: order_id,
        userId: user_id,
      }));
    new Toolbox().tool("cancelOrder", CancelOrder, transformedSchema, {
      description: "Cancel an order",
      // @ts-expect-error — trusted params cannot be hidden on a transformed schema
      trustedParams: ["userId"],
    });
  };
  void _refusedAtCompileTime;

  it("a trusted parameter that cannot be hidden from the LLM is refused", () => {
    // A transformed schema is opaque — its fields cannot be removed, so
    // the trusted param would reach the LLM. Registration must refuse.
    const opaqueSchema = z
      .object({ order_id: z.string(), user_id: z.string() })
      .transform(({ order_id, user_id }) => ({
        orderId: order_id,
        userId: user_id,
      }));

    expect(() =>
      new Toolbox().tool("cancelOrder", CancelOrder, opaqueSchema, {
        description: "Cancel an order",
        // @ts-expect-error — already a compile error; the runtime refusal
        // under test here is the backstop for plain-JS callers
        trustedParams: ["userId"],
      }),
    ).toThrow(/cannot be hidden/);
  });
});

describe("agent tracing", () => {
  const tracing = useInMemoryTracing();

  it("each agent run is individually observable", async () => {
    class DisputeAgent extends Agent<{ message: string }, string> {
      async run(_input: { message: string }) {
        return "resolved";
      }
    }

    await new DisputeAgent().run({ message: "help" });

    const spans = tracing.spans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("DisputeAgent");
  });
});
