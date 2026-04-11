import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";

interface UserSimulatorOptions {
  model: LanguageModel;
  persona: string;
  goal: string;
  maxTurns?: number;
}

interface SimulationInput {
  handler: (message: string) => Promise<string>;
}

interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

interface Conversation {
  turns: ConversationTurn[];
  outcome: "goal_met" | "max_turns";
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

  constructor(options: UserSimulatorOptions) {
    this.#model = options.model;
    this.#persona = options.persona;
    this.#goal = options.goal;
    this.#maxTurns = options.maxTurns ?? 10;
  }

  async simulate(input: SimulationInput): Promise<Conversation> {
    const turns: ConversationTurn[] = [];

    for (let i = 0; i < this.#maxTurns; i++) {
      const result = await generateText({
        model: this.#model,
        prompt: buildPrompt(this.#persona, this.#goal, turns),
        output: Output.object({ schema: userResponseSchema }),
      });

      const userResponse = result.output;
      turns.push({ role: "user", content: userResponse.message });

      if (userResponse.done) {
        return { turns, outcome: "goal_met" };
      }

      const assistantResponse = await input.handler(userResponse.message);
      turns.push({ role: "assistant", content: assistantResponse });
    }

    return { turns, outcome: "max_turns" };
  }
}
