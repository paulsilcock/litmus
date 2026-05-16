import { evaluate } from "@litmus/test";

const base = evaluate
  .extend<{ answer: string }>(async (use) => {
    await use({ answer: "any response" });
  })
  .guardrails({
    "tone check": async () => ({ pass: false, reason: "tone too curt" }),
  });

const extended = base.guardrails({
  "policy check": async () => ({
    pass: false,
    reason: "violates content policy",
  }),
});

extended("agent answers within policy and on tone", async ({ answer }) => {
  return answer;
});
