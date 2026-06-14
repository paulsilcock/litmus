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
        text: JSON.stringify({ message: "unused", done: true }),
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
  it.todo("the conversation ends when the simulated user reaches their goal");
  it.todo(
    "the conversation ends after max turns when the simulated user can't reach their goal",
  );
  it.todo("the simulated user abandons a goal it judges unreachable");
  it.todo("the simulated user exposes the conversation transcript");
  it.todo("a simulated user remembers prior conversation when interacting");
  it.todo("a custom prompt overrides the persona-and-goal default");
  it.todo("the simulated user can take domain actions during a conversation");
  it.todo("taking domain actions doesn't consume conversational turns");
  it.todo(
    "the simulated user still produces an utterance even when it keeps taking actions",
  );
});
