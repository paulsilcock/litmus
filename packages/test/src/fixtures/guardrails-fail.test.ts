import { evaluate } from "@litmus/test";

const e = evaluate
  .extend<{ output: string }>(async (use) => {
    await use({ output: "anything" });
  })
  .guardrails({
    "always fails": async () => ({ pass: false, reason: "nope" }),
  });

e("body output is rejected by guardrail", async ({ output }) => {
  return output;
});
