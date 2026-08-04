import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { Agent, Toolbox } from "#litmus/ai.ts";
import { captureSpans } from "#litmus/test-support/tracing.ts";

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

describe("agent tracing", () => {
  const tracing = captureSpans();

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
