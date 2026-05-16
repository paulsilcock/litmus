import { evaluate } from "@litmus/test";

const e = evaluate
  .extend<{ answer: string }>(async (use) => {
    await use({ answer: "any response" });
  })
  .guardrails({
    "policy check": async () => ({
      pass: false,
      reason: "violates content policy",
    }),
  });

e.only("focused eval still runs guardrails", async ({ answer }) => answer);
