/**
 * A function that judges whether some input meets a quality bar,
 * returning a structured result. Graders exist purely for testing
 * and evaluation — they are not part of production code.
 *
 * Typically backed by an LLM (LLM-as-judge) to evaluate subjective
 * properties that conventional assertions can't express, e.g.
 * "does this reasoning account for all required skills?"
 *
 * @example
 * ```typescript
 * import type { Grader } from "@litmus/test";
 * import { generateText, Output } from "ai";
 * import { z } from "zod";
 *
 * interface SkillsCheck {
 *   reasoning: string;
 *   requiredSkills: string[];
 * }
 *
 * export const gradeSkillsCovered: Grader<SkillsCheck> = async (input) => {
 *   const { output } = await generateText({
 *     model: anthropic("claude-haiku-4-5-20251001"),
 *     output: Output.object({
 *       schema: z.object({ pass: z.boolean(), reason: z.string() }),
 *     }),
 *     prompt: `Verify the reasoning addresses every required skill...`,
 *   });
 *   return output;
 * };
 * ```
 */
export type Grader<TInput> = (input: TInput) => Promise<{
  pass: boolean;
  reason: string;
}>;
