import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";

export interface SynthesizeOptions<T> {
  model: LanguageModel;
  schema: z.ZodType<T>;
  seeds: T[];
  variants: number;
  prompt: (seeds: T[], variants: number) => string;
}

/**
 * Fans out a small set of hand-written seeds into a larger set of
 * scenarios of the same shape, for use with `evaluate.scenarios()`.
 * The caller supplies the `prompt` builder, which receives the seeds
 * and the requested variant count and returns the prompt sent to the
 * model. Returns the seeds alongside the variants, so the result is
 * the full scenario set.
 *
 * @example
 * ```typescript
 * const scenarios = await synthesize({
 *   model: anthropic("claude-haiku-4-5-20251001"),
 *   schema: z.object({ message: z.string() }),
 *   seeds: [{ message: "I want a refund" }],
 *   variants: 20,
 *   prompt: (seeds, variants) =>
 *     `Vary the tone and urgency of these refund requests. Produce ${variants} new ones:\n${seeds.map((s) => s.message).join("\n")}`,
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
    prompt: opts.prompt(opts.seeds, opts.variants),
  });
  return [...opts.seeds, ...output.scenarios];
}
