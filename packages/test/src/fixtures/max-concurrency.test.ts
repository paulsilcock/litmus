import { evaluate } from "@litmus/test";

// Three samples must all start simultaneously for the latch to release.
// With pool=2 (from vite.config.max-concurrency.ts) the third sample can
// never start while the first two are blocked, so the latch never fires
// and both blocked samples time out. The eval fails.
// With the old hardcoded pool=5 all three would start, the latch would
// release, and the eval would pass — so this test is only green when the
// runner actually reads maxConcurrency from the vitest worker config.
const CONCURRENT_SAMPLES = 3;
let started = 0;
let releaseAll: () => void = () => {};
const allStarted = new Promise<void>((resolve) => {
  releaseAll = resolve;
});

evaluate(
  "pool-constrained deadlock",
  async () => {
    started++;
    if (started === CONCURRENT_SAMPLES) releaseAll();
    await allStarted;
  },
  { samples: CONCURRENT_SAMPLES, concurrent: true, timeout: 300 },
);
