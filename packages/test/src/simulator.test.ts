import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vite-plus/test";

import { UserSimulator } from "#litmus-test/simulator.ts";

const mockResult = {
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  },
  warnings: [],
};

describe("UserSimulator", () => {
  it("ends the conversation once the user has the answer they were looking for", async () => {
    const responses = [
      { message: "What's my balance?", done: false },
      { message: "Thanks!", done: true },
    ];
    let callIndex = 0;

    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockResult,
        content: [
          { type: "text", text: JSON.stringify(responses[callIndex++]) },
        ],
        finishReason: { unified: "stop", raw: undefined },
      }),
    });

    const simulator = new UserSimulator({
      model,
      persona: "Customer checking their account",
      goal: "Find out my account balance",
    });

    const handler = async (message: string) => {
      if (message.toLowerCase().includes("balance")) return "$1250";
      return "OK";
    };

    const conversation = await simulator.simulate({ handler });

    expect(conversation.turns).toEqual([
      { role: "user", content: "What's my balance?" },
      { role: "assistant", content: "$1250" },
      { role: "user", content: "Thanks!" },
    ]);
    expect(conversation.outcome).toBe("goal_met");
  });
});
