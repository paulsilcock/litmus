import { evaluate } from "@litmus/test";

const customers = [{ name: "alice" }, { name: "bob" }];

const guardedEval = evaluate
  .extend<{ greeting: string }>(async (use) => {
    await use({ greeting: "hello" });
  })
  .guardrails({
    "policy check": async () => ({
      pass: false,
      reason: "violates content policy",
    }),
  });

guardedEval.scenarios(customers, { labelBy: (c) => c.name })(
  "guardrails grade every scenario's body and fail it on rejection",
  async (scenario, { greeting }) => `${greeting} ${scenario.name}`,
);
