import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { UserSimulator, type Utterance } from "#litmus-test/simulator.ts";

function scripted(...utterances: Utterance[]) {
  let index = 0;
  return async (): Promise<Utterance> => {
    const utterance = utterances[index++];
    if (!utterance) throw new Error("ran out of scripted utterances");
    return utterance;
  };
}

describe("UserSimulator", () => {
  it("the simulated user can send scripted messages", async () => {
    const sent: string[] = [];
    let generateCalls = 0;

    const customer = UserSimulator.text({
      generateResponse: async () => {
        generateCalls++;
        return { message: "", status: "continue" };
      },
      persona: "a customer",
      send: async (message) => {
        sent.push(message);
      },
      receive: async () => "ok",
    });

    await customer.write("I want to cancel my subscription");

    expect(sent).toEqual(["I want to cancel my subscription"]);
    expect(generateCalls).toBe(0);
  });

  it("the simulated user can read the system's replies", async () => {
    let generateCalls = 0;

    const customer = UserSimulator.text({
      generateResponse: async () => {
        generateCalls++;
        return { message: "", status: "continue" };
      },
      persona: "a customer",
      send: async () => {},
      receive: async () => "Hello, how can I help?",
    });

    const reply = await customer.read();

    expect(reply).toBe("Hello, how can I help?");
    expect(generateCalls).toBe(0);
  });

  it("the conversation ends when the simulated user reaches their goal", async () => {
    const customer = UserSimulator.text({
      generateResponse: scripted({ message: "Thanks!", status: "goal_met" }),
      persona: "a customer",
      send: async () => {},
      receive: async () => "ok",
    });

    const result = await customer.pursueGoal("get a refund");

    expect(result).toEqual({ met: true, reason: "goal_met" });
  });

  it("the conversation ends after max turns when the simulated user can't reach their goal", async () => {
    const customer = UserSimulator.text({
      generateResponse: async () => ({
        message: "still trying",
        status: "continue",
      }),
      persona: "a determined customer",
      send: async () => {},
      receive: async () => "no",
    });

    const result = await customer.pursueGoal("get a refund", { maxTurns: 3 });

    expect(result).toEqual({ met: false, reason: "max_turns" });
  });

  it("the simulated user abandons a goal it judges unreachable", async () => {
    const customer = UserSimulator.text({
      generateResponse: scripted({
        message: "Never mind, this isn't going to work",
        status: "abandoned",
      }),
      persona: "a discouraged customer",
      send: async () => {},
      receive: async () => "we can't help with that",
    });

    const result = await customer.pursueGoal("get a refund");

    expect(result).toEqual({ met: false, reason: "abandoned" });
  });

  it("the conversation transcript includes turns from an autonomous pursuit", async () => {
    const customer = UserSimulator.text({
      generateResponse: scripted(
        { message: "I'd like a refund please", status: "continue" },
        { message: "Thanks, got my refund!", status: "goal_met" },
      ),
      persona: "a customer",
      send: async () => {},
      receive: async () => "Here is your refund",
    });

    await customer.pursueGoal("get a refund");

    const transcript = await customer.transcript();

    expect(transcript).toEqual([
      { role: "user", content: "I'd like a refund please" },
      { role: "assistant", content: "Here is your refund" },
      { role: "user", content: "Thanks, got my refund!" },
    ]);
  });

  it("the simulated user exposes the conversation transcript", async () => {
    const customer = UserSimulator.text({
      generateResponse: async () => {
        throw new Error("no generation expected in this test");
      },
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

    const customer = UserSimulator.text({
      generateResponse: async (prompt) => {
        capturedPrompt = JSON.stringify(prompt);
        return { message: "ok", status: "goal_met" };
      },
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

    const customer = UserSimulator.text({
      generateResponse: async (prompt) => {
        capturedPrompt = JSON.stringify(prompt);
        return { message: "ok", status: "goal_met" };
      },
      prompt: () => "custom-prompt-text",
      send: async () => {},
      receive: async () => "ok",
    });

    await customer.pursueGoal("some goal");

    expect(capturedPrompt).toContain("custom-prompt-text");
  });

  it("the simulated user's abilities are available on every turn of a pursuit", async () => {
    const offeredTools: string[][] = [];

    const customer = UserSimulator.text({
      generateResponse: async (_prompt, tools) => {
        offeredTools.push(Object.keys(tools ?? {}));
        return offeredTools.length < 2
          ? { message: "looking...", status: "continue" }
          : { message: "Done!", status: "goal_met" };
      },
      persona: "a customer",
      abilities: {
        applyDiscountCode: {
          description: "Apply a discount code to their cart",
          schema: z.object({ code: z.string() }),
          handler: { handle: async () => ({ applied: true }) },
        },
      },
      send: async () => {},
      receive: async () => "ok",
    });

    await customer.pursueGoal("apply discount and confirm");

    expect(offeredTools).toEqual([
      ["applyDiscountCode"],
      ["applyDiscountCode"],
    ]);
  });
});
