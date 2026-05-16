import { evaluate } from "@litmus/test";

const customers = [{ name: "alice" }, { name: "bob" }];

const e = evaluate
  .extend<{ greeting: string }>(async (use) => {
    await use({ greeting: "hello" });
  })
  .guardrails({
    "policy check": async () => ({
      pass: false,
      reason: "violates content policy",
    }),
  });

e.scenarios(customers, { labelBy: (c) => c.name })(
  "agent greets each customer",
  async (scenario, { greeting }) => `${greeting} ${scenario.name}`,
);
