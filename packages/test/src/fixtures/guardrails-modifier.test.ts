import { evaluate } from "@litmus/test";

// .only must preserve guardrails through the modifier — without this the
// focused eval would silently bypass every grader. Lives in its own fixture
// because .only filters the entire vitest file: any sibling evals here would
// be skipped, defeating the rest of the suite's assertions.
const guardedEval = evaluate
  .extend<{ answer: string }>(async (use) => {
    await use({ answer: "any response" });
  })
  .guardrails({
    "policy check": async () => ({
      pass: false,
      reason: "violates content policy",
    }),
  });

guardedEval.only(
  "focused eval still runs every registered guardrail",
  async ({ answer }) => answer,
);
