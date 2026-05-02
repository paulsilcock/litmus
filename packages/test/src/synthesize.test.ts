import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { synthesize } from "#litmus-test/synthesize.ts";

const mockUsage = {
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  },
  warnings: [],
};

describe("synthesize", () => {
  it("fans out seeds into more of the same shape", async () => {
    const schema = z.object({ message: z.string() });
    const seeds = [
      { message: "I want a refund" },
      { message: "My order never arrived" },
      { message: "I was charged twice" },
    ];
    const variants = 5;

    const generated = Array.from({ length: variants }, (_, i) => ({
      message: `synthesised ${i + 1}`,
    }));

    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockUsage,
        content: [
          { type: "text", text: JSON.stringify({ scenarios: generated }) },
        ],
        finishReason: { unified: "stop", raw: undefined },
      }),
    });

    const scenarios = await synthesize({ model, schema, seeds, variants });

    expect(scenarios).toHaveLength(seeds.length + variants);
    for (const scenario of scenarios) {
      expect(() => schema.parse(scenario)).not.toThrow();
    }
  });
});
