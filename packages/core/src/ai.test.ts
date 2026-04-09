import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { Toolbox } from "#litmus/ai.ts";

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
