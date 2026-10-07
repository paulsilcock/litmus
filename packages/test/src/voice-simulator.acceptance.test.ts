import { OpenAIRealtimeVoiceModel } from "@litmus/ai/openai";
import { FakeRealtimeServer } from "@litmus/ai/openai/testing";
import { describe, expect, it } from "vite-plus/test";

import { UserSimulator } from "#litmus-test/simulator.ts";
import { FakeVoiceSupportDsl } from "#litmus-test/test-support/fake-voice-support-dsl.ts";
import { mockSpeech } from "#litmus-test/test-support/mock-speech.ts";

describe("voice user simulator", () => {
  it("a simulated user can pursue a goal by talking to a voice system", async () => {
    // OpenAI Realtime is stubbed, so what the simulated user says is canned.
    // This proves the wiring — speech out, speech back in, the goal being
    // reported — not the model's judgement.
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({ audio: mockSpeech("I'd like a refund for order 1234") });
    openai.replyWith({ audio: mockSpeech("Thanks!"), goalMet: true });

    const dsl = new FakeVoiceSupportDsl();
    await dsl.orders.customerHasOrdered({ order: "1234" });

    await using customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer whose order 1234 arrived damaged",
      speak: (audio) => dsl.support.customerSays(audio),
      listen: () => dsl.support.agentSays(),
    });

    const result = await customer.pursueGoal("get a refund for order 1234");

    expect(result.met).toBe(true);
    await dsl.orders.assertRefunded({ order: "1234" });
  });
});
