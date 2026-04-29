import { evaluate } from "@litmus/test";

let n = 0;
evaluate({ samples: 5, passRate: 0.8 }).each("breaches pass rate", async () => {
  n++;
  if (n <= 3) throw new Error("fail");
});

evaluate({ samples: 1 }).each(
  "exceeds timeout",
  async () => {
    await new Promise((r) => setTimeout(r, 500));
  },
  { timeout: 10 },
);
