import { evaluate } from "@litmus/test";

// .only filters the whole vitest file — anything else here would be
// silently skipped, defeating sibling assertions. Lives alone for that
// reason.
const guardedEval = evaluate
  .extend<{ answer: string }>(async (use) => {
    await use({ answer: "any response" });
  })
  .withGuardrails({
    "policy check": async () => ({
      pass: false,
      reason: "violates content policy",
    }),
  });

guardedEval.only(
  "rejecting grader registered, then .only applied",
  async ({ answer, guardrails }) => {
    await guardrails(answer);
  },
);
