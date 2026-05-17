import { appendFileSync } from "node:fs";

import { evaluate } from "@litmus/test";

const log = process.env.LITMUS_TEST_LOG;
const append = (s: string) => {
  if (log) appendFileSync(log, s + "\n");
};

const customers = [{ name: "alice" }, { name: "bob" }];

const guardedEval = evaluate
  .extend<{ greeting: string }>(async (use) => {
    await use({ greeting: "hello" });
  })
  .guardrails({
    "policy check": async (input) => {
      append(`graded:${input}`);
      return { pass: false, reason: "violates content policy" };
    },
  });

guardedEval.scenarios(customers, { labelBy: (c) => c.name, samples: 2 })(
  "guardrails grade every scenario's body and fail it on rejection",
  async (scenario, { greeting }) => `${greeting} ${scenario.name}`,
);
