import { setImmediate, setTimeout as sleep } from "node:timers/promises";

import { OpenAIRealtimeVoiceModel } from "@litmus/ai/openai";
import { FakeRealtimeServer } from "@litmus/ai/openai/testing";
import type { Audio } from "@litmus/core/ai";
import { describe, expect, it, vi } from "vite-plus/test";

import type { Turn } from "#litmus-test/conversation.ts";
import { UserSimulator } from "#litmus-test/simulator.ts";

/** A system that says nothing. Like real audio, its silence arrives over time. */
async function silentSystem(): Promise<Audio> {
  await setImmediate();
  return { samples: [0, 0, 0, 0], sampleRate: 24_000 };
}

describe("voice user simulator", () => {
  it("what the simulated user says reaches the system", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({
      audio: [
        [0.5, -0.25],
        [0.125, 0],
      ],
      goalMet: true,
    });
    const heardBySystem: Audio[] = [];

    const customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      speak: async (audio) => {
        heardBySystem.push(audio);
      },
      listen: silentSystem,
    });

    await customer.pursueGoal("get a refund");

    expect(heardBySystem).toEqual([
      { samples: [0.5, -0.25], sampleRate: 24_000 },
      { samples: [0.125, 0], sampleRate: 24_000 },
    ]);
  });

  it("who the simulated user is and what it's after reach the model", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({ audio: [], goalMet: true });

    const customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer whose book arrived damaged",
      speak: async () => {},
      listen: silentSystem,
    });

    await customer.pursueGoal("get a replacement");

    expect(openai.instructions()).toContain(
      "a customer whose book arrived damaged",
    );
    expect(openai.instructions()).toContain("get a replacement");
  });

  it("the pursuit ends when the simulated user's goal is met", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({ audio: [[0.25]], goalMet: true });

    const customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      speak: async () => {},
      listen: silentSystem,
    });

    const result = await customer.pursueGoal("get a refund");

    expect(result).toEqual({ met: true, reason: "goal_met" });
  });

  it("what the system says reaches the simulated user", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({ audio: [[0.25]] });
    openai.replyWith({ audio: [[0.125]], goalMet: true });
    const systemSays = [[0.5, -0.25], [0.375]];

    const customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      speak: async () => {},
      listen: async () => {
        await setImmediate();
        return {
          samples: systemSays.shift() ?? [0, 0, 0, 0],
          sampleRate: 24_000,
        };
      },
    });

    await customer.pursueGoal("get a refund");

    expect(openai.heardSpeech()).toEqual([0.5, -0.25, 0.375]);
  });

  it("what the simulated user says is recorded in the transcript", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({
      audio: [[0.25]],
      says: "Hi, I'd like a refund",
      goalMet: true,
    });

    const customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      speak: async () => {},
      listen: silentSystem,
    });

    await customer.pursueGoal("get a refund");

    expect(await customer.transcript()).toEqual([
      { speaker: "simulatedUser", content: "Hi, I'd like a refund" },
    ]);
  });

  it("the conversation can be watched turn by turn as it happens", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({ audio: [[0.25]], says: "Hi, I'd like a refund" });
    openai.transcribesHeardSpeechAs("Sure, what's the order number?");
    openai.replyWith({
      audio: [[0.125]],
      says: "It's order 1234",
      goalMet: true,
    });
    const systemSays = [[0.5, -0.25]];
    const watched: Turn[] = [];
    const watchedBeforeFinalReply: number[] = [];

    await using customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      speak: async (audio) => {
        if (audio.samples[0] === 0.125) {
          watchedBeforeFinalReply.push(watched.length);
        }
      },
      listen: async () => {
        await setImmediate();
        return {
          samples: systemSays.shift() ?? [0, 0, 0, 0],
          sampleRate: 24_000,
        };
      },
      watch: (turn) => watched.push(turn),
    });
    await customer.pursueGoal("get a refund");

    expect(watched).toEqual(await customer.transcript());
    // Turns arrive while the conversation is still going, not all at the end.
    expect(watchedBeforeFinalReply[0]).toBeGreaterThan(0);
  });

  it("what the system says is recorded in the transcript", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({ audio: [[0.25]], says: "Hi, I'd like a refund" });
    openai.replyWith({
      audio: [[0.125]],
      says: "It's order 1234",
      goalMet: true,
    });
    openai.transcribesHeardSpeechAs("Sure, what's the order number?");
    const systemSays = [[0.5, -0.25]];

    const customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      speak: async () => {},
      listen: async () => {
        await setImmediate();
        return {
          samples: systemSays.shift() ?? [0, 0, 0, 0],
          sampleRate: 24_000,
        };
      },
    });

    await customer.pursueGoal("get a refund");

    expect(await customer.transcript()).toEqual([
      { speaker: "simulatedUser", content: "Hi, I'd like a refund" },
      { speaker: "systemUnderTest", content: "Sure, what's the order number?" },
      { speaker: "simulatedUser", content: "It's order 1234" },
    ]);
  });

  it("a simulated user can hear the system out before pursuing its goal", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.transcribesHeardSpeechAs("Hello, how can I help?");
    openai.replyWith({
      audio: [[0.25]],
      says: "Hi, I'd like a refund",
      goalMet: true,
    });
    const systemSays = [[0.5, -0.25]];
    const spoken: Audio[] = [];

    const customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      speak: async (audio) => {
        spoken.push(audio);
      },
      listen: async () => {
        await setImmediate();
        return {
          samples: systemSays.shift() ?? [0, 0, 0, 0],
          sampleRate: 24_000,
        };
      },
    });

    const greeting = await customer.hear();
    const spokenWhileHearing = spoken.length;
    await customer.pursueGoal("get a refund");

    expect(greeting).toBe("Hello, how can I help?");
    expect(spokenWhileHearing).toBe(0);
    expect(await customer.transcript()).toEqual([
      { speaker: "systemUnderTest", content: "Hello, how can I help?" },
      { speaker: "simulatedUser", content: "Hi, I'd like a refund" },
    ]);
    expect(openai.connections()).toBe(1);
  });

  it("waiting for a system that never speaks fails clearly", async () => {
    await using openai = await FakeRealtimeServer.start();

    await using customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      speak: async () => {},
      listen: silentSystem,
      silenceTimeout: 50,
    });

    await expect(customer.hear()).rejects.toThrow(
      "The system said nothing for 50ms",
    );
    await expect(customer.hear()).rejects.toThrow("The conversation has ended");
  });

  it("a pursuit fails clearly when the system stops replying", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({ audio: [[0.25]], says: "I'd like a refund" });
    openai.transcribesHeardSpeechAs("What's your order number?");
    openai.replyWith({ audio: [[0.125]], says: "It's order 1234" });
    let replies = 0;
    let spoken = false;

    await using customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      speak: async () => {
        spoken = true;
      },
      // The system replies once the simulated user has spoken, then never again.
      listen: async () => {
        await setImmediate();
        const replying = spoken && replies++ < 3;
        return { samples: replying ? [0.5] : [0, 0, 0, 0], sampleRate: 24_000 };
      },
      silenceTimeout: 200,
    });

    await expect(customer.pursueGoal("get a refund")).rejects.toThrow(
      "The system said nothing for 200ms",
    );
    expect(await customer.transcript()).toEqual([
      { speaker: "simulatedUser", content: "I'd like a refund" },
      { speaker: "systemUnderTest", content: "What's your order number?" },
      { speaker: "simulatedUser", content: "It's order 1234" },
    ]);
  });

  it("the system's wait starts once the simulated user's words have played", async () => {
    await using openai = await FakeRealtimeServer.start();
    // 600ms of speech, at 24kHz.
    openai.replyWith({ audio: [Array(14_400).fill(0.25)], says: "Hi" });
    openai.transcribesHeardSpeechAs("Hello, how can I help?");
    openai.replyWith({ audio: [[0.125]], says: "A refund", goalMet: true });
    let spokeAt: number | undefined;
    let replies = 0;

    await using customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      // Like a browser, returns as soon as the audio is queued to play.
      speak: async () => {
        spokeAt ??= Date.now();
      },
      // The system replies 650ms after the simulated user starts speaking.
      listen: async () => {
        await sleep(10);
        const replying =
          spokeAt !== undefined && Date.now() >= spokeAt + 650 && replies++ < 3;
        return { samples: replying ? [0.5] : [0, 0, 0, 0], sampleRate: 24_000 };
      },
      silenceTimeout: 400,
    });

    expect(await customer.pursueGoal("get a refund")).toEqual({
      met: true,
      reason: "goal_met",
    });
  });

  it("a system that talks for longer than the wait isn't cut off", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.transcribesHeardSpeechAs("Let me read you our refund policy");
    let chunks = 0;

    await using customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      speak: async () => {},
      // The system talks for at least 300ms, then falls silent.
      listen: async () => {
        await sleep(10);
        return {
          samples: chunks++ < 30 ? [0.5] : [0, 0, 0, 0],
          sampleRate: 24_000,
        };
      },
      silenceTimeout: 200,
    });

    expect(await customer.hear()).toBe("Let me read you our refund policy");
  });

  it("audio at a rate the model can't listen to fails clearly", async () => {
    await using openai = await FakeRealtimeServer.start();

    await using customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      speak: async () => {},
      listen: async () => {
        await setImmediate();
        return { samples: [0, 0, 0, 0], sampleRate: 48_000 };
      },
    });

    await expect(customer.hear()).rejects.toThrow(
      "The voice model listens at 24000Hz, but `listen` gave audio at 48000Hz",
    );
    await expect(customer.hear()).rejects.toThrow("The conversation has ended");
  });

  it("hearing the system fails clearly when its words can't be made out", async () => {
    await using openai = await FakeRealtimeServer.start();
    const systemSays = [[0.5, -0.25]];

    await using customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      speak: async () => {},
      listen: async () => {
        await setImmediate();
        return {
          samples: systemSays.shift() ?? [0, 0, 0, 0],
          sampleRate: 24_000,
        };
      },
    });

    await expect(customer.hear()).rejects.toThrow(
      "Couldn't make out what the system said (Transcription failed).",
    );
  });

  it("a second pursuit carries on the same conversation", async () => {
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

    const customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      speak: async () => {},
      listen: silentSystem,
    });

    await customer.pursueGoal("get a refund");
    const second = await customer.pursueGoal("change my address");

    expect(second).toEqual({ met: true, reason: "goal_met" });
    expect(openai.connections()).toBe(1);
  });

  it("a simulated user that never meets its goal hangs up after its turn limit", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({ audio: [[0.25]], says: "I'd like a refund" });
    openai.replyWith({ audio: [[0.125]], says: "Are you still there?" });
    openai.replyWith({ audio: [[0.25]], says: "Hello?" });
    let speaking = false;

    await using customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      speak: async () => {},
      // The system never stops talking, so the conversation never runs dry.
      listen: async () => {
        await setImmediate();
        speaking = !speaking;
        return { samples: speaking ? [0.5] : [0, 0, 0, 0], sampleRate: 24_000 };
      },
    });

    const result = await customer.pursueGoal("get a refund", { maxTurns: 2 });

    expect(result).toEqual({ met: false, reason: "max_turns" });
    expect(await customer.transcript()).toEqual([
      { speaker: "simulatedUser", content: "I'd like a refund" },
      { speaker: "simulatedUser", content: "Are you still there?" },
    ]);
    await vi.waitFor(() => expect(openai.openConnections()).toBe(0));
  });

  it("a conversation that has ended can't be carried on", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({ audio: [[0.25]], says: "I'd like a refund" });

    await using customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      speak: async () => {},
      listen: silentSystem,
    });
    await customer.pursueGoal("get a refund", { maxTurns: 1 });

    await expect(customer.pursueGoal("try again")).rejects.toThrow(
      "The conversation has ended. The simulated user gave up after 1 turn.",
    );
    await expect(customer.hear()).rejects.toThrow(
      "The conversation has ended. The simulated user gave up after 1 turn.",
    );
  });

  it("a dropped connection ends the conversation with an error", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({ audio: [[0.25]], says: "Hi, I'd like a refund" });

    await using customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      // The connection drops as soon as the simulated user starts talking.
      speak: async () => openai.dropConnections(),
      listen: silentSystem,
    });

    await expect(customer.pursueGoal("get a refund")).rejects.toThrow(
      "The connection to OpenAI Realtime closed unexpectedly (code 1006)",
    );
    await expect(customer.pursueGoal("try again")).rejects.toThrow(
      "The conversation has ended. The connection to OpenAI Realtime closed unexpectedly (code 1006).",
    );
  });

  it("an error from OpenAI ends the conversation with its message", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWithError(
      "The server had an error while processing your request.",
    );

    await using customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      speak: async () => {},
      listen: silentSystem,
    });

    await expect(customer.pursueGoal("get a refund")).rejects.toThrow(
      "The server had an error while processing your request.",
    );
  });

  it("a reply OpenAI fails to finish ends the conversation with its reason", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.replyWith({
      audio: [[0.25]],
      failsWith: "Inference rate limit exceeded.",
    });

    await using customer = UserSimulator.voice({
      model: new OpenAIRealtimeVoiceModel({
        apiKey: "sk-test",
        url: openai.url,
      }),
      persona: "a customer",
      speak: async () => {},
      listen: silentSystem,
    });

    await expect(customer.pursueGoal("get a refund")).rejects.toThrow(
      "Inference rate limit exceeded.",
    );
  });

  it("disposing the simulator ends its conversation", async () => {
    await using openai = await FakeRealtimeServer.start();
    openai.transcribesHeardSpeechAs("Hello, how can I help?");
    const systemSays = [[0.5, -0.25]];

    {
      await using customer = UserSimulator.voice({
        model: new OpenAIRealtimeVoiceModel({
          apiKey: "sk-test",
          url: openai.url,
        }),
        persona: "a customer",
        speak: async () => {},
        listen: async () => {
          await setImmediate();
          return {
            samples: systemSays.shift() ?? [0, 0, 0, 0],
            sampleRate: 24_000,
          };
        },
      });
      await customer.hear();
    }

    await vi.waitFor(() => expect(openai.openConnections()).toBe(0));
  });
});
