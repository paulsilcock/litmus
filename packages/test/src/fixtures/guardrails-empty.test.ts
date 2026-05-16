import { evaluate } from "@litmus/test";

const e = evaluate
  .extend<{ x: number }>(async (use) => {
    await use({ x: 1 });
  })
  .guardrails({});

e("eval with no registered guardrails", async ({ x }) => {
  void x;
});
