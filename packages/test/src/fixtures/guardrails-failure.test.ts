import { evaluate } from "@litmus/test";

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
