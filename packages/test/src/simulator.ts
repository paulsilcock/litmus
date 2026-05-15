import { generateText, type LanguageModel, Output, stepCountIs } from "ai";
import { z } from "zod";

type UserSimulatorOptions =
  | {
      model: LanguageModel;
      persona: string;
      goal: string;
      maxTurns?: number;
      tools?: Record<string, any>;
    }
  | {
      model: LanguageModel;
      prompt: (turns: readonly Turn[]) => string;
      maxTurns?: number;
      tools?: Record<string, any>;
    };

/** Response from the message callback — either a text reply or a termination signal. */
type MessageResponse = string | { done: boolean; reason: string };

/** Callback invoked when the simulated user sends a message. */
type OnMessageCallback = (message: string) => Promise<MessageResponse>;

interface RunInput {
  /** Optional first message. If omitted, the LLM generates one from the persona and goal. */
  opening?: string;
  /** Awaits an opening turn from the other side before the user generates their first reply. Useful when the SUT speaks first (e.g. a voice agent greeting). */
  awaitOpening?: () => Promise<string>;
  /** Called each time the simulated user sends a message. Return a string to continue, or `{ done, reason }` to end the conversation. */
  onMessage: OnMessageCallback;
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface Conversation {
  turns: Turn[];
  outcome: "goal_met" | "max_turns" | "terminated";
}

const userResponseSchema = z.object({
  message: z.string(),
  done: z.boolean(),
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

Decide your next message and whether your goal has been met.`;
}

/**
 * Simulates a user interacting with whatever is being tested —
 * an agent, a use case, or a full system. Uses an LLM to generate
 * realistic user messages driving multi-turn conversations.
 *
 * Two prompt modes:
 * - **Persona/goal** (simple): supply `persona` and `goal`; the
 *   simulator builds a default prompt per turn.
 * - **Prompt** (full control): supply `prompt: (turns) => string`;
 *   you own the entire prompt. The simulator still enforces the
 *   `{ message, done }` output contract.
 *
 * Either side can speak first. By default the simulated user opens.
 * Pass `awaitOpening` to `run()` when the SUT speaks first (e.g. a
 * voice agent greeting) — its returned string becomes the opening
 * turn and the user generates a reply to it.
 *
 * @example
 * ```typescript
 * const simulator = new UserSimulator({
 *   model: anthropic("claude-haiku-4-5-20251001"),
 *   persona: "Impatient customer who types in lowercase",
 *   goal: "Get a refund for a duplicate charge",
 * });
 *
 * const conversation = await simulator.run({
 *   onMessage: async (message) => agent.run(message),
 * });
 *
 * expect(conversation.outcome).toBe("goal_met");
 * ```
 */
export class UserSimulator {
  readonly #model: LanguageModel;
  readonly #buildPrompt: (turns: readonly Turn[]) => string;
  readonly #maxTurns: number;
  readonly #tools: Record<string, any> | undefined;

  constructor(options: UserSimulatorOptions) {
    this.#model = options.model;
    this.#maxTurns = options.maxTurns ?? 10;
    this.#tools = options.tools;
    this.#buildPrompt =
      "prompt" in options
        ? options.prompt
        : (turns) => defaultPrompt(options.persona, options.goal, turns);
  }

  /**
   * Run the simulation. The simulated user sends messages via
   * the LLM, and `onMessage` passes each message to whatever
   * is being tested and returns its response.
   *
   * @param input.opening - Optional first message from the user.
   *   Mutually exclusive with `awaitOpening`.
   * @param input.awaitOpening - Optional callback awaited before the
   *   user generates their first message. Its returned string is
   *   recorded as the opening turn (assistant role). Use when the
   *   SUT initiates the conversation.
   * @param input.onMessage - Callback that receives user messages
   *   and returns a response. Return a string to continue the
   *   conversation, or `{ done, reason }` to terminate it.
   * @returns The conversation transcript and outcome.
   */
  async run(input: RunInput): Promise<Conversation> {
    const turns: Turn[] = [];

    if (input.awaitOpening) {
      const opening = await input.awaitOpening();
      turns.push({ role: "assistant", content: opening });
    }

    for (let i = 0; i < this.#maxTurns; i++) {
      let userMessage: string;
      let done: boolean;

      if (i === 0 && input.opening) {
        userMessage = input.opening;
        done = false;
      } else {
        const result = await generateText({
          model: this.#model,
          prompt: this.#buildPrompt(turns),
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

      const response = await input.onMessage(userMessage);
      if (typeof response !== "string") {
        return { turns, outcome: "terminated" };
      }
      turns.push({ role: "assistant", content: response });
    }

    return { turns, outcome: "max_turns" };
  }
}
