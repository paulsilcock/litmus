import { appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluate } from "@litmus/test";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

const log = process.env.LITMUS_TEST_LOG;
const append = (s: string) => {
  if (log) appendFileSync(log, s + "\n");
};

const cachePath = join(
  tmpdir(),
  `synth-stale-${process.pid}-${Date.now()}.scenarios.json`,
);

writeFileSync(
  cachePath,
  JSON.stringify({
    hash: "this-hash-will-never-match",
    scenarios: [{ name: "stale-content" }],
  }),
);

const model = new MockLanguageModelV3({
  doGenerate: async () => {
    throw new Error("model should not be called in strict mode");
  },
});

evaluate.scenarios({
  synthesize: {
    model,
    schema: z.object({ name: z.string() }),
    seeds: [{ name: "seed" }],
    variants: 1,
    prompt: () => "produce variations",
    cache: cachePath,
  },
})("stale eval", async (scenario) => {
  append(`should-not-run:${scenario.name}`);
});
