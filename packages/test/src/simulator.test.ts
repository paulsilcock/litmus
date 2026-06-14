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
  it.todo("a custom prompt overrides the persona-and-goal default");
  it.todo("the simulated user can take domain actions during a conversation");
  it.todo("taking domain actions doesn't consume conversational turns");
  it.todo(
    "the simulated user still produces an utterance even when it keeps taking actions",
  );
});
