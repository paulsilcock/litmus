import { tool } from "ai";
import {
  MockLanguageModelV3,
  MockSpeechModelV3,
  MockTranscriptionModelV3,
} from "ai/test";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { VoiceUserSimulator } from "#litmus-test/voice-simulator.ts";

const mockLanguageResult = {
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  },
  warnings: [],
};

const mockSpeechMeta = {
  warnings: [],
  response: { timestamp: new Date(), modelId: "mock", headers: {} },
};

const mockTranscriptionMeta = {
  segments: [],
  language: undefined,
  durationInSeconds: undefined,
  warnings: [],
  response: { timestamp: new Date(), modelId: "mock", headers: {} },
};

/** TTS mock that UTF-8 encodes the input text as fake audio. */
const encodingSpeechMock = () =>
  new MockSpeechModelV3({
    doGenerate: async ({ text }) => ({
      ...mockSpeechMeta,
      audio: new TextEncoder().encode(text),
    }),
  });

/** STT mock that UTF-8 decodes the input audio back to text. */
const decodingTranscriptionMock = () =>
  new MockTranscriptionModelV3({
    doGenerate: async ({ audio }) => ({
      ...mockTranscriptionMeta,
      text: typeof audio === "string" ? audio : new TextDecoder().decode(audio),
    }),
  });

describe("VoiceUserSimulator", () => {
  it("the simulated user ends the conversation once their goal is met", async () => {
    const llmResponses = [
      { message: "What's my balance?", done: false },
      { message: "Thanks!", done: true },
    ];
    let llmCall = 0;

    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockLanguageResult,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(llmResponses[llmCall++]),
          },
        ],
        finishReason: { unified: "stop" as const, raw: undefined },
      }),
    });

    // Speech mock turns the LLM's text into "audio" by UTF-8 encoding it,
    // so the test can round-trip it back through transcription.
    const speech = new MockSpeechModelV3({
      doGenerate: async ({ text }) => ({
        ...mockSpeechMeta,
        audio: new TextEncoder().encode(text),
      }),
    });

    // Transcription mock decodes the bytes back to text.
    const transcription = new MockTranscriptionModelV3({
      doGenerate: async ({ audio }) => ({
        ...mockTranscriptionMeta,
        text:
          typeof audio === "string" ? audio : new TextDecoder().decode(audio),
      }),
    });

    const simulator = new VoiceUserSimulator({
      model,
      speech,
      transcription,
      persona: "Customer checking their account",
      goal: "Find out my account balance",
    });

    const conversation = await simulator.run({
      onMessage: async (audio) => {
        const heardFromUser = new TextDecoder().decode(audio.data);
        const reply = heardFromUser.toLowerCase().includes("balance")
          ? "$1250"
          : "OK";
        return {
          data: new TextEncoder().encode(reply),
          mediaType: "audio/wav",
        };
      },
    });

    expect(conversation.outcome).toBe("goal_met");
    expect(conversation.turns).toEqual([
      { role: "user", content: "What's my balance?" },
      { role: "assistant", content: "$1250" },
      { role: "user", content: "Thanks!" },
    ]);
  });

  it("the simulated user gives up after a configured number of turns when the goal is never reached", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockLanguageResult,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ message: "still trying", done: false }),
          },
        ],
        finishReason: { unified: "stop" as const, raw: undefined },
      }),
    });

    const speech = encodingSpeechMock();
    const transcription = decodingTranscriptionMock();

    const simulator = new VoiceUserSimulator({
      model,
      speech,
      transcription,
      persona: "Stubborn customer",
      goal: "Get a refund",
      maxTurns: 3,
    });

    const conversation = await simulator.run({
      onMessage: async () => ({
        data: new TextEncoder().encode("I can't help with that"),
        mediaType: "audio/wav",
      }),
    });

    expect(conversation.outcome).toBe("max_turns");
    expect(conversation.turns).toHaveLength(6);
    expect(conversation.turns.filter((t) => t.role === "user")).toHaveLength(3);
    expect(
      conversation.turns.filter((t) => t.role === "assistant"),
    ).toHaveLength(3);
  });

  it("the simulated user can wait for a message rather than opening the conversation", async () => {
    // `awaitOpening` is how the test author tells the simulator
    // "wait for the system to greet first, then start". The system's
    // opening audio is transcribed; the resulting text is recorded
    // as the assistant's first turn and reaches the prompt context
    // for the user's first reply.
    let capturedPrompt = "";
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        capturedPrompt = JSON.stringify(prompt);
        return {
          ...mockLanguageResult,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                message: "I'd like to book a flight",
                done: true,
              }),
            },
          ],
          finishReason: { unified: "stop" as const, raw: undefined },
        };
      },
    });

    const speech = encodingSpeechMock();
    const transcription = decodingTranscriptionMock();

    const simulator = new VoiceUserSimulator({
      model,
      speech,
      transcription,
      persona: "Customer needing to book a flight",
      goal: "Book a flight to Tokyo",
    });

    const conversation = await simulator.run({
      // Stand-in for `dsl.agent.respondsWith()` — anything that
      // resolves with audio once the system has spoken.
      awaitOpening: async () => ({
        data: new TextEncoder().encode("Hello, how can I help you today?"),
        mediaType: "audio/wav",
      }),
      onMessage: async () => ({
        data: new TextEncoder().encode("OK"),
        mediaType: "audio/wav",
      }),
    });

    expect(conversation.turns).toEqual([
      { role: "assistant", content: "Hello, how can I help you today?" },
      { role: "user", content: "I'd like to book a flight" },
    ]);
    // The opening reaches the prompt context, so the user's reply
    // is grounded in what the system actually said.
    expect(capturedPrompt).toContain("Hello, how can I help you today?");
  });

  it("the conversation ends when the system declines to continue", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockLanguageResult,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              message: "you're useless",
              done: false,
            }),
          },
        ],
        finishReason: { unified: "stop" as const, raw: undefined },
      }),
    });

    const simulator = new VoiceUserSimulator({
      model,
      speech: encodingSpeechMock(),
      transcription: decodingTranscriptionMock(),
      persona: "Abusive customer",
      goal: "Win the argument",
    });

    const conversation = await simulator.run({
      onMessage: async () => ({
        done: true,
        reason: "abusive language",
      }),
    });

    expect(conversation.outcome).toBe("terminated");
    expect(conversation.turns).toHaveLength(1);
    expect(conversation.turns[0]).toEqual({
      role: "user",
      content: "you're useless",
    });
  });

  it("the simulated user can open the conversation with a predetermined message", async () => {
    // Caller supplies the user's first message verbatim; the LLM is
    // only consulted from turn 2 onwards.
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockLanguageResult,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ message: "Thanks!", done: true }),
          },
        ],
        finishReason: { unified: "stop" as const, raw: undefined },
      }),
    });

    const simulator = new VoiceUserSimulator({
      model,
      speech: encodingSpeechMock(),
      transcription: decodingTranscriptionMock(),
      persona: "Customer",
      goal: "Find out my balance",
    });

    const conversation = await simulator.run({
      opening: "What's my balance?",
      onMessage: async () => ({
        data: new TextEncoder().encode("$1250"),
        mediaType: "audio/wav",
      }),
    });

    expect(conversation.outcome).toBe("goal_met");
    expect(conversation.turns).toEqual([
      { role: "user", content: "What's my balance?" },
      { role: "assistant", content: "$1250" },
      { role: "user", content: "Thanks!" },
    ]);
  });

  it("the simulated user can take actions via tools before producing the next utterance", async () => {
    const toolCalls: Array<{ code: string }> = [];
    const synthesizedTexts: string[] = [];

    // Scripted LLM responses for the tool round-trip:
    //   1. First call inside turn 1: emit a tool call.
    //   2. Second call inside turn 1: emit the final user message.
    //   3. Turn 2: thanks, done.
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
        ...mockLanguageResult,
        ...responses[callIndex++],
      }),
    });

    // Speech mock captures which texts were synthesised — lets us
    // assert that TTS ran on the final user messages only, not on
    // the tool-call round.
    const speech = new MockSpeechModelV3({
      doGenerate: async ({ text }) => {
        synthesizedTexts.push(text);
        return {
          ...mockSpeechMeta,
          audio: new TextEncoder().encode(text),
        };
      },
    });

    const simulator = new VoiceUserSimulator({
      model,
      speech,
      transcription: decodingTranscriptionMock(),
      persona: "Bargain hunter",
      goal: "Apply discount code and check total",
      tools: {
        apply_discount: tool({
          description: "Apply a discount code",
          inputSchema: z.object({ code: z.string() }),
          execute: async ({ code }) => {
            toolCalls.push({ code });
            return { applied: true };
          },
        }),
      },
    });

    const conversation = await simulator.run({
      onMessage: async () => ({
        data: new TextEncoder().encode("$45.00"),
        mediaType: "audio/wav",
      }),
    });

    expect(toolCalls).toEqual([{ code: "SAVE10" }]);
    expect(conversation.outcome).toBe("goal_met");
    expect(conversation.turns).toEqual([
      {
        role: "user",
        content: "I've applied my discount code, what's the total?",
      },
      { role: "assistant", content: "$45.00" },
      { role: "user", content: "Thanks!" },
    ]);
    // Tool calls happen "off-stage" inside generateText. Only the
    // LLM's spoken messages reach the speech model.
    expect(synthesizedTexts).toEqual([
      "I've applied my discount code, what's the total?",
      "Thanks!",
    ]);
  });

  it("simulated user behaviour can be configured with a free-text prompt", async () => {
    let capturedPrompt = "";
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        capturedPrompt = JSON.stringify(prompt);
        return {
          ...mockLanguageResult,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ message: "ok", done: true }),
            },
          ],
          finishReason: { unified: "stop" as const, raw: undefined },
        };
      },
    });

    const simulator = new VoiceUserSimulator({
      model,
      speech: encodingSpeechMock(),
      transcription: decodingTranscriptionMock(),
      prompt: () => "custom-prompt-text",
    });

    await simulator.run({
      onMessage: async () => ({
        data: new TextEncoder().encode("never reached"),
        mediaType: "audio/wav",
      }),
    });

    expect(capturedPrompt).toContain("custom-prompt-text");
  });
});
