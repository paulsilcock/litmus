import { evaluate } from "@litmus/test";

const e = evaluate
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

e("agent answers within policy and on tone", async ({ answer }) => {
  return answer;
});
