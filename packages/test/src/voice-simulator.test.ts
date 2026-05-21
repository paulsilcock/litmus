import {
  MockLanguageModelV3,
  MockSpeechModelV3,
  MockTranscriptionModelV3,
} from "ai/test";
import { describe, expect, it } from "vite-plus/test";

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

  it("when the system speaks first, the user's first reply is informed by its opening", async () => {
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
});
