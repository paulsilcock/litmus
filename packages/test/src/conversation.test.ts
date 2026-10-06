import { describe, expect, it } from "vite-plus/test";

import { Conversation } from "#litmus-test/conversation.ts";

describe("Conversation", () => {
  it("a conversation keeps what was said in the order it was said", () => {
    const conversation = new Conversation();

    conversation.add({
      speaker: "simulatedUser",
      content: "I'd like a refund",
    });
    conversation.add({
      speaker: "systemUnderTest",
      content: "Can I take your order number?",
    });
    conversation.add({ speaker: "simulatedUser", content: "It's 1234" });

    expect(conversation.turns()).toEqual([
      { speaker: "simulatedUser", content: "I'd like a refund" },
      { speaker: "systemUnderTest", content: "Can I take your order number?" },
      { speaker: "simulatedUser", content: "It's 1234" },
    ]);
  });

  it("a conversation separates what the system under test just said from what came before", () => {
    const conversation = new Conversation();

    conversation.add({
      speaker: "simulatedUser",
      content: "My book arrived damaged",
    });
    conversation.add({
      speaker: "systemUnderTest",
      content: "Sorry to hear that",
    });
    conversation.add({
      speaker: "simulatedUser",
      content: "Can I get a replacement?",
    });
    conversation.add({
      speaker: "systemUnderTest",
      content: "Yes, I've ordered one",
    });

    expect(conversation.latestReply()).toBe("Yes, I've ordered one");
    expect(conversation.previousTurns()).toEqual([
      { speaker: "simulatedUser", content: "My book arrived damaged" },
      { speaker: "systemUnderTest", content: "Sorry to hear that" },
      { speaker: "simulatedUser", content: "Can I get a replacement?" },
    ]);
  });

  it("a conversation never reports the simulated user's own words as the system's", () => {
    const conversation = new Conversation();

    conversation.add({
      speaker: "systemUnderTest",
      content: "How can I help?",
    });
    conversation.add({
      speaker: "simulatedUser",
      content: "I'd like a refund",
    });

    expect(conversation.latestReply()).toBe("");
    expect(conversation.previousTurns()).toEqual([
      { speaker: "systemUnderTest", content: "How can I help?" },
      { speaker: "simulatedUser", content: "I'd like a refund" },
    ]);
  });
});
