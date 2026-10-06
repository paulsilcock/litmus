import type { GenerationFunction, Message } from "@litmus/core/ai";
import {
  generateText,
  type LanguageModel,
  type ModelMessage,
  Output,
  stepCountIs,
} from "ai";
import type { ZodType } from "zod";

import { toVercelTools } from "#litmus-ai/vercel/to-vercel-tools.ts";

/**
 * Builds a {@link GenerationFunction} backed by the Vercel AI SDK.
 * Output is constrained to the given schema; tools handed to the
 * returned function are offered to the model on that call.
 *
 * @example
 * ```typescript
 * import { vercelGenerator } from "@litmus/ai/vercel";
 *
 * const generate = vercelGenerator({
 *   model: anthropic("claude-sonnet-4-5-20250929"),
 *   schema: z.object({ intent: z.enum(["refund", "complaint"]) }),
 * });
 *
 * const { intent } = await generate("Classify: 'my book arrived damaged'");
 * ```
 */
export function vercelGenerator<TOutput>(opts: {
  model: LanguageModel;
  schema: ZodType<TOutput>;
  /**
   * Cap on the number of generation steps (tool calls + reasoning) per
   * invocation. Bounds what would otherwise be an unbounded
   * tool-calling loop. Defaults to 5.
   */
  maxSteps?: number;
}): GenerationFunction<TOutput> {
  return async (prompt, tools) => {
    const result = await generateText({
      model: opts.model,
      ...(typeof prompt === "string"
        ? { prompt }
        : { messages: toModelMessages(prompt) }),
      output: Output.object({ schema: opts.schema }),
      tools: tools ? toVercelTools(tools) : undefined,
      stopWhen: tools ? stepCountIs(opts.maxSteps ?? 5) : undefined,
    });

    return result.output;
  };
}

function toModelMessages(messages: readonly Message[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    // The arms are identical, but ModelMessage is a discriminated union —
    // `{ role: message.role, ... }` doesn't distribute without narrowing.
    switch (message.role) {
      case "system":
        return { role: "system", content: message.content };
      case "user":
        return { role: "user", content: message.content };
      case "assistant":
        return { role: "assistant", content: message.content };
    }
  });
}
