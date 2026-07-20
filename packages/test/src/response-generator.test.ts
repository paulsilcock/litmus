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
});
