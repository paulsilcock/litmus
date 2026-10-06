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

describe("toVercelTools", () => {
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

  it("tools supplied as a plain record convert the same as a selection", async () => {
    const tools = toVercelTools({
      getBalance: {
        description: "Get account balance",
        schema,
        handler: new GetBalance(),
      },
    });

    expect(tools).toHaveProperty("getBalance");
    const execute = tools.getBalance!.execute;
    expect(execute).toBeDefined();

    if (execute) {
      const result = await execute(
        { id: "acc_123" },
        { toolCallId: "call_1", messages: [] },
      );
      expect(result).toEqual({ balance: 100 });
    }
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
