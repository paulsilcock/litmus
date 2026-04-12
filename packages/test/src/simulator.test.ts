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

  it("gives up after max turns when the user never reaches their goal", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockResult,
        content: [
          {
            type: "text",
            text: JSON.stringify({ message: "still trying", done: false }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
      }),
    });

    const simulator = new UserSimulator({
      model,
      persona: "Stubborn customer",
      goal: "Get a refund",
      maxTurns: 3,
    });

    const handler = async () => "I can't help with that";

    const conversation = await simulator.simulate({ handler });

    expect(conversation.outcome).toBe("max_turns");
    expect(conversation.turns).toHaveLength(6);
    expect(conversation.turns.filter((t) => t.role === "user")).toHaveLength(3);
    expect(
      conversation.turns.filter((t) => t.role === "assistant"),
    ).toHaveLength(3);
  });

  it("ends the conversation when the system terminates it", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockResult,
        content: [
          {
            type: "text",
            text: JSON.stringify({ message: "you're useless", done: false }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
      }),
    });

    const simulator = new UserSimulator({
      model,
      persona: "Abusive customer",
      goal: "Win the argument",
    });

    const handler = async () => ({
      done: true,
      reason: "abusive language",
    });

    const conversation = await simulator.simulate({ handler });

    expect(conversation.outcome).toBe("system_terminated");
    expect(conversation.turns).toHaveLength(1);
    expect(conversation.turns[0]).toEqual({
      role: "user",
      content: "you're useless",
    });
  });

  it("uses the provided opening message instead of generating one", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockResult,
        content: [
          {
            type: "text",
            text: JSON.stringify({ message: "Great, thanks!", done: true }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
      }),
    });

    const simulator = new UserSimulator({
      model,
      persona: "Customer",
      goal: "Get my balance",
    });

    const conversation = await simulator.simulate({
      opening: "What's my balance?",
      handler: async () => "$1250",
    });

    expect(conversation.turns[0]).toEqual({
      role: "user",
      content: "What's my balance?",
    });
    expect(conversation.turns[1]).toEqual({
      role: "assistant",
      content: "$1250",
    });
  });

  it("simulated user can take actions via tools before responding", async () => {
    const toolCalls: Array<{ code: string }> = [];

    const responses = [
      {
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "call_1",
            toolName: "apply_discount",
            input: JSON.stringify({ code: "SAVE10" }),
          },
        ],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
      },
      {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              message: "I've applied my discount code, what's the total?",
              done: false,
            }),
          },
        ],
        finishReason: { unified: "stop" as const, raw: undefined },
      },
      {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ message: "Thanks!", done: true }),
          },
        ],
        finishReason: { unified: "stop" as const, raw: undefined },
      },
    ];
    let callIndex = 0;

    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockResult,
        ...responses[callIndex++],
      }),
    });

    const simulator = new UserSimulator({
      model,
      persona: "Bargain hunter",
      goal: "Apply discount code and check total",
      tools: {
        apply_discount: {
          description: "Apply a discount code",
          parameters: { code: { type: "string" } },
          execute: async (args: { code: string }) => {
            toolCalls.push(args);
            return { applied: true };
          },
        },
      },
    });

    const conversation = await simulator.simulate({
      handler: async () => "$45.00",
    });

    expect(toolCalls).toEqual([{ code: "SAVE10" }]);
    expect(conversation.turns).toEqual([
      {
        role: "user",
        content: "I've applied my discount code, what's the total?",
      },
      { role: "assistant", content: "$45.00" },
      { role: "user", content: "Thanks!" },
    ]);
    expect(conversation.outcome).toBe("goal_met");
  });
});
