import { appendFileSync } from "node:fs";

import { evaluate } from "@litmus/test";

const log = process.env.LITMUS_TEST_LOG;
const append = (s: string) => {
  if (log) appendFileSync(log, s + "\n");
};

// ── Invocation: passing grader observes the body's output ────────────

const echoingEval = evaluate
  .extend<{ greeting: string }>(async (use) => {
    await use({ greeting: "hello" });
  })
  .guardrails({
    "transcript review": async (input) => {
      append(`grader-called:${input}`);
      return { pass: true, reason: "" };
    },
  });

echoingEval(
  "grader is invoked with the body's return value",
  async ({ greeting }) => greeting,
);

echoingEval(
  "a passing grader leaves the scenario passing",
  async ({ greeting }) => greeting,
);

// ── Failure: a rejecting grader fails the sample and names itself ────

const singleRejection = evaluate
  .extend<{ answer: string }>(async (use) => {
    await use({ answer: "any response" });
  })
  .guardrails({
    "policy check": async () => ({
      pass: false,
      reason: "violates content policy",
    }),
  });

singleRejection(
  "guardrail rejection fails the scenario and surfaces its name and reason",
  async ({ answer }) => answer,
);

// ── Failure: every failing grader's reason surfaces, not just the first

const twoRejections = evaluate
  .extend<{ answer: string }>(async (use) => {
    await use({ answer: "any response" });
  })
  .guardrails({
    "tone check": async () => ({ pass: false, reason: "tone too curt" }),
    "policy check": async () => ({
      pass: false,
      reason: "violates content policy",
    }),
  });

twoRejections(
  "every failing guardrail surfaces its name and reason in one failure message",
  async ({ answer }) => answer,
);

// ── Composition: chained .guardrails accumulate ──────────────────────

const baseChain = evaluate
  .extend<{ answer: string }>(async (use) => {
    await use({ answer: "any response" });
  })
  .guardrails({
    "tone check": async () => ({ pass: false, reason: "tone too curt" }),
  });

const chainedEval = baseChain.guardrails({
  "policy check": async () => ({
    pass: false,
    reason: "violates content policy",
  }),
});

chainedEval(
  "chained .guardrails calls accumulate both registrations on the same eval",
  async ({ answer }) => answer,
);

// ── Composition: empty registration is a no-op ───────────────────────

const unguardedEval = evaluate
  .extend<{ x: number }>(async (use) => {
    await use({ x: 1 });
  })
  .guardrails({});

unguardedEval(
  ".guardrails({}) registers nothing and leaves the body unconstrained",
  async ({ x }) => {
    void x;
  },
);

// ── Scenarios form: grader runs per (scenario, sample) ───────────────

const customers = [{ name: "alice" }, { name: "bob" }];

const scenariosEval = evaluate
  .extend<{ greeting: string }>(async (use) => {
    await use({ greeting: "hello" });
  })
  .guardrails({
    "policy check": async (input) => {
      append(`graded:${input}`);
      return { pass: false, reason: "violates content policy" };
    },
  });

scenariosEval.scenarios(customers, { labelBy: (c) => c.name, samples: 2 })(
  "guardrails grade every scenario's body and fail it on rejection",
  async (scenario, { greeting }) => `${greeting} ${scenario.name}`,
);
