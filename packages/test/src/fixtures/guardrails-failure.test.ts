import { evaluate } from "@litmus/test";

// One grader, always rejects. The eval body returns successfully; the
// grader's verdict is what should fail the scenario.
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
  "grader rejects with 'violates content policy'",
  async ({ answer }) => answer,
);

// Two graders, both rejecting with distinct names and reasons. Verifies
// that the framework runs every grader and aggregates their reasons.
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
  "two graders reject with distinct names and reasons",
  async ({ answer }) => answer,
);

// Same two-rejection effect, but the second grader is registered via a
// chained .guardrails call rather than alongside the first. Both names
// in the failure message proves the chain accumulated.
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
  "first grader registered, then second appended via chained .guardrails",
  async ({ answer }) => answer,
);
