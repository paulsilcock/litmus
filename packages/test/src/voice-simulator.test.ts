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
        const heardFromUser = new TextDecoder().decode(audio.uint8Array);
        const reply = heardFromUser.toLowerCase().includes("balance")
          ? "$1250"
          : "OK";
        return {
          uint8Array: new TextEncoder().encode(reply),
          base64: "",
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
});
