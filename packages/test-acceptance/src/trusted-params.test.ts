import { toVercelTools } from "@litmus/ai/vercel";
import { Agent, Toolbox } from "@litmus/core/ai";
import { generateText, stepCountIs } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

class CancelOrder {
  static received: unknown;

  async handle(input: { orderId: string; userId: string }) {
    CancelOrder.received = input;
    return { cancelled: input.orderId };
  }
}

const systemTools = new Toolbox().tool(
  "cancelOrder",
  CancelOrder,
  z.object({ orderId: z.string(), userId: z.string() }),
  { description: "Cancel an order", trustedParams: ["userId"] },
);

class SupportAgent extends Agent<{ userId: string; message: string }, string> {
  constructor(private model: Parameters<typeof generateText>[0]["model"]) {
    super();
  }

  async run(input: { userId: string; message: string }): Promise<string> {
    const tools = toVercelTools(
      systemTools
        .pick("cancelOrder")
        .withTrustedValues({ cancelOrder: { userId: input.userId } }),
    );

    const result = await generateText({
      model: this.model,
      tools,
      stopWhen: stepCountIs(3),
      prompt: input.message,
    });

    return result.text;
  }
}

const mockResult = {
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  },
  warnings: [],
};

describe("trusted tool parameters", () => {
  it("the LLM is never shown trusted parameters, yet use cases still receive them", async () => {
    const toolsSeenByModel: unknown[] = [];
    let call = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => {
        toolsSeenByModel.push(...(options.tools ?? []));
        call += 1;
        if (call === 1) {
          return {
            ...mockResult,
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "call_1",
                toolName: "cancelOrder",
                input: JSON.stringify({ orderId: "order_456" }),
              },
            ],
            finishReason: { unified: "tool-calls" as const, raw: undefined },
          };
        }
        return {
          ...mockResult,
          content: [{ type: "text" as const, text: "Order cancelled." }],
          finishReason: { unified: "stop" as const, raw: undefined },
        };
      },
    });

    const agent = new SupportAgent(model);
    await agent.run({
      userId: "user_123",
      message: "Cancel order 456 for me",
    });

    // The tool params shown to the model — on every call — are exactly
    // the LLM-decidable fields; the trusted param is absent.
    expect(toolsSeenByModel.length).toBeGreaterThan(0);
    for (const seenTool of toolsSeenByModel) {
      const seen = z
        .object({
          name: z.literal("cancelOrder"),
          inputSchema: z.object({
            properties: z.record(z.string(), z.unknown()),
            required: z.array(z.string()),
          }),
        })
        .parse(seenTool);
      expect(Object.keys(seen.inputSchema.properties)).toEqual(["orderId"]);
      expect(seen.inputSchema.required).toEqual(["orderId"]);
    }

    // The use case received it anyway, injected by the application.
    expect(CancelOrder.received).toEqual({
      orderId: "order_456",
      userId: "user_123",
    });
  });
});
