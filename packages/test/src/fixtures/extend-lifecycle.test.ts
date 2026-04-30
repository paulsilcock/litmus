import { appendFileSync } from "node:fs";

import { evaluate } from "@litmus/test";

const log = process.env.LITMUS_TEST_LOG;
const append = (s: string) => {
  if (log) appendFileSync(log, s + "\n");
};

let setupCount = 0;
const withFreshId = evaluate.extend<{ id: number }>(async (use) => {
  setupCount++;
  await use({ id: setupCount });
});
withFreshId(
  "captures the injected id",
  async ({ id }) => {
    append(`id:${id}`);
  },
  { samples: 3 },
);

const withTeardown = evaluate.extend<{ id: number }>(async (use) => {
  append("setup");
  await use({ id: 1 });
  append("teardown");
});
withTeardown(
  "records each lifecycle phase",
  async () => {
    append("test");
  },
  { samples: 2 },
);
