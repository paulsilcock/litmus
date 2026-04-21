import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { Agent, AiTask, Toolbox } from "#litmus/ai.ts";

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

describe("ai task and agent tracing", () => {
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

  it("records a span named after the agent class when it runs", async () => {
    class DisputeAgent extends Agent<{ message: string }, string> {
      async run(_input: { message: string }) {
        return "resolved";
      }
    }

    await new DisputeAgent().run({ message: "help" });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("DisputeAgent");
  });

  it("records a span named after the ai task class when it runs", async () => {
    class TriageRequest extends AiTask<string, string> {
      async run(_input: string) {
        return "refund";
      }
    }

    await new TriageRequest().run("customer message");

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("TriageRequest");
  });
});
