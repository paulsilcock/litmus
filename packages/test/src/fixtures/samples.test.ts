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

// Every sample blocks on a shared latch until all of them have
// started. The latch can only be released — and so the "overlap" line
// can only be logged — if the runner started the samples concurrently.
// Under sequential execution the first sample would await the latch
// forever and the eval would time out. This makes the parallelism
// assertion deterministic: no sleeps, no timing races.
const CONCURRENT_SAMPLES = 3;
let started = 0;
let releaseAll: () => void = () => {};
const allStarted = new Promise<void>((resolve) => {
  releaseAll = resolve;
});
evaluate(
  "samples overlap",
  async () => {
    started++;
    if (started === CONCURRENT_SAMPLES) releaseAll();
    await allStarted;
    append("overlap");
  },
  { samples: CONCURRENT_SAMPLES, concurrent: true },
);
