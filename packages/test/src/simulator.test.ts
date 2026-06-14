import { describe, it } from "vite-plus/test";

describe("UserSimulator", () => {
  it.todo("the simulated user can be scripted to send a specific message");
  it.todo(
    "the simulated user can be scripted to read the system's next message",
  );
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
