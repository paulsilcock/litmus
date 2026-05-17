import { appendFileSync } from "node:fs";

import { evaluate } from "@litmus/test";

const log = process.env.LITMUS_TEST_LOG;
const append = (s: string) => {
  if (log) appendFileSync(log, s + "\n");
};

// Single-form invocation: a passing grader records every input it receives,
// so the parent suite can verify both that the grader ran and what it saw.
const invocationEval = evaluate
  .extend<{ greeting: string }>(async (use) => {
    await use({ greeting: "hello" });
  })
  .guardrails({
    "input recorder": async (input) => {
      append(`single:${input}`);
      return { pass: true, reason: "" };
    },
  });

invocationEval(
  "passing grader records each input it receives",
  async ({ greeting }) => greeting,
);

// No guardrails registered: the eval should run cleanly with an
// unconstrained body return type.
const unguardedEval = evaluate
  .extend<{ x: number }>(async (use) => {
    await use({ x: 1 });
  })
  .guardrails({});

unguardedEval("eval registered with .guardrails({})", async ({ x }) => {
  void x;
});

// Scenarios form: same recording grader, but exercised across multiple
// scenarios and samples to verify per-run invocation.
const customers = [{ name: "alice" }, { name: "bob" }];

const scenariosEval = evaluate
  .extend<{ greeting: string }>(async (use) => {
    await use({ greeting: "hello" });
  })
  .guardrails({
    "input recorder": async (input) => {
      append(`scenario:${input}`);
      return { pass: true, reason: "" };
    },
  });

scenariosEval.scenarios(customers, { labelBy: (c) => c.name, samples: 2 })(
  "passing grader records input for each (scenario, sample)",
  async (scenario, { greeting }) => `${greeting} ${scenario.name}`,
);
