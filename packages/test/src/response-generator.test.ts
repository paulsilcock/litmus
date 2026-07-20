import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vite-plus/test";

import { fromVercel } from "#litmus-test/response-generator.ts";

const mockResult = {
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  },
  warnings: [],
};

describe("fromVercel", () => {
  it("generates an utterance from the given prompt", async () => {
    let receivedPrompt = "";
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        receivedPrompt = JSON.stringify(prompt);
        return {
          ...mockResult,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: "I'd like a refund",
                status: "continue",
              }),
            },
          ],
          finishReason: { unified: "stop", raw: undefined },
        };
      },
    });

    const generate = fromVercel({ model });

    const utterance = await generate("You are a customer chasing a refund.");

    expect(receivedPrompt).toContain("You are a customer chasing a refund.");
    expect(utterance).toEqual({
      message: "I'd like a refund",
      status: "continue",
    });
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
              text: JSON.stringify({ message: "ok", status: "goal_met" }),
            },
          ],
          finishReason: { unified: "stop", raw: undefined },
        };
      },
    });

    const generate = fromVercel({ model });

    await generate([
      { role: "system", content: "You are simulating a customer." },
      { role: "assistant", content: "I'd like a refund" },
      { role: "user", content: "Can you share your order number?" },
    ]);

    expect(receivedRoles).toEqual(["system", "assistant", "user"]);
    expect(receivedPrompt).toContain("You are simulating a customer.");
    expect(receivedPrompt).toContain("I'd like a refund");
    expect(receivedPrompt).toContain("Can you share your order number?");
  });
});
