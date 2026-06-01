import { appendFileSync } from "node:fs";

import { evaluate } from "@litmus/test";

const log = process.env.LITMUS_TEST_LOG;
const append = (s: string) => {
  if (log) appendFileSync(log, s + "\n");
};

evaluate.samples(3)("chain-samples runs n times", async () => {
  append("chain-sample");
});

let passRateCounter = 0;
evaluate.samples(5).passRate(0.6)(
  "chain-passrate tolerates threshold failures",
  async () => {
    passRateCounter++;
    append(`chain-passrate-call:${passRateCounter}`);
    if (passRateCounter <= 2) throw new Error("fail");
  },
);

evaluate.timeout(50)(
  "chain-timeout fails a body that exceeds the limit",
  async () => {
    await new Promise((r) => setTimeout(r, 300));
  },
);

let precedenceCounter = 0;
evaluate.samples(5)(
  "chain-precedence overrides the opts bag",
  async () => {
    precedenceCounter++;
    append(`chain-precedence:${precedenceCounter}`);
  },
  { samples: 1 },
);

// Same deterministic-overlap latch as samples.test.ts: every sample
// blocks until all have started, which is only possible if .concurrent
// ran them in parallel. Sample count stays at or below the default
// concurrency so all samples can start and release the latch together.
const CONCURRENT_SAMPLES = 3;
let started = 0;
let releaseAll: () => void = () => {};
const allStarted = new Promise<void>((resolve) => {
  releaseAll = resolve;
});
evaluate
  .samples(CONCURRENT_SAMPLES)
  .concurrent("chain-concurrent runs samples in parallel", async () => {
    started++;
    if (started === CONCURRENT_SAMPLES) releaseAll();
    await allStarted;
    append("chain-overlap");
  });

const users = [{ name: "alice" }, { name: "bob" }];

evaluate.samples(2).scenarios(users)(
  "chain-scenarios runs n samples each",
  async (scenario) => {
    append(`chain-scenario:${scenario.name}`);
  },
);

evaluate.samples(3).skip("chain-skip does not run body", async () => {
  append("chain-skip-ran");
});

evaluate.samples(3).skipIf(false)("chain-skipif-false runs", async () => {
  append("chain-skipif-false");
});
