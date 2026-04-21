import { toVercelTools } from "@litmus/ai/vercel";
import { Agent } from "@litmus/core/ai";
import { Toolbox } from "@litmus/core/ai";
import { generateText, stepCountIs } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

// --- Use cases (fixtures) ---

class GetRecentTransactions {
  async handle(_input: { customerId: string }) {
    return [
      { id: "tx_1", amount: 49.99, description: "Order #1001" },
      { id: "tx_2", amount: 49.99, description: "Order #1001" },
    ];
  }
}

class InitiateRefund {
  async handle(input: { transactionId: string }) {
    return { transactionId: input.transactionId, refundedAmount: 49.99 };
  }
}

// --- System tools ---

const systemTools = new Toolbox()
  .tool(
    "getRecentTransactions",
    GetRecentTransactions,
    z.object({ customerId: z.string() }),
    { description: "Look up a customer's recent transactions" },
  )
  .tool(
    "initiateRefund",
    InitiateRefund,
    z.object({ transactionId: z.string() }),
    { description: "Initiate a refund for a transaction" },
  );

// --- Agent (fixture) ---

class DisputeAgent extends Agent<
  { customerId: string; message: string },
  string
> {
  constructor(private model: Parameters<typeof generateText>[0]["model"]) {
    super();
  }

  async run(input: { customerId: string; message: string }): Promise<string> {
    const tools = toVercelTools(
      systemTools.pick("getRecentTransactions", "initiateRefund"),
    );

    const result = await generateText({
      model: this.model,
      tools,
      stopWhen: stepCountIs(5),
      prompt: `Customer ${input.customerId} says: ${input.message}`,
    });

    return result.text;
  }
}

// --- Test ---

const mockResult = {
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  },
  warnings: [],
};

describe("agent as actor", () => {
  it("agents can interact with the system via its use cases", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [
        {
          ...mockResult,
          content: [
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "getRecentTransactions",
              input: JSON.stringify({ customerId: "cust_123" }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
        },
        {
          ...mockResult,
          content: [
            {
              type: "tool-call",
              toolCallId: "call_2",
              toolName: "initiateRefund",
              input: JSON.stringify({ transactionId: "tx_2" }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
        },
        {
          ...mockResult,
          content: [
            {
              type: "text",
              text: "I found a duplicate charge of $49.99 and initiated a refund for transaction tx_2.",
            },
          ],
          finishReason: { unified: "stop", raw: undefined },
        },
      ],
    });

    const agent = new DisputeAgent(model);
    const response = await agent.run({
      customerId: "cust_123",
      message: "I've been charged twice for my last order",
    });

    expect(response).toContain("refund");
    expect(response).toContain("tx_2");
  });
});
