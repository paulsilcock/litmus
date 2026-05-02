import { evaluate } from "@litmus/test";

let n = 0;
evaluate(
  "breaches pass rate",
  async () => {
    n++;
    if (n <= 3) throw new Error("fail");
  },
  { samples: 5, passRate: 0.8 },
);

evaluate(
  "exceeds timeout",
  async () => {
    await new Promise((r) => setTimeout(r, 500));
  },
  { timeout: 10 },
);

const refunds = [
  { customerId: "c1", amount: 50 },
  { customerId: "c2", amount: 120 },
];

evaluate.scenarios(refunds, {
  labelBy: (s) => `${s.customerId} for $${s.amount}`,
})("declines refund", async (scenario) => {
  if (scenario.customerId === "c2") throw new Error("over policy limit");
});
