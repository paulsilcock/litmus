import { appendFileSync } from "node:fs";

import { evaluate } from "@litmus/test";

const log = process.env.LITMUS_TEST_LOG;
const append = (s: string) => {
  if (log) appendFileSync(log, s + "\n");
};

evaluate(
  "counts invocations",
  async () => {
    append("inv");
  },
  { samples: 3 },
);

let toleranceCounter = 0;
evaluate(
  "first two samples fail",
  async () => {
    toleranceCounter++;
    append(`tolerance-call:${toleranceCounter}`);
    if (toleranceCounter <= 2) throw new Error("fail");
  },
  { samples: 5, passRate: 0.6 },
);

let active = 0;
evaluate(
  "tracks parallelism",
  async () => {
    active++;
    append(`active:${active}`);
    await new Promise((r) => setTimeout(r, 2));
    active--;
  },
  { samples: 10, concurrent: true, concurrency: 3 },
);
