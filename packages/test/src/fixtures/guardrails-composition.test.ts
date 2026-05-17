import { evaluate } from "@litmus/test";

const baseEval = evaluate
  .extend<{ answer: string }>(async (use) => {
    await use({ answer: "any response" });
  })
  .guardrails({
    "tone check": async () => ({ pass: false, reason: "tone too curt" }),
  });

// Chained .guardrails registrations accumulate — the second call's guardrail
// runs alongside the first, not in place of it.
const chainedEval = baseEval.guardrails({
  "policy check": async () => ({
    pass: false,
    reason: "violates content policy",
  }),
});

chainedEval(
  "chained .guardrails calls accumulate both registrations on the same eval",
  async ({ answer }) => answer,
);

// An empty map is a no-op: no guardrails registered, body return type
// stays unconstrained, eval passes cleanly.
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
