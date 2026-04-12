import { generateText, type LanguageModel, Output, stepCountIs } from "ai";
import { z } from "zod";

interface UserSimulatorOptions {
  model: LanguageModel;
  persona: string;
  goal: string;
  maxTurns?: number;
  tools?: Record<string, any>;
}

type HandlerResult = string | { done: boolean; reason: string };

interface SimulationInput {
  opening?: string;
  handler: (message: string) => Promise<HandlerResult>;
}

interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

interface Conversation {
  turns: ConversationTurn[];
  outcome: "goal_met" | "max_turns" | "system_terminated";
}

const userResponseSchema = z.object({
  message: z.string(),
  done: z.boolean(),
});

function buildPrompt(
  persona: string,
  goal: string,
  turns: ConversationTurn[],
): string {
  const history = turns
    .map((t) => `${t.role === "user" ? "You" : "Assistant"}: ${t.content}`)
    .join("\n");

  return `You are simulating a user with the following persona: ${persona}

Your goal: ${goal}

Conversation so far:
${history || "(none yet)"}

Decide your next message and whether your goal has been met.`;
}

export class UserSimulator {
  readonly #model: LanguageModel;
  readonly #persona: string;
  readonly #goal: string;
  readonly #maxTurns: number;
  readonly #tools: Record<string, any> | undefined;

  constructor(options: UserSimulatorOptions) {
    this.#model = options.model;
    this.#persona = options.persona;
    this.#goal = options.goal;
    this.#maxTurns = options.maxTurns ?? 10;
    this.#tools = options.tools;
  }

  async simulate(input: SimulationInput): Promise<Conversation> {
    const turns: ConversationTurn[] = [];

    for (let i = 0; i < this.#maxTurns; i++) {
      let userMessage: string;
      let done: boolean;

      if (i === 0 && input.opening) {
        userMessage = input.opening;
        done = false;
      } else {
        const result = await generateText({
          model: this.#model,
          prompt: buildPrompt(this.#persona, this.#goal, turns),
          output: Output.object({ schema: userResponseSchema }),
          tools: this.#tools,
          stopWhen: this.#tools ? stepCountIs(this.#maxTurns) : undefined,
        });
        userMessage = result.output.message;
        done = result.output.done;
      }

      turns.push({ role: "user", content: userMessage });

      if (done) {
        return { turns, outcome: "goal_met" };
      }

      const assistantResponse = await input.handler(userMessage);
      if (typeof assistantResponse !== "string") {
        return { turns, outcome: "system_terminated" };
      }
      turns.push({ role: "assistant", content: assistantResponse });
    }

    return { turns, outcome: "max_turns" };
  }
}
