import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { UserSimulator } from "#litmus-test/simulator.ts";

const mockResult = {
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  },
  warnings: [],
};

const unusedModel = new MockLanguageModelV3({
  doGenerate: async () => ({
    ...mockResult,
    content: [
      {
        type: "text",
        text: JSON.stringify({ message: "unused", status: "goal_met" }),
      },
    ],
    finishReason: { unified: "stop", raw: undefined },
  }),
});

describe("UserSimulator", () => {
  it("the simulated user can be scripted to send a specific message", async () => {
    const sent: string[] = [];

    const customer = UserSimulator.text({
      model: unusedModel,
      persona: "a customer",
      send: async (message) => {
        sent.push(message);
      },
      receive: async () => "ok",
    });

    await customer.write("I want to cancel my subscription");

    expect(sent).toEqual(["I want to cancel my subscription"]);
  });

  it("the simulated user can be scripted to read the system's next message", async () => {
    const customer = UserSimulator.text({
      model: unusedModel,
      persona: "a customer",
      send: async () => {},
      receive: async () => "Hello, how can I help?",
    });

    const reply = await customer.read();

    expect(reply).toBe("Hello, how can I help?");
  });
  it("the conversation ends when the simulated user reaches their goal", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockResult,
        content: [
          {
            type: "text",
            text: JSON.stringify({ message: "Thanks!", status: "goal_met" }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
      }),
    });

    const customer = UserSimulator.text({
      model,
      persona: "a customer",
      send: async () => {},
      receive: async () => "ok",
    });

    const result = await customer.pursueGoal("get a refund");

    expect(result).toEqual({ met: true, reason: "goal_met" });
  });
  it("the conversation ends after max turns when the simulated user can't reach their goal", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockResult,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              message: "still trying",
              status: "continue",
            }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
      }),
    });

    const customer = UserSimulator.text({
      model,
      persona: "a determined customer",
      send: async () => {},
      receive: async () => "no",
    });

    const result = await customer.pursueGoal("get a refund", { maxTurns: 3 });

    expect(result).toEqual({ met: false, reason: "max_turns" });
  });
  it("the simulated user abandons a goal it judges unreachable", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockResult,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              message: "Never mind, this isn't going to work",
              status: "abandoned",
            }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
      }),
    });

    const customer = UserSimulator.text({
      model,
      persona: "a discouraged customer",
      send: async () => {},
      receive: async () => "we can't help with that",
    });

    const result = await customer.pursueGoal("get a refund");

    expect(result).toEqual({ met: false, reason: "abandoned" });
  });
  it("the simulated user exposes the conversation transcript", async () => {
    const customer = UserSimulator.text({
      model: unusedModel,
      persona: "a customer",
      send: async () => {},
      receive: async () => "Hello there",
    });

    await customer.write("hi");
    await customer.read();

    const transcript = await customer.transcript();

    expect(transcript).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello there" },
    ]);
  });
  it("a simulated user remembers prior conversation when interacting", async () => {
    let capturedPrompt = "";
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        capturedPrompt = JSON.stringify(prompt);
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

    const customer = UserSimulator.text({
      model,
      persona: "a customer",
      send: async () => {},
      receive: async () => "We can offer store credit",
    });

    await customer.write("I bought a faulty product");
    await customer.read();
    await customer.pursueGoal("get a refund");

    expect(capturedPrompt).toContain("I bought a faulty product");
    expect(capturedPrompt).toContain("We can offer store credit");
  });
  it("a custom prompt overrides the persona-and-goal default", async () => {
    let capturedPrompt = "";
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        capturedPrompt = JSON.stringify(prompt);
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

    const customer = UserSimulator.text({
      model,
      prompt: () => "custom-prompt-text",
      send: async () => {},
      receive: async () => "ok",
    });

    await customer.pursueGoal("some goal");

    expect(capturedPrompt).toContain("custom-prompt-text");
  });
  it("the simulated user can take domain actions during a conversation", async () => {
    const discountCalls: Array<{ code: string }> = [];

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
            text: JSON.stringify({ message: "Done!", status: "goal_met" }),
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

    const customer = UserSimulator.text({
      model,
      persona: "a customer",
      send: async () => {},
      receive: async () => "ok",
      abilities: {
        applyDiscountCode: {
          reason: "Apply a discount code to their cart",
          how: z.object({ code: z.string() }),
          use: async ({ code }) => {
            discountCalls.push({ code });
            return { applied: true };
          },
        },
      },
    });

    await customer.pursueGoal("apply discount and confirm");

    expect(discountCalls).toEqual([{ code: "SAVE10" }]);
  });
  it("taking domain actions doesn't consume conversational turns", async () => {
    const actionCalls: string[] = [];

    const responses = [
      {
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "1",
            toolName: "lookup",
            input: JSON.stringify({ q: "balance" }),
          },
        ],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
      },
      {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              message: "Got it, thanks!",
              status: "goal_met",
            }),
          },
        ],
        finishReason: { unified: "stop" as const, raw: undefined },
      },
    ];
    let callIndex = 0;

    const model = new MockLanguageModelV3({
      doGenerate: async () => ({ ...mockResult, ...responses[callIndex++] }),
    });

    const customer = UserSimulator.text({
      model,
      persona: "a customer",
      send: async () => {},
      receive: async () => "ok",
      abilities: {
        lookup: {
          reason: "Look something up",
          how: z.object({ q: z.string() }),
          use: async ({ q }) => {
            actionCalls.push(q);
            return { found: "$1250" };
          },
        },
      },
    });

    // maxTurns: 1 — only one conversational round is allowed. The model
    // should still be able to use the ability and produce a final
    // utterance, all within that single turn.
    const result = await customer.pursueGoal("find balance", { maxTurns: 1 });

    expect(actionCalls).toEqual(["balance"]);
    expect(result).toEqual({ met: true, reason: "goal_met" });
  });
  it("the simulated user still produces an utterance even when it keeps taking actions", async () => {
    const sent: string[] = [];
    let callIndex = 0;

    // Model only ever calls the ability — never produces a text utterance.
    // Without a safety net, the simulator would loop indefinitely on tool
    // calls and never speak. The step limit should kick in and force the
    // simulator to produce *some* utterance and move on.
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        callIndex++;
        return {
          ...mockResult,
          content: [
            {
              type: "tool-call" as const,
              toolCallId: `${callIndex}`,
              toolName: "lookup",
              input: JSON.stringify({}),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: undefined },
        };
      },
    });

    const customer = UserSimulator.text({
      model,
      persona: "a customer who can't stop looking things up",
      send: async (message) => {
        sent.push(message);
      },
      receive: async () => "ok",
      maxStepsPerTurn: 2,
      abilities: {
        lookup: {
          reason: "Look up something",
          how: z.object({}),
          use: async () => ({}),
        },
      },
    });

    const result = await customer.pursueGoal("find something", { maxTurns: 1 });

    expect(sent.length).toBeGreaterThan(0);
    expect(result.met).toBeDefined();
  });
});
