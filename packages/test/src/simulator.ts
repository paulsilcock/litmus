import type { GenerationFunction, Tool } from "@litmus/core/ai";
import { z } from "zod";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

export const utteranceSchema = z.object({
  message: z.string(),
  status: z.enum(["continue", "goal_met", "abandoned"] as const),
});

/** What the simulated user says next, and how the pursuit should proceed. */
export type Utterance = z.infer<typeof utteranceSchema>;

type BaseOptions = {
  /**
   * Generates the simulated user's next utterance from the prompt the
   * simulator assembles each turn. Back it with a model (e.g.
   * `vercelGenerator({ model, schema: utteranceSchema })` from
   * `@litmus/ai/vercel`) or a plain function in tests.
   */
  generateResponse: GenerationFunction<Utterance>;
  /**
   * Domain actions the simulated user can take beyond talking — e.g.
   * apply a discount code, look up an order — wired by the test to DSL
   * methods. Offered to the generator on every turn.
   */
  abilities?: Record<string, Tool<any>>;
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
  readonly #generateResponse: GenerationFunction<Utterance>;
  readonly #abilities?: Record<string, Tool<any>>;
  readonly #turns: Turn[] = [];
  readonly #buildPrompt: (turns: readonly Turn[], goal: string) => string;

  constructor(options: BaseOptions) {
    this.#generateResponse = options.generateResponse;
    this.#abilities = options.abilities;
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

    for (let i = 0; i < maxTurns; i++) {
      const utterance = await this.#generateResponse(
        this.#buildPrompt(this.#turns, goal),
        this.#abilities,
      );

      await this.sendMessage(utterance.message);
      this.recordTurn({ role: "user", content: utterance.message });

      if (utterance.status !== "continue") {
        return pursuitOutcome(utterance.status);
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
