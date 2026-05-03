import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluate, synthesize } from "@litmus/test";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

const log = process.env.LITMUS_TEST_LOG;
const append = (s: string) => {
  if (log) appendFileSync(log, s + "\n");
};

const cachePath = join(
  tmpdir(),
  `synth-cached-${process.pid}-${Date.now()}.scenarios.json`,
);

const schema = z.object({ customerId: z.string(), amount: z.number() });
const seeds = [{ customerId: "c1", amount: 50 }];
const variants = 2;
const prompt = (): string => "produce variations";

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
          scenarios: [
            { customerId: "c2", amount: 75 },
            { customerId: "c3", amount: 125 },
          ],
        }),
      },
    ],
    finishReason: { unified: "stop", raw: undefined },
  }),
});

await synthesize({
  model,
  schema,
  seeds,
  variants,
  prompt,
  cache: cachePath,
  mode: "regenerate",
});

evaluate.scenarios({
  synthesize: { model, schema, seeds, variants, prompt, cache: cachePath },
  labelBy: (s) => `${s.customerId} for $${s.amount}`,
})("decline refunds", async (scenario) => {
  append(`iter:${scenario.customerId}`);
});
