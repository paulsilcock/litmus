import { appendFileSync } from "node:fs";

import { evaluate } from "@litmus/test";

const log = process.env.LITMUS_TEST_LOG;
const append = (s: string) => {
  if (log) appendFileSync(log, s + "\n");
};

const guardedEval = evaluate
  .extend<{ greeting: string }>(async (use) => {
    await use({ greeting: "hello" });
  })
  .guardrails({
    "transcript review": async (input) => {
      append(`grader-called:${input}`);
      return { pass: true, reason: "" };
    },
  });

guardedEval(
  "grader is invoked with the body's return value",
  async ({ greeting }) => greeting,
);

guardedEval(
  "a passing grader leaves the scenario passing",
  async ({ greeting }) => greeting,
);
