import { appendFileSync } from "node:fs";

import { evaluate } from "@litmus/test";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

const log = process.env.LITMUS_TEST_LOG;
const append = (s: string) => {
  if (log) appendFileSync(log, s + "\n");
};

function makeModel(payload: { name: string }[]) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 5, text: 5, reasoning: 0 },
      },
      warnings: [],
      content: [{ type: "text", text: JSON.stringify({ scenarios: payload }) }],
      finishReason: { unified: "stop", raw: undefined },
    }),
  });
}

await evaluate.scenarios({
  generate: {
    model: makeModel([{ name: "alpha" }]),
    schema: z.object({ name: z.string() }),
    seeds: [{ name: "first-seed" }],
    variants: 1,
    prompt: () => "first prompt",
    mode: "regenerate",
  },
})("first eval", async (scenario) => {
  append(`first:${scenario.name}`);
});

await evaluate.scenarios({
  generate: {
    model: makeModel([{ name: "beta" }]),
    schema: z.object({ name: z.string() }),
    seeds: [{ name: "second-seed" }],
    variants: 1,
    prompt: () => "second prompt",
    mode: "regenerate",
  },
})("second eval", async (scenario) => {
  append(`second:${scenario.name}`);
});
