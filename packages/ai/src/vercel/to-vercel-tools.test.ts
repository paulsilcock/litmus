import { Toolbox } from "@litmus/core/ai";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { toVercelTools } from "#litmus-ai/vercel/to-vercel-tools.ts";

const schema = z.object({ id: z.string() });

class GetBalance {
  async handle(_input: { id: string }) {
    return { balance: 100 };
  }
}

class CancelOrder {
  async handle(_input: { orderId: string; userId: string }) {
    return { cancelled: true };
  }
}

describe("toVercelTools", () => {
  // Type-level regression: a selection with unbound trusted params
  // cannot reach the LLM. If the constraint is removed, the
  // expect-error directive below fails the type check.
  const withTrusted = new Toolbox()
    .tool(
      "cancelOrder",
      CancelOrder,
      z.object({ orderId: z.string(), userId: z.string() }),
      { description: "Cancel an order", trustedParams: ["userId"] },
    )
    .pick("cancelOrder");
  // @ts-expect-error — trusted values must be bound before conversion
  toVercelTools(withTrusted);
  toVercelTools(
    withTrusted.withTrustedValues({ cancelOrder: { userId: "user_123" } }),
  );

  it("converts a tool selection to vercel-compatible tools", () => {
    const selection = new Toolbox()
      .tool("getBalance", GetBalance, schema, {
        description: "Get account balance",
      })
      .pick("getBalance");

    const tools = toVercelTools(selection);

    expect(tools).toHaveProperty("getBalance");
    expect(tools.getBalance).toHaveProperty("inputSchema");
    expect(tools.getBalance).toHaveProperty("execute");
  });

  it("tool execute delegates to the handler", async () => {
    const selection = new Toolbox()
      .tool("getBalance", GetBalance, schema, {
        description: "Get account balance",
      })
      .pick("getBalance");

    const tools = toVercelTools(selection);
    const execute = tools.getBalance.execute;
    expect(execute).toBeDefined();

    if (execute) {
      const result = await execute(
        { id: "acc_123" },
        { toolCallId: "call_1", messages: [] },
      );
      expect(result).toEqual({ balance: 100 });
    }
  });
});
