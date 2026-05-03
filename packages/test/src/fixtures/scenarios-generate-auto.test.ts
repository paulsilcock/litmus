import { appendFileSync } from "node:fs";

import { evaluate } from "@litmus/test";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

const log = process.env.LITMUS_TEST_LOG;
const append = (s: string) => {
  if (log) appendFileSync(log, s + "\n");
};

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
        text: JSON.stringify({ scenarios: [{ name: "auto" }] }),
      },
    ],
    finishReason: { unified: "stop", raw: undefined },
  }),
});

await evaluate.scenarios({
  generate: {
    model,
    schema: z.object({ name: z.string() }),
    seeds: [{ name: "seed" }],
    variants: 1,
    prompt: () => "produce variations",
    mode: "regenerate",
  },
})("auto-cache eval", async (scenario) => {
  append(`iter:${scenario.name}`);
});
