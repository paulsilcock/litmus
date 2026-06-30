import {
  generateText,
  type LanguageModel,
  Output,
  stepCountIs,
  tool,
} from "ai";
import { z } from "zod";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

interface Ability<TSchema extends z.ZodType = z.ZodType> {
  reason: string;
  how: TSchema;
  use: (input: z.infer<TSchema>) => Promise<unknown>;
}

type BaseOptions = {
  model: LanguageModel;
  abilities?: Record<string, Ability>;
  /**
   * Cap on the number of steps (ability calls + reasoning) the
   * simulator's model is allowed to take inside a single conversational
   * turn before being forced to produce an utterance. Prevents the
   * model from looping on ability calls indefinitely. Defaults to 5.
   */
  maxStepsPerTurn?: number;
} & (
  | { persona: string }
  | { prompt: (turns: readonly Turn[], goal: string) => string }
);

export type TextOptions = BaseOptions & {
  send: (message: string) => Promise<void>;
  receive: () => Promise<string>;
};

type PursuitOutcome = "goal_met" | "abandoned" | "max_turns";

export interface PursuitResult {
  met: boolean;
  reason: PursuitOutcome;
}

function pursuitOutcome(reason: PursuitOutcome): PursuitResult {
  return { met: reason === "goal_met", reason };
}

const userResponseSchema = z.object({
  message: z.string(),
  status: z.enum(["continue", "goal_met", "abandoned"] as const),
});

function defaultPrompt(
  persona: string,
  goal: string,
  turns: readonly Turn[],
): string {
  const history = turns
    .map((t) => `${t.role === "user" ? "You" : "Assistant"}: ${t.content}`)
    .join("\n");

  return `You are simulating a user with the following persona: ${persona}

Your goal: ${goal}

Conversation so far:
${history || "(none yet)"}

Decide your next message and set status to:
- "goal_met" if your goal has been achieved
- "abandoned" if you judge the goal is unreachable (e.g. the system keeps refusing or is unable to help)
- "continue" to keep the conversation going`;
}

export abstract class UserSimulator {
  readonly #model: LanguageModel;
  readonly #turns: Turn[] = [];
  readonly #abilities?: Record<string, Ability>;
  readonly #maxStepsPerTurn: number;
  readonly #buildPrompt: (turns: readonly Turn[], goal: string) => string;

  constructor(options: BaseOptions) {
    this.#model = options.model;
    this.#abilities = options.abilities;
    this.#maxStepsPerTurn = options.maxStepsPerTurn ?? 5;
    this.#buildPrompt =
      "prompt" in options
        ? options.prompt
        : (turns, goal) => defaultPrompt(options.persona, goal, turns);
  }

  protected abstract sendMessage(message: string): Promise<void>;
  protected abstract receiveMessage(): Promise<string>;

  protected recordTurn(turn: Turn): void {
    this.#turns.push(turn);
  }

  async transcript(): Promise<readonly Turn[]> {
    return [...this.#turns];
  }

  async pursueGoal(
    goal: string,
    opts: { maxTurns?: number } = {},
  ): Promise<PursuitResult> {
    const maxTurns = opts.maxTurns ?? 10;
    const tools = this.#abilities
      ? Object.fromEntries(
          Object.entries(this.#abilities).map(([name, ability]) => [
            name,
            tool({
              description: ability.reason,
              inputSchema: ability.how,
              execute: ability.use,
            }),
          ]),
        )
      : undefined;

    for (let i = 0; i < maxTurns; i++) {
      const promptText = this.#buildPrompt(this.#turns, goal);
      const result = await generateText({
        model: this.#model,
        prompt: promptText,
        output: Output.object({ schema: userResponseSchema }),
        tools,
        stopWhen: tools ? stepCountIs(this.#maxStepsPerTurn) : undefined,
      });

      let output: z.infer<typeof userResponseSchema>;
      try {
        output = result.output;
      } catch {
        output = {
          message: "(Took too many actions without speaking; continuing.)",
          status: "continue",
        };
      }

      await this.sendMessage(output.message);
      this.recordTurn({ role: "user", content: output.message });

      if (output.status !== "continue") {
        return pursuitOutcome(output.status);
      }

      const reply = await this.receiveMessage();
      this.recordTurn({ role: "assistant", content: reply });
    }

    return pursuitOutcome("max_turns");
  }

  static text(options: TextOptions): TextSimulator {
    return new TextSimulator(options);
  }
}

export class TextSimulator extends UserSimulator {
  readonly #send: (message: string) => Promise<void>;
  readonly #receive: () => Promise<string>;

  constructor(options: TextOptions) {
    super(options);
    this.#send = options.send;
    this.#receive = options.receive;
  }

  protected async sendMessage(message: string): Promise<void> {
    return this.#send(message);
  }

  protected async receiveMessage(): Promise<string> {
    return this.#receive();
  }

  async write(message: string): Promise<void> {
    await this.#send(message);
    this.recordTurn({ role: "user", content: message });
  }

  async read(): Promise<string> {
    const reply = await this.#receive();
    this.recordTurn({ role: "assistant", content: reply });
    return reply;
  }
}
