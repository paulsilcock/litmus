import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { vercelGenerator } from "#litmus-ai/vercel/vercel-generator.ts";

const outputSchema = z.object({ answer: z.string() });

const mockResult = {
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  },
  warnings: [],
};

describe("vercelGenerator", () => {
  it("generates schema-shaped output from a text prompt", async () => {
    let receivedPrompt = "";
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        receivedPrompt = JSON.stringify(prompt);
        return {
          ...mockResult,
          content: [
            {
              type: "text",
              text: JSON.stringify({ answer: "a refund" }),
            },
          ],
          finishReason: { unified: "stop", raw: undefined },
        };
      },
    });

    const generate = vercelGenerator({ model, schema: outputSchema });

    const output = await generate("What does the customer want?");

    expect(receivedPrompt).toContain("What does the customer want?");
    expect(output).toEqual({ answer: "a refund" });
  });

  it("a prompt given as messages reaches the model with roles preserved", async () => {
    let receivedRoles: string[] = [];
    let receivedPrompt = "";
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        receivedRoles = prompt.map((message) => message.role);
        receivedPrompt = JSON.stringify(prompt);
        return {
          ...mockResult,
          content: [
            {
              type: "text",
              text: JSON.stringify({ answer: "ok" }),
            },
          ],
          finishReason: { unified: "stop", raw: undefined },
        };
      },
    });

    const generate = vercelGenerator({ model, schema: outputSchema });

    await generate([
      { role: "system", content: "You are a support agent." },
      { role: "assistant", content: "How can I help?" },
      { role: "user", content: "My book arrived damaged" },
    ]);

    expect(receivedRoles).toEqual(["system", "assistant", "user"]);
    expect(receivedPrompt).toContain("You are a support agent.");
    expect(receivedPrompt).toContain("How can I help?");
    expect(receivedPrompt).toContain("My book arrived damaged");
  });

  it("tools given to the generator reach the model with their name, purpose, and input shape", async () => {
    let receivedTools = "";
    const model = new MockLanguageModelV3({
      doGenerate: async ({ tools }) => {
        receivedTools = JSON.stringify(tools);
        return {
          ...mockResult,
          content: [
            {
              type: "text",
              text: JSON.stringify({ answer: "done" }),
            },
          ],
          finishReason: { unified: "stop", raw: undefined },
        };
      },
    });

    const generate = vercelGenerator({ model, schema: outputSchema });

    await generate("Apply the customer's discount code.", {
      applyDiscountCode: {
        description: "Apply a discount code to the cart",
        schema: z.object({ code: z.string() }),
        handler: { handle: async () => ({ applied: true }) },
      },
    });

    expect(receivedTools).toContain("applyDiscountCode");
    expect(receivedTools).toContain("Apply a discount code to the cart");
    expect(receivedTools).toContain("code");
  });

  it("tool calls are executed and generation continues to the final output", async () => {
    const handled: Array<{ code: string }> = [];

    const responses = [
      {
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "call_1",
            toolName: "applyDiscountCode",
            input: JSON.stringify({ code: "SAVE10" }),
          },
        ],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
      },
      {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ answer: "applied" }),
          },
        ],
        finishReason: { unified: "stop" as const, raw: undefined },
      },
    ];
    let callIndex = 0;

    const model = new MockLanguageModelV3({
      doGenerate: async () => ({ ...mockResult, ...responses[callIndex++] }),
    });

    const generate = vercelGenerator({ model, schema: outputSchema });

    const output = await generate("Apply the customer's discount code.", {
      applyDiscountCode: {
        description: "Apply a discount code to the cart",
        schema: z.object({ code: z.string() }),
        handler: {
          handle: async (input: { code: string }) => {
            handled.push(input);
            return { applied: true };
          },
        },
      },
    });

    expect(handled).toEqual([{ code: "SAVE10" }]);
    expect(output).toEqual({ answer: "applied" });
  });
});
