import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";

/**
 * A function that judges whether some input meets a quality bar,
 * returning a structured result. Graders exist purely for testing
 * and evaluation — they are not part of production code.
 *
 * Typically backed by an LLM (LLM-as-judge) to evaluate subjective
 * properties that conventional assertions can't express, e.g.
 * "does this reasoning account for all required skills?". For that
 * common case, prefer `llmJudge` — it wraps the AI SDK call and
 * enforces the `{ pass, reason }` output contract. Write a raw
 * `Grader` directly when you need something `llmJudge` cannot express.
 */
export type Grader<TInput> = (input: TInput) => Promise<{
  pass: boolean;
  reason: string;
}>;

/**
 * Configuration for `llmJudge`. Either supply a `rubric` (and the
 * helper builds a default prompt) or a `prompt` builder (full control).
 * The two modes are mutually exclusive — the type system enforces it.
 */
export type LlmJudgeConfig<TInput> =
  | { model: LanguageModel; rubric: string }
  | { model: LanguageModel; prompt: (input: TInput) => string };

const VerdictSchema = z.object({
  pass: z.boolean(),
  reason: z.string(),
});

/**
 * Build an LLM-as-judge `Grader`. Enforces the `{ pass, reason }`
 * output contract via structured decoding, so the result slots into
 * `trial()` without further wiring.
 *
 * Two modes:
 * - **Rubric** (simple): `{ model, rubric }`. The helper builds a
 *   default prompt that frames the rubric and renders the input
 *   (strings as-is, other values via `JSON.stringify`).
 * - **Prompt** (full control): `{ model, prompt: (input) => string }`.
 *   You own the prompt; the helper still enforces the output schema.
 *
 * @example
 * ```typescript
 * const grader = llmJudge<Conversation>({
 *   model: anthropic("claude-haiku-4-5-20251001"),
 *   rubric: "Assistant acknowledges the concern before proposing a solution.",
 * });
 * ```
 */
export function llmJudge<TInput>(
  config: LlmJudgeConfig<TInput>,
): Grader<TInput> {
  return async (input) => {
    const prompt =
      "prompt" in config
        ? config.prompt(input)
        : defaultPrompt(config.rubric, input);

    const { output } = await generateText({
      model: config.model,
      output: Output.object({ schema: VerdictSchema }),
      prompt,
    });
    return output;
  };
}

function defaultPrompt(rubric: string, input: unknown): string {
  const rendered =
    typeof input === "string" ? input : JSON.stringify(input, null, 2);
  return `Judge the following against the rubric. Respond with { pass: boolean, reason: string }.

Rubric:
${rubric}

Input:
${rendered}`;
}
