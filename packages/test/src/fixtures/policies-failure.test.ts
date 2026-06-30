import { evaluate } from "@litmus/test";

// One grader, always rejects. The body calls policies(...) with
// a value the grader will reject.
const singleRejection = evaluate
  .extend<{ answer: string }>(async (use) => {
    await use({ answer: "any response" });
  })
  .withPolicies({
    "policy check": async () => ({
      pass: false,
      reason: "violates content policy",
    }),
  });

singleRejection(
  "grader rejects with 'violates content policy'",
  async ({ answer, policies }) => {
    await policies(answer);
  },
);

// Two graders, both rejecting with distinct names and reasons. Verifies
// that the framework runs every grader and aggregates their reasons.
const twoRejections = evaluate
  .extend<{ answer: string }>(async (use) => {
    await use({ answer: "any response" });
  })
  .withPolicies({
    "tone check": async () => ({ pass: false, reason: "tone too curt" }),
    "policy check": async () => ({
      pass: false,
      reason: "violates content policy",
    }),
  });

twoRejections(
  "two graders reject with distinct names and reasons",
  async ({ answer, policies }) => {
    await policies(answer);
  },
);

// Same two-rejection effect, but the second grader is registered via a
// chained .withPolicies call rather than alongside the first. Both
// names in the failure message proves the chain accumulated.
const baseChain = evaluate
  .extend<{ answer: string }>(async (use) => {
    await use({ answer: "any response" });
  })
  .withPolicies({
    "tone check": async () => ({ pass: false, reason: "tone too curt" }),
  });

const chainedEval = baseChain.withPolicies({
  "policy check": async () => ({
    pass: false,
    reason: "violates content policy",
  }),
});

chainedEval(
  "first grader registered, then second appended via chained .withPolicies",
  async ({ answer, policies }) => {
    await policies(answer);
  },
);

// Policies registered but the body never calls the fixture. The
// run wrapper's teardown check should fail this sample.
const forgottenEval = evaluate
  .extend<{ answer: string }>(async (use) => {
    await use({ answer: "any response" });
  })
  .withPolicies({
    "policy check": async () => ({ pass: true, reason: "" }),
  });

forgottenEval(
  "policies registered but body never calls them",
  async ({ answer }) => {
    void answer;
  },
);
