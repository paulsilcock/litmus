import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";

export const utteranceSchema = z.object({
  message: z.string(),
  status: z.enum(["continue", "goal_met", "abandoned"] as const),
});

/** What the simulated user says next, and how the pursuit should proceed. */
export type Utterance = z.infer<typeof utteranceSchema>;

/**
 * A single message in a prompt. Deliberately the common denominator
 * across AI frameworks — role plus text — so the contract doesn't
 * inherit any one framework's richer message type.
 */
export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

/** A fully-resolved prompt: either flat text or role-tagged messages. */
export type Prompt = string | readonly Message[];

/**
 * Generates the simulated user's next utterance from a fully-resolved
 * prompt. The simulator is agnostic to the framework behind it — a
 * generator may wrap the Vercel AI SDK, another framework, or nothing
 * at all in tests.
 */
export type ResponseGenerator = (prompt: Prompt) => Promise<Utterance>;

/** Builds a `ResponseGenerator` backed by the Vercel AI SDK. */
export function fromVercel(opts: { model: LanguageModel }): ResponseGenerator {
  return async (prompt) => {
    if (typeof prompt !== "string") {
      throw new Error("message-array prompts are not supported");
    }

    const result = await generateText({
      model: opts.model,
      prompt,
      output: Output.object({ schema: utteranceSchema }),
    });

    return result.output;
  };
}
