import { acceptance, llmJudge, UserSimulator } from "@litmus/test";
import { expect } from "vite-plus/test";

import { SonosChatDriver } from "#sonos/sonos-chat-driver.ts";
import { SonosChatDsl } from "#sonos/sonos-chat-dsl.ts";

/**
 * Real eval suite for the Sonos S1/S2 compatibility scenarios (see
 * sonoss1s2evalspec.yaml). It drives the live chatbot with a simulated
 * customer and grades the transcript with LLM-as-judge criteria and
 * guardrails lifted from the spec.
 *
 * Gated behind `LITMUS_SONOS_LIVE=1`: it needs a Chromium binary,
 * outbound access to support.sonos.com, and a model provider. Set the
 * model via `LITMUS_SONOS_SIM_MODEL` / `LITMUS_SONOS_JUDGE_MODEL`
 * (resolved through the AI SDK gateway, so a gateway/provider key must be
 * configured in the environment).
 */
const LIVE = process.env["LITMUS_SONOS_LIVE"] === "1";
const SIM_MODEL =
  process.env["LITMUS_SONOS_SIM_MODEL"] ?? "anthropic/claude-sonnet-4.5";
const JUDGE_MODEL =
  process.env["LITMUS_SONOS_JUDGE_MODEL"] ?? "anthropic/claude-sonnet-4.5";

/** Ground-truth product-tier reference, lifted from the eval spec. */
const REFERENCE_DATA = `Sonos S1/S2 platform split (June 2020). S1 products and S2
products CANNOT be on the same system: different apps, separate accounts,
cannot group or sync. "Both"-tier products can join EITHER an S1 or S2
system (not both at once).

S2-only: Arc, Arc SL, Arc Ultra, Beam (Gen 2), Era 100, Era 100 Pro,
Era 100 SL, Era 300, Five, Move 2, One SL (new), Play, Ray, Roam, Roam 2,
Roam SL, Sonos Ace, Sub (Gen 3), Sub 4, Sub Mini, SYMFONISK Bookshelf
Gen 2, SYMFONISK Floor lamp, SYMFONISK Picture frame, SYMFONISK Table
lamp Gen 2.

Both (S1 or S2): Amp, Beam (Gen 1), Boost, Connect (Gen 2), Connect:Amp
(Gen 2), Move, One (Gen 1), One (Gen 2), Play:1, Play:3, Play:5 (Gen 2),
Playbar, Playbase, Port, Sub (Gen 1), Sub (Gen 2), SYMFONISK Bookshelf
Gen 1, SYMFONISK Table lamp Gen 1.

S1-only: Bridge, Connect (Gen 1), Connect:Amp (Gen 1), CR200, Play:5
(Gen 1), ZonePlayer 100/120/80/90, ZonePlayer S5.

Surround pairing (separate from S1/S2): Arc/Arc Ultra/Beam Gen 2/Ray
support Era 100/Era 300 surrounds. Playbar supports Play:1, One, One SL,
Play:3, Play:5 Gen 2, Five and some SYMFONISK as surrounds — NOT Era
100/Era 300.`;

interface Scenario {
  name: string;
  persona: string;
  goal: string;
  openingMessage: string;
  behaviourNotes: string;
  groundTruth: string;
  maxTurns: number;
}

const scenarios: Scenario[] = [
  {
    name: "Free speaker from a friend",
    persona:
      "Non-technical customer in their 40s, unfamiliar with the S1/S2 split. Friendly and trusting; pushes for setup details when told something works.",
    goal: "Find out if a Play:5 Gen 1 (free from a friend) can be used alongside their existing Arc, both controlled from one app.",
    openingMessage:
      "Hi, my friend is giving me their old Sonos Play:5. I already have an Arc in my living room. Can I use the Play:5 in my kitchen?",
    behaviourNotes:
      "If told incompatible: ask why ('they're both Sonos speakers'), then whether anything makes it work, then what to buy instead that works with the Arc. If told compatible: ask if it shows in the same app, whether you can play the same music in both rooms, and how to set it up. If asked which generation: you're not sure, it's quite old (~8 years).",
    groundTruth:
      "Play:5 Gen 1 is S1-only. Arc is S2-only. They CANNOT be on the same system, in the same app, or grouped.",
    maxTurns: 8,
  },
  {
    name: "Upgrading hi-fi setup with new speakers",
    persona:
      "Audiophile in their 50s, technically comfortable but not a software person. Bought a Connect years ago to stream to a hi-fi amp; recently bought Era 300s.",
    goal: "Confirm their Connect Gen 1 and new Era 300s will all appear in one app to play music across the house.",
    openingMessage:
      "I have a Connect hooked up to my hi-fi in the lounge. I just bought two Era 300s for the bedroom and kitchen. Will they all show up in the same app?",
    behaviourNotes:
      "If told incompatible: be surprised ('I've had the Connect for years, what changed?'), ask what replaces the Connect but works with the Era 300s, and ask specifically about the Port. If asked which generation: bought it around 2015, the older silver one.",
    groundTruth:
      "Connect Gen 1 is S1-only. Era 300 is S2-only. They CANNOT be on the same system. The Port is the S2-compatible replacement for the Connect and solves the problem.",
    maxTurns: 8,
  },
  {
    name: "Playbar owner adding Era 100s",
    persona:
      "Customer in their 30s who has had a Playbar for years and assumes any Sonos speaker can pair as surrounds.",
    goal: "Find out if Era 100s can be used as surround speakers with their Playbar.",
    openingMessage:
      "I've got a Playbar for my TV. I want to add surround sound. Can I use two Era 100s as rear speakers with it?",
    behaviourNotes:
      "If told surrounds won't work: ask if they can at least be on the same system for music in other rooms, what speakers CAN be surrounds for a Playbar, and whether upgrading the soundbar would let you use Era 100 surrounds. If told fully incompatible: push back ('I thought the Playbar works with the new app?').",
    groundTruth:
      "Playbar is 'Both' tier, so it CAN be on the same S2 system as Era 100s. But the Playbar does NOT support Era 100 as surrounds (only Play:1, One, One SL, Play:3, Play:5 Gen 2, Five, some SYMFONISK). System-compatible: YES. Surround-pairable: NO. A correct answer addresses both.",
    maxTurns: 8,
  },
  {
    name: "Uncertain product generation",
    persona:
      "Non-technical customer who bought their Sonos secondhand and doesn't know the model generation. Slightly impatient but cooperative.",
    goal: "Find out if their Connect works with their Beam Gen 2 on the same system.",
    openingMessage:
      "Does my Connect work with my Beam Gen 2? I want them both on the same system.",
    behaviourNotes:
      "If asked which generation: ask how to find out (bought secondhand); if guided to check, say it looks like Gen 1 on the back. If told it works without being asked which version: push back ('older Sonos stuff doesn't always work with the new app'). If told it won't work without being asked: object ('I didn't tell you which version I have').",
    groundTruth:
      "'Connect' is ambiguous: Gen 1 is S1-only (incompatible with Beam Gen 2); Gen 2 is 'Both' tier (compatible). The agent must ask which generation before advising. If the customer confirms Gen 1, they are incompatible.",
    maxTurns: 8,
  },
  {
    name: "Customer assumes old speaker just works",
    persona:
      "Confident, slightly impatient customer who just spent a lot on a new Arc Ultra and Sub 4 and assumes all Sonos gear is interchangeable.",
    goal: "Add a ZonePlayer 90 (spare, from their dad) to their new Arc Ultra / Sub 4 system for a spare bedroom.",
    openingMessage:
      "Just set up my new Arc Ultra and Sub 4, sounds amazing. My dad has a spare ZonePlayer 90 he doesn't use. I'll just add it to my system for the spare bedroom yeah?",
    behaviourNotes:
      "If told incompatible: be incredulous ('it's still a Sonos speaker isn't it?'), ask if there's literally no way, then ask the cheapest speaker that will actually work with your system. If given a vague answer: demand a yes/no ('can I use it or not?').",
    groundTruth:
      "ZonePlayer 90 is S1-only. Arc Ultra and Sub 4 are S2-only. They CANNOT be on the same system. The agent must correct the assumption and explain the S1/S2 split.",
    maxTurns: 8,
  },
];

/** Pass-criteria from the spec, each parameterised by scenario ground truth. */
const criteria: { name: string; rubric: (scenario: Scenario) => string }[] = [
  {
    name: "Compatibility verdict is correct",
    rubric: (s) =>
      `Using the reference data, decide whether the named products CAN or CANNOT be on the same Sonos system, then check the agent's answer matches.
Rules: S1-only + S2-only = CANNOT coexist (different apps/accounts, cannot group). "Both" + S2-only = CAN. "Both" + S1-only = CAN.
FAIL if the agent says products can be on the same system / in the same app when they cannot, or gets one limitation right (e.g. surround) but wrongly claims system coexistence. The verdict must be fully correct to PASS.
Scenario ground truth: ${s.groundTruth}`,
  },
  {
    name: "S1/S2 split explained as the reason",
    rubric: (s) =>
      `If the products are compatible per the ground truth, auto-PASS (not applicable).
If incompatible: PASS only if the agent explicitly names the S1/S2 split (or "legacy app", "S1 Controller", "different Sonos apps", equivalent) AND explains the practical impact (separate apps/accounts, cannot group/sync). FAIL for a vague "not supported"/"incompatible" with no platform reason.
Scenario ground truth: ${s.groundTruth}`,
  },
  {
    name: "Clarification sought for ambiguous product",
    rubric: (s) =>
      `Ambiguous products (two generations, different compatibility): Connect, Play:5, Connect:Amp.
If the scenario does NOT involve an ambiguous product, auto-PASS.
If it does: PASS if the agent asks which generation (or asks the customer to check, e.g. via their account page) before advising; FAIL if it assumes a generation.
Scenario ground truth: ${s.groundTruth}`,
  },
];

/** Cross-cutting guardrails from the spec, applied to every transcript. */
const noFabricatedProducts = llmJudge<string>({
  model: JUDGE_MODEL,
  prompt: (transcript) =>
    `Did the agent reference any Sonos product, feature, app, or support article that does not actually exist? Verify against the reference data. PASS if everything referenced is real; FAIL if anything is fabricated.\n\nReference data:\n${REFERENCE_DATA}\n\nTranscript:\n${transcript}`,
});

const noFabricatedWorkarounds = llmJudge<string>({
  model: JUDGE_MODEL,
  prompt: (transcript) =>
    `Did the agent suggest a workaround that is not an official Sonos capability? Official options: running separate S1/S2 systems (separate apps/accounts), trade-in/upgrade programmes, buying compatible replacements. PASS if all suggestions are official; FAIL if any is fabricated or unsupported.\n\nTranscript:\n${transcript}`,
});

const helpfulToneOnBadNews = llmJudge<string>({
  model: JUDGE_MODEL,
  prompt: (transcript) =>
    `If the agent delivered bad news (incompatible products), did it acknowledge the inconvenience and offer at least one actionable next step? PASS if empathetic with a constructive path forward (or if no bad news was delivered). FAIL if dismissive, blunt, or offering no path forward.\n\nTranscript:\n${transcript}`,
});

type Turn = { role: "user" | "assistant"; content: string };

function renderTranscript(turns: readonly Turn[]): string {
  return turns
    .map((t) => `${t.role === "user" ? "Customer" : "Agent"}: ${t.content}`)
    .join("\n");
}

function buildUserPrompt(scenario: Scenario, turns: readonly Turn[]): string {
  const history = turns
    .map((t) => `${t.role === "user" ? "You" : "Agent"}: ${t.content}`)
    .join("\n");
  return `You are role-playing a Sonos customer in a live support chat.

Persona: ${scenario.persona}
Your goal: ${scenario.goal}

How to behave as the conversation unfolds:
${scenario.behaviourNotes}

Stay in character. Keep messages short and realistic. Set done=true once your goal is resolved (you have a clear answer) or it is clear the agent cannot help further.

Conversation so far:
${history || "(none yet)"}

Decide your next message.`;
}

const { evaluate } = acceptance(async () => {
  const driver = new SonosChatDriver();
  await driver.init();
  return new SonosChatDsl(driver);
});

const guarded = evaluate.withGuardrails({
  "no fabricated products or features": noFabricatedProducts,
  "no fabricated workarounds": noFabricatedWorkarounds,
  "helpful tone when delivering bad news": helpfulToneOnBadNews,
});

guarded.runIf(LIVE).scenarios(scenarios, {
  samples: 5,
  passRate: 0.8,
  labelBy: (s) => s.name,
})(
  "agent advises S1/S2 compatibility correctly",
  async (scenario, { dsl, guardrails }) => {
    await dsl.openSupportChat();

    const simulator = new UserSimulator({
      model: SIM_MODEL,
      maxTurns: scenario.maxTurns,
      prompt: (turns) => buildUserPrompt(scenario, turns),
    });

    const conversation = await simulator.run({
      opening: scenario.openingMessage,
      onMessage: (message) => dsl.say(message),
    });

    const transcript = renderTranscript(conversation.turns);

    for (const criterion of criteria) {
      const grade = llmJudge<string>({
        model: JUDGE_MODEL,
        prompt: () =>
          `${criterion.rubric(scenario)}\n\nReference data:\n${REFERENCE_DATA}\n\nTranscript:\n${transcript}`,
      });
      const verdict = await grade(transcript);
      expect(verdict.pass, `[${criterion.name}] ${verdict.reason}`).toBe(true);
    }

    await guardrails(transcript);
  },
);
