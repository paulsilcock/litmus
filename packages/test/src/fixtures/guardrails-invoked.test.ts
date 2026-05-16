import { appendFileSync } from "node:fs";

import { evaluate } from "@litmus/test";

const log = process.env.LITMUS_TEST_LOG;
const append = (s: string) => {
  if (log) appendFileSync(log, s + "\n");
};

const e = evaluate
  .extend<{ greeting: string }>(async (use) => {
    await use({ greeting: "hello" });
  })
  .guardrails({
    "echo guardrail": async (input) => {
      append(`grader-called:${input}`);
      return { pass: true, reason: "" };
    },
  });

e("body output flows to guardrail", async ({ greeting }) => {
  return greeting;
});
