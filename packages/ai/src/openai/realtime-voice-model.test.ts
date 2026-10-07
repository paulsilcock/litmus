import type { SimulatedUserAction } from "@litmus/core/ai";
import { describe, expect, it, vi } from "vite-plus/test";

import { OpenAIRealtimeVoiceModel } from "#litmus-ai/openai/realtime-voice-model.ts";
import { FakeRealtimeServer } from "#litmus-ai/openai/testing/fake-realtime-server.ts";

const speech = { samples: [0.5, -0.25], sampleRate: 24_000 };
const silence = { samples: [0, 0], sampleRate: 24_000 };

function modelFor(openai: FakeRealtimeServer): OpenAIRealtimeVoiceModel {
  return new OpenAIRealtimeVoiceModel({ apiKey: "sk-test", url: openai.url });
}

/** Runs a whole pursuit and collects what the simulated user does. */
async function pursuit(
  model: OpenAIRealtimeVoiceModel,
  { persona, goal }: { persona: string; goal: string } = {
    persona: "a customer",
    goal: "get a refund",
  },
): Promise<SimulatedUserAction[]> {
  await using session = await model.connect({ persona });
  session.pursue(goal);
  return await upTo(session.actions()[Symbol.asyncIterator](), goalMet);
}

/**
 * Reads what the simulated user does, up to and including the first action
 * of a type, or the first that matches a check.
 * Takes an iterator so a conversation can be read in several steps.
 */
async function upTo(
  actions: AsyncIterator<SimulatedUserAction>,
  until:
    | SimulatedUserAction["type"]
    | ((action: SimulatedUserAction) => boolean),
): Promise<SimulatedUserAction[]> {
  const reached =
    typeof until === "function"
      ? until
      : (action: SimulatedUserAction) => action.type === until;
  const seen: SimulatedUserAction[] = [];
  for (;;) {
    const next = await actions.next();
    if (next.done) return seen;
    seen.push(next.value);
    if (reached(next.value)) return seen;
  }
}

/** The end of a turn in which the simulated user met its goal. */
function goalMet(action: SimulatedUserAction): boolean {
  return action.type === "finishedTurn" && action.goalMet;
}

describe("OpenAI Realtime voice model", () => {
  it("what the model says streams out as audio, chunk by chunk", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({
      audio: [
        [0.5, -0.25],
        [0.125, 0],
      ],
      goalMet: true,
    });

    const actions = await pursuit(modelFor(openai));

    expect(actions.filter((action) => action.type === "speak")).toEqual([
      { type: "speak", audio: { samples: [0.5, -0.25], sampleRate: 24_000 } },
      { type: "speak", audio: { samples: [0.125, 0], sampleRate: 24_000 } },
    ]);
  });

  it("the model is told who it is and what it's after", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({ audio: [], goalMet: true });

    await pursuit(modelFor(openai), {
      persona: "a customer whose book arrived damaged",
      goal: "get a replacement",
    });

    expect(openai.instructions()).toContain(
      "a customer whose book arrived damaged",
    );
    expect(openai.instructions()).toContain("get a replacement");
  });

  it("the model reports when its goal is met", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({ audio: [[0.25]], goalMet: true });

    const actions = await pursuit(modelFor(openai));

    expect(actions).toEqual([
      { type: "speak", audio: { samples: [0.25], sampleRate: 24_000 } },
      { type: "finishedTurn", goalMet: true },
    ]);
  });

  it("the model reports when it has finished its turn", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({ audio: [[0.25]], says: "Hi, I'd like a refund" });
    await using session = await modelFor(openai).connect({
      persona: "a customer",
    });

    session.pursue("get a refund");
    const actions = await upTo(
      session.actions()[Symbol.asyncIterator](),
      "finishedTurn",
    );

    expect(actions).toEqual([
      { type: "speak", audio: { samples: [0.25], sampleRate: 24_000 } },
      { type: "said", text: "Hi, I'd like a refund" },
      { type: "finishedTurn", goalMet: false },
    ]);
  });

  it("the model reports what it says, in words", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({
      audio: [[0.25]],
      says: "Hi, I'd like a refund",
      goalMet: true,
    });

    const actions = await pursuit(modelFor(openai));

    expect(actions).toContainEqual({
      type: "said",
      text: "Hi, I'd like a refund",
    });
  });

  it("the model waits to be asked before it speaks", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({ audio: [[0.25]], says: "Hi, I'd like a refund" });
    openai.transcribesHeardSpeechAs("Hello, how can I help?");
    await using session = await modelFor(openai).connect({
      persona: "a customer",
    });

    session.listenTo(speech);
    session.listenTo(silence);

    expect(
      await upTo(session.actions()[Symbol.asyncIterator](), "heard"),
    ).toEqual([
      { type: "hearing" },
      { type: "heard", text: "Hello, how can I help?" },
    ]);
  });

  it("the model reports when the other side starts speaking", async () => {
    await using openai = await FakeRealtimeServer.start();
    await using session = await modelFor(openai).connect({
      persona: "a customer",
    });

    session.listenTo(speech);

    expect(
      await upTo(session.actions()[Symbol.asyncIterator](), "hearing"),
    ).toEqual([{ type: "hearing" }]);
  });

  it("the model reports when it can't make out what it heard", async () => {
    await using openai = await FakeRealtimeServer.start();
    await using session = await modelFor(openai).connect({
      persona: "a customer",
    });

    session.listenTo(speech);
    session.listenTo(silence);

    expect(
      await upTo(session.actions()[Symbol.asyncIterator](), "unclear"),
    ).toEqual([
      { type: "hearing" },
      { type: "unclear", reason: "Transcription failed" },
    ]);
  });

  it("the model replies to what it hears", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({ audio: [[0.25]] });
    openai.replyWith({ audio: [[0.125]], goalMet: true });
    await using session = await modelFor(openai).connect({
      persona: "a customer",
    });

    session.pursue("get a refund");
    session.listenTo(speech);
    session.listenTo(silence);
    const actions = await upTo(
      session.actions()[Symbol.asyncIterator](),
      goalMet,
    );

    expect(openai.heardSpeech()).toEqual([0.5, -0.25]);
    expect(actions).toEqual([
      { type: "speak", audio: { samples: [0.25], sampleRate: 24_000 } },
      { type: "finishedTurn", goalMet: false },
      { type: "hearing" },
      { type: "unclear", reason: "Transcription failed" },
      { type: "speak", audio: { samples: [0.125], sampleRate: 24_000 } },
      { type: "finishedTurn", goalMet: true },
    ]);
  });

  it("once pursuing a goal, the model replies to what it hears", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.transcribesHeardSpeechAs("Hello, how can I help?");
    openai.replyWith({ audio: [[0.25]], says: "Hi, I'd like a refund" });
    openai.transcribesHeardSpeechAs("Sure, what's the order number?");
    openai.replyWith({ audio: [[0.125]], says: "It's 1234", goalMet: true });
    await using session = await modelFor(openai).connect({
      persona: "a customer",
    });
    const actions = session.actions()[Symbol.asyncIterator]();

    session.listenTo(speech);
    session.listenTo(silence);
    await upTo(actions, "heard");

    session.pursue("get a refund");
    await upTo(actions, "said");
    session.listenTo({ samples: [0.375], sampleRate: 24_000 });
    session.listenTo(silence);
    const rest = await upTo(actions, goalMet);

    expect(openai.instructions()).toContain("get a refund");
    expect(rest.filter((action) => action.type !== "speak")).toEqual([
      { type: "finishedTurn", goalMet: false },
      { type: "hearing" },
      { type: "heard", text: "Sure, what's the order number?" },
      { type: "said", text: "It's 1234" },
      { type: "finishedTurn", goalMet: true },
    ]);
  });

  it("the model reports what it hears before its reply to it", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({ audio: [[0.25]], says: "Hi, I'd like a refund" });
    openai.replyWith({
      audio: [[0.125]],
      says: "It's order 1234",
      goalMet: true,
    });
    openai.transcribesHeardSpeechAs("Sure, what's the order number?");
    await using session = await modelFor(openai).connect({
      persona: "a customer",
    });

    session.pursue("get a refund");
    session.listenTo(speech);
    session.listenTo(silence);
    const actions = await upTo(
      session.actions()[Symbol.asyncIterator](),
      goalMet,
    );

    expect(actions.filter((action) => action.type !== "speak")).toEqual([
      { type: "said", text: "Hi, I'd like a refund" },
      { type: "finishedTurn", goalMet: false },
      { type: "hearing" },
      { type: "heard", text: "Sure, what's the order number?" },
      { type: "said", text: "It's order 1234" },
      { type: "finishedTurn", goalMet: true },
    ]);
  });

  it("a failed transcription doesn't hold up the conversation", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({ audio: [[0.25]] });
    openai.replyWith({ audio: [[0.125]], says: "Thanks!", goalMet: true });
    await using session = await modelFor(openai).connect({
      persona: "a customer",
    });

    session.pursue("get a refund");
    session.listenTo(speech);
    session.listenTo(silence);
    const actions = await upTo(
      session.actions()[Symbol.asyncIterator](),
      goalMet,
    );

    expect(actions.filter((action) => action.type !== "speak")).toEqual([
      { type: "finishedTurn", goalMet: false },
      { type: "hearing" },
      { type: "unclear", reason: "Transcription failed" },
      { type: "said", text: "Thanks!" },
      { type: "finishedTurn", goalMet: true },
    ]);
  });

  it("a dropped connection is reported as an error", async () => {
    await using openai = await FakeRealtimeServer.start();
    await using session = await modelFor(openai).connect({
      persona: "a customer",
    });
    const actions = session.actions()[Symbol.asyncIterator]();

    openai.dropConnections();

    await expect(actions.next()).rejects.toThrow(
      "The connection to OpenAI Realtime closed unexpectedly (code 1006)",
    );
  });

  it("an error from OpenAI says which request it rejected, and why", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWithError("Invalid value: 'loud'.", "invalid_value");
    await using session = await modelFor(openai).connect({
      persona: "a customer",
    });

    session.pursue("get a refund");

    await expect(
      session.actions()[Symbol.asyncIterator]().next(),
    ).rejects.toThrow(
      "OpenAI Realtime rejected response.create: Invalid value: 'loud'. (invalid_value)",
    );
  });

  it("a reply OpenAI fails to finish is reported with its reason", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({
      audio: [[0.25]],
      failsWith: "Inference rate limit exceeded.",
    });
    await using session = await modelFor(openai).connect({
      persona: "a customer",
    });

    session.pursue("get a refund");

    await expect(
      upTo(session.actions()[Symbol.asyncIterator](), "finishedTurn"),
    ).rejects.toThrow("Inference rate limit exceeded.");
  });

  it("a connection OpenAI closes is reported with its reason", async () => {
    await using openai = await FakeRealtimeServer.start();
    await using session = await modelFor(openai).connect({
      persona: "a customer",
    });
    const actions = session.actions()[Symbol.asyncIterator]();

    openai.closeConnections(1011, "Session expired");

    await expect(actions.next()).rejects.toThrow(
      "The connection to OpenAI Realtime closed unexpectedly (code 1011: Session expired)",
    );
  });

  it("closing the session isn't mistaken for a dropped connection", async () => {
    await using openai = await FakeRealtimeServer.start();
    const session = await modelFor(openai).connect({ persona: "a customer" });
    const reading = session.actions()[Symbol.asyncIterator]().next();

    await session[Symbol.asyncDispose]();

    await expect(reading).resolves.toEqual({ value: undefined, done: true });
  });

  it("the other side finishing a turn mid-reply doesn't end the conversation", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({
      audio: [[0.25]],
      says: "Hi, I'd like a refund",
      heldOpen: true,
    });
    await using session = await modelFor(openai).connect({
      persona: "a customer",
    });
    const actions = session.actions()[Symbol.asyncIterator]();

    session.pursue("get a refund");
    session.listenTo(speech);
    session.listenTo(silence);
    await upTo(actions, "unclear");
    // Messages arrive in order: once OpenAI has heard this, it has had
    // anything the model sent before it.
    session.listenTo({ samples: [0.375], sampleRate: 24_000 });
    await vi.waitFor(() => expect(openai.heardSpeech()).toContain(0.375));
    openai.finishReply();

    expect(await upTo(actions, "finishedTurn")).toEqual([
      { type: "hearing" },
      { type: "said", text: "Hi, I'd like a refund" },
      { type: "finishedTurn", goalMet: false },
    ]);
  });

  it("a reply that OpenAI cancels isn't a finished turn", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({ audio: [[0.25]], heldOpen: true });
    openai.replyWith({ audio: [[0.125]], goalMet: true });
    await using session = await modelFor(openai).connect({
      persona: "a customer",
    });
    const actions = session.actions()[Symbol.asyncIterator]();

    session.pursue("get a refund");
    const started = await upTo(actions, "speak");
    // The other side talks over the reply, so OpenAI cancels it.
    openai.cancelReply();
    session.listenTo(speech);
    session.listenTo(silence);
    const rest = await upTo(actions, goalMet);

    expect(
      [...started, ...rest].filter((action) => action.type === "finishedTurn"),
    ).toEqual([{ type: "finishedTurn", goalMet: true }]);
  });

  it("a conversation carries on after a goal is met", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({
      audio: [[0.25]],
      says: "I'd like a refund",
      goalMet: true,
    });
    openai.replyWith({
      audio: [[0.125]],
      says: "Can I also change my address?",
      goalMet: true,
    });
    await using session = await modelFor(openai).connect({
      persona: "a customer",
    });
    const actions = session.actions()[Symbol.asyncIterator]();

    session.pursue("get a refund");
    await upTo(actions, goalMet);
    session.pursue("change my address");
    const second = await upTo(actions, goalMet);

    expect(second).toContainEqual({
      type: "said",
      text: "Can I also change my address?",
    });
  });
});
