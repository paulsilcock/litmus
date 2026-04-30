import { appendFileSync } from "node:fs";

import { evaluate } from "@litmus/test";

const log = process.env.LITMUS_TEST_LOG;
const append = (s: string) => {
  if (log) appendFileSync(log, s + "\n");
};

// `evaluate.only` lives in its own fixture so the focus filtering
// doesn't suppress unrelated assertions in other fixture files.

evaluate("not focused", async () => {
  append("not-focused");
});

evaluate.only("focused", async () => {
  append("focused");
});
