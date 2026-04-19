import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vite-plus/test";

import { llmJudge } from "#litmus-test/grader.ts";

const mockResult = {
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  },
  warnings: [],
};

describe("llmJudge", () => {
  it("returns the model's verdict in rubric mode", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockResult,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              pass: false,
              reason: "did not acknowledge the concern",
            }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
      }),
    });

    const judge = llmJudge<string>({
      model,
      rubric: "Response acknowledges the concern before proposing solutions.",
    });

    const result = await judge("Here's the fix: restart the server.");

    expect(result).toEqual({
      pass: false,
      reason: "did not acknowledge the concern",
    });
  });

  it("uses the provided prompt builder as-is when given", async () => {
    let captured = "";
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        captured = JSON.stringify(prompt);
        return {
          ...mockResult,
          content: [
            {
              type: "text",
              text: JSON.stringify({ pass: true, reason: "ok" }),
            },
          ],
          finishReason: { unified: "stop", raw: undefined },
        };
      },
    });

    const judge = llmJudge<string>({
      model,
      prompt: (input) => `custom:${input}`,
    });

    await judge("the-input");

    expect(captured).toContain("custom:the-input");
  });
});
