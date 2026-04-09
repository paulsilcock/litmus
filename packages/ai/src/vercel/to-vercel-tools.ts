import type { ToolSelection } from "@litmus/core/ai";
import { tool, type Tool } from "ai";

/**
 * Converts a {@link ToolSelection} to a record of Vercel AI SDK
 * compatible tools, suitable for passing to `generateText` or
 * `streamText`.
 *
 * @example
 * ```typescript
 * import { toVercelTools } from "@litmus/ai/vercel";
 * import { generateText } from "ai";
 *
 * const tools = toVercelTools(systemTools.pick("getTransactions"));
 *
 * const { text } = await generateText({
 *   model: anthropic("claude-sonnet-4-5-20250929"),
 *   tools,
 *   prompt: "...",
 * });
 * ```
 */
export function toVercelTools(selection: ToolSelection): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  for (const [name, entry] of selection.entries()) {
    tools[name] = tool({
      description: entry.description,
      inputSchema: entry.schema,
      execute: async (input) => entry.handler.handle(input),
    });
  }
  return tools;
}
