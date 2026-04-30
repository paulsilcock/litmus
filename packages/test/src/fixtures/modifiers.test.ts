import { appendFileSync } from "node:fs";

import { evaluate } from "@litmus/test";

const log = process.env.LITMUS_TEST_LOG;
const append = (s: string) => {
  if (log) appendFileSync(log, s + "\n");
};

evaluate.skip("skip-direct", async () => {
  append("skip-direct");
});

evaluate.skipIf(true)("skipif-true", async () => {
  append("skipif-true");
});

evaluate.skipIf(false)("skipif-false", async () => {
  append("skipif-false");
});

evaluate.runIf(true)("runif-true", async () => {
  append("runif-true");
});

evaluate.runIf(false)("runif-false", async () => {
  append("runif-false");
});
