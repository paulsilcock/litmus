import { appendFileSync } from "node:fs";
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
  `synth-extended-fixture-${process.pid}-${Date.now()}.scenarios.json`,
);

const model = new MockLanguageModelV3({
  doGenerate: async () => ({
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 5, text: 5, reasoning: 0 },
    },
    warnings: [],
    content: [
      {
        type: "text",
        text: JSON.stringify({
          scenarios: [{ name: "alice" }, { name: "bob" }],
        }),
      },
    ],
    finishReason: { unified: "stop", raw: undefined },
  }),
});

const guarded = evaluate
  .extend<{ dsl: string }>(async (use) => {
    await use({ dsl: "ready" });
  })
  .withPolicies({
    "no empty": async (input) => {
      append(`grader:${input}`);
      return { pass: input.length > 0, reason: "empty input" };
    },
  });

guarded.scenarios({
  synthesize: {
    model,
    schema: z.object({ name: z.string() }),
    seeds: [{ name: "seed" }],
    variants: 2,
    prompt: () => "produce variations",
    cache: cachePath,
    mode: "regenerate",
  },
})(
  "extended eval handles synthesised scenario",
  async (scenario, { dsl, policies }) => {
    append(`iter:${scenario.name}:${dsl}`);
    await policies(scenario.name);
  },
);
