import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

import { generateText, type LanguageModel, Output } from "ai";
import { expect } from "vite-plus/test";
import { z } from "zod";

export interface SynthesizeOptions<T> {
  model: LanguageModel;
  schema: z.ZodType<T>;
  seeds: T[];
  variants: number;
  prompt: (seeds: T[], variants: number) => string;
  cache?: string;
  mode?: "strict" | "regenerate";
  name?: string;
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

export function resolveMode(
  explicit: "strict" | "regenerate" | undefined,
): "strict" | "regenerate" {
  if (explicit) return explicit;
  if (process.env.LITMUS_SYNTH_MODE === "regenerate") return "regenerate";
  return "strict";
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SLUG_MAX_LENGTH = 40;

function truncateSlug(slug: string): string {
  if (slug.length <= SLUG_MAX_LENGTH) return slug;
  const hash = createHash("sha256").update(slug).digest("hex").slice(0, 8);
  const truncated = slug.slice(0, SLUG_MAX_LENGTH).replace(/-+$/, "");
  return `${truncated}-${hash}`;
}

function autoDeriveCachePath(name: string | undefined): string | undefined {
  const testPath = expect.getState().testPath;
  if (!testPath) return undefined;
  const stem = testPath.replace(/\.test\.[jt]sx?$/, "");
  const suffix = name
    ? `.${truncateSlug(slugify(name))}.scenarios.json`
    : ".scenarios.json";
  return `${stem}${suffix}`;
}

function computeHash<T>(opts: SynthesizeOptions<T>): string {
  const promptString = opts.prompt(opts.seeds, opts.variants);
  const modelId =
    typeof opts.model === "string" ? opts.model : opts.model.modelId;
  return hashInputs({
    modelId,
    seeds: opts.seeds,
    variants: opts.variants,
    prompt: promptString,
  });
}

function resolveCachePath<T>(opts: SynthesizeOptions<T>): string | undefined {
  return opts.cache ?? autoDeriveCachePath(opts.name);
}

function validateAndExtract<T>(
  content: string,
  expectedHash: string,
  cachePath: string,
): T[] {
  const parsed: CacheFile<T> = JSON.parse(content);
  if (parsed.hash !== expectedHash) {
    throw new Error(
      `Scenario cache at ${cachePath} is stale — inputs have changed ` +
        `since it was generated. ${regenInstruction(cachePath)}`,
    );
  }
  return parsed.scenarios;
}

/**
 * Synchronously load cached scenarios for the given options. Throws a
 * helpful error if the cache file is missing or its hash doesn't match
 * the inputs. Used by the registration phase of `evaluate.scenarios`
 * to surface stale-cache failures with full label quality on success.
 */
export function readCachedScenariosSync<T>(opts: SynthesizeOptions<T>): T[] {
  const cachePath = resolveCachePath(opts);
  if (!cachePath) {
    throw new Error(
      "Cache path required: pass `cache` explicitly or run inside a test file " +
        "so the path can be auto-derived.",
    );
  }
  let content: string;
  try {
    content = readFileSync(cachePath, "utf-8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new Error(
        `Scenario cache not found at ${cachePath}. ${regenInstruction(cachePath)}`,
      );
    }
    throw err;
  }
  return validateAndExtract<T>(content, computeHash(opts), cachePath);
}

/**
 * Fans out a small set of hand-written seeds into a larger set of
 * scenarios of the same shape, typically used to feed
 * `evaluate.scenarios()`. The caller supplies the `prompt` builder,
 * which receives the seeds and requested variant count and returns
 * the prompt sent to the model. Returns the seeds alongside the
 * variants — the full scenario set.
 *
 * ## Cache
 *
 * Scenarios are persisted to a JSON file keyed by a hash of the
 * inputs (model id, seeds, variant count, and prompt string). Any
 * change to those inputs invalidates the cache.
 *
 * Two ways to specify the path:
 * - `cache: "./fixtures/refund.scenarios.json"` — explicit path.
 *   Required when running outside a test (e.g. from a script).
 *   Takes precedence; `name` is ignored when `cache` is supplied.
 * - Inside a test file, omit `cache` and the path is auto-derived
 *   from `expect.getState().testPath` as
 *   `<test-stem>[.<name-slug>].scenarios.json`. The optional `name`
 *   adds a slug, only needed to disambiguate when multiple
 *   `synthesize` calls share the same test file.
 *
 * ## Mode
 *
 * - `"strict"` (default) reads the cache and rejects with regen
 *   instructions if it's missing or stale. **Never calls the model.**
 * - `"regenerate"` ignores the cache and overwrites it. Calls the
 *   model.
 *
 * Mode resolves from the `mode` option, then the `LITMUS_SYNTH_MODE`
 * env var, then defaults to `"strict"`. Generation is opt-in: a bare
 * `vp test` never spends tokens.
 *
 * ## Workflow
 *
 * Iterate at small variant counts (`variants: 3`) until the prompt
 * produces good output, then bump to a larger set (`variants: 30`)
 * for production coverage. Every change to inputs triggers a regen
 * automatically — set `LITMUS_SYNTH_MODE=regenerate` for the run.
 *
 * For test integration, prefer `evaluate.scenarios({ synthesize })`
 * over awaiting `synthesize` at the top level — it sync-registers,
 * forwards the eval name as the cache slug, and surfaces stale-cache
 * failures as a single failed test.
 *
 * @example Standalone (script):
 * ```typescript
 * await synthesize({
 *   model: anthropic("claude-haiku-4-5-20251001"),
 *   schema: z.object({ message: z.string() }),
 *   seeds: [{ message: "I want a refund" }],
 *   variants: 20,
 *   prompt: (seeds, n) =>
 *     `Vary tone and urgency. Produce ${n} new examples:\n${seeds.map((s) => s.message).join("\n")}`,
 *   cache: "./fixtures/refund.scenarios.json",
 *   mode: "regenerate",
 * });
 * ```
 *
 * @example Integrated form (test file):
 * ```typescript
 * evaluate.scenarios({
 *   synthesize: { model, schema, seeds, variants: 20, prompt },
 *   labelBy: (s) => s.message,
 * })("handles refund requests", async (scenario) => {
 *   const response = await refundAgent.handle(scenario);
 *   expect(response.outcome).toBe("refund_issued");
 * });
 * ```
 */
export async function synthesize<T>(opts: SynthesizeOptions<T>): Promise<T[]> {
  if (resolveMode(opts.mode) === "strict") {
    return readCachedScenariosSync<T>(opts);
  }

  const responseSchema = z.object({ scenarios: z.array(opts.schema) });
  const { output } = await generateText({
    model: opts.model,
    output: Output.object({ schema: responseSchema }),
    prompt: opts.prompt(opts.seeds, opts.variants),
  });
  const scenarios = [...opts.seeds, ...output.scenarios];

  const cachePath = resolveCachePath(opts);
  if (cachePath) {
    const file: CacheFile<T> = { hash: computeHash(opts), scenarios };
    await writeFile(cachePath, JSON.stringify(file, null, 2));
  }

  return scenarios;
}
