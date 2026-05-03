import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";

export interface SynthesizeOptions<T> {
  model: LanguageModel;
  schema: z.ZodType<T>;
  seeds: T[];
  variants: number;
  prompt: (seeds: T[], variants: number) => string;
  cache?: string;
  mode?: "strict" | "regenerate";
}

interface CacheFile<T> {
  hash: string;
  scenarios: T[];
}

function hashInputs(inputs: {
  modelId: string;
  seeds: unknown;
  variants: number;
  prompt: string;
}): string {
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
}

function regenInstruction(path: string): string {
  return `Re-run with LITMUS_SYNTH_MODE=regenerate, then commit ${path}.`;
}

function resolveMode(
  explicit: "strict" | "regenerate" | undefined,
): "strict" | "regenerate" {
  if (explicit) return explicit;
  if (process.env.LITMUS_SYNTH_MODE === "regenerate") return "regenerate";
  return "strict";
}

async function readCache(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new Error(
        `Scenario cache not found at ${path}. ${regenInstruction(path)}`,
      );
    }
    throw err;
  }
}

/**
 * Fans out a small set of hand-written seeds into a larger set of
 * scenarios of the same shape, for use with `evaluate.scenarios()`.
 * The caller supplies the `prompt` builder, which receives the seeds
 * and the requested variant count and returns the prompt sent to the
 * model. Returns the seeds alongside the variants, so the result is
 * the full scenario set.
 *
 * When `cache` is supplied, the result is persisted to that path and
 * reused on subsequent runs. The cache is keyed by a hash of the
 * inputs (model id, seeds, variant count, and prompt string), so any
 * change invalidates it. `mode` controls cache behaviour:
 * `"strict"` (default) reads from the cache and rejects with regen
 * instructions if it's missing or stale; `"regenerate"` ignores the
 * cache and overwrites it.
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
 *   cache: "./fixtures/refund.scenarios.json",
 * });
 *
 * evaluate.scenarios(scenarios)("handles $message", async (s) => { ... });
 * ```
 */
export async function synthesize<T>(opts: SynthesizeOptions<T>): Promise<T[]> {
  const mode = resolveMode(opts.mode);
  const promptString = opts.prompt(opts.seeds, opts.variants);
  const modelId =
    typeof opts.model === "string" ? opts.model : opts.model.modelId;
  const hash = hashInputs({
    modelId,
    seeds: opts.seeds,
    variants: opts.variants,
    prompt: promptString,
  });

  if (opts.cache && mode === "strict") {
    const content = await readCache(opts.cache);
    const parsed: CacheFile<T> = JSON.parse(content);
    if (parsed.hash !== hash) {
      throw new Error(
        `Scenario cache at ${opts.cache} is stale — inputs have changed ` +
          `since it was generated. ${regenInstruction(opts.cache)}`,
      );
    }
    return parsed.scenarios;
  }

  const responseSchema = z.object({ scenarios: z.array(opts.schema) });
  const { output } = await generateText({
    model: opts.model,
    output: Output.object({ schema: responseSchema }),
    prompt: promptString,
  });
  const scenarios = [...opts.seeds, ...output.scenarios];

  if (opts.cache) {
    const file: CacheFile<T> = { hash, scenarios };
    await writeFile(opts.cache, JSON.stringify(file, null, 2));
  }

  return scenarios;
}
