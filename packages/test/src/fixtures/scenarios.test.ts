import { appendFileSync } from "node:fs";

import { evaluate } from "@litmus/test";

const log = process.env.LITMUS_TEST_LOG;
const append = (s: string) => {
  if (log) appendFileSync(log, s + "\n");
};

const users = [{ name: "alice" }, { name: "bob" }];
evaluate.scenarios(users)("agent handles user", async (scenario) => {
  append(`iter:${scenario.name}`);
});

const refunds = [
  { customerId: "c1", amount: 50 },
  { customerId: "c2", amount: 120 },
];
evaluate.scenarios(refunds, {
  labelBy: (s) => `${s.customerId} for $${s.amount}`,
})("declines refund", async (scenario) => {
  if (scenario.customerId === "c2") throw new Error("over policy limit");
});
