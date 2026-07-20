import { expect, it } from "vite-plus/test";

import { totalTimeout } from "#litmus-test/evaluate/register.ts";

it("allocates at least one batch of run time when concurrency exceeds the sample count", () => {
  expect(totalTimeout(120_000, 3, true, Infinity)).toBe(130_000);
});
