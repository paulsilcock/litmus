import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";

export interface SynthesizeOptions<T> {
  model: LanguageModel;
  schema: z.ZodType<T>;
  seeds: T[];
  variants: number;
}

/**
 * Fans out a small set of hand-written seeds into a larger set of
 * scenarios of the same shape, for use with `evaluate.scenarios()`.
 * Asks the model to invent variations on the seeds; returns the seeds
 * alongside the variants so the result is the full scenario set.
 *
 * @example
 * ```typescript
 * const scenarios = await synthesize({
 *   model: anthropic("claude-haiku-4-5-20251001"),
 *   schema: z.object({ message: z.string() }),
 *   seeds: [{ message: "I want a refund" }],
 *   variants: 20,
 * });
 *
 * evaluate.scenarios(scenarios)("handles $message", async (s) => { ... });
 * ```
 */
export async function synthesize<T>(opts: SynthesizeOptions<T>): Promise<T[]> {
  const responseSchema = z.object({ scenarios: z.array(opts.schema) });
  const { output } = await generateText({
    model: opts.model,
    output: Output.object({ schema: responseSchema }),
    prompt: `Produce ${opts.variants} new scenarios that vary the wording, context, and details of these seeds while preserving their shape and intent:

${opts.seeds.map((s) => JSON.stringify(s)).join("\n")}`,
  });
  return [...opts.seeds, ...output.scenarios];
}
