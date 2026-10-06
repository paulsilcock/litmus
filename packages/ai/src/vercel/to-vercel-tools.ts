import { type Tool as SystemTool, ToolSelection } from "@litmus/core/ai";
import { tool, type Tool } from "ai";

/**
 * Converts system tools — a {@link ToolSelection} from
 * {@link Toolbox.pick}, or a plain record of tools — to Vercel AI SDK
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
export function toVercelTools(
  systemTools: ToolSelection | Record<string, SystemTool<any>>,
): Record<string, Tool> {
  const entries =
    systemTools instanceof ToolSelection
      ? systemTools.entries()
      : Object.entries(systemTools);

  const tools: Record<string, Tool> = {};
  for (const [name, entry] of entries) {
    tools[name] = tool({
      description: entry.description,
      inputSchema: entry.schema,
      execute: async (input) => entry.handler.handle(input),
    });
  }
  return tools;
}
