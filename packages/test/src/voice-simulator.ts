import {
  experimental_generateSpeech as generateSpeech,
  generateText,
  type LanguageModel,
  Output,
  type SpeechModel,
  stepCountIs,
  type ToolSet,
  experimental_transcribe as transcribe,
  type TranscriptionModel,
} from "ai";
import { z } from "zod";

type VoiceUserSimulatorOptions =
  | {
      model: LanguageModel;
      speech: SpeechModel;
      transcription: TranscriptionModel;
      persona: string;
      goal: string;
      maxTurns?: number;
      tools?: ToolSet;
    }
  | {
      model: LanguageModel;
      speech: SpeechModel;
      transcription: TranscriptionModel;
      prompt: (turns: readonly Turn[]) => string;
      maxTurns?: number;
      tools?: ToolSet;
    };

/**
 * One side of an audio exchange: the bytes plus their IANA media
 * type. Carried by `onMessage` in both directions.
 */
export interface AudioMessage {
  data: Uint8Array;
  mediaType: string;
}

/** Response from the message callback — either audio to continue with, or a termination signal. */
type MessageResponse = AudioMessage | { done: boolean; reason: string };

interface Turn {
  role: "user" | "assistant";
  content: string;
}

interface Conversation {
  turns: Turn[];
  outcome: "goal_met" | "max_turns" | "terminated";
}

interface RunInput {
  onMessage: (audio: AudioMessage) => Promise<MessageResponse>;
  awaitOpening?: () => Promise<AudioMessage>;
  opening?: string;
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

export class VoiceUserSimulator {
  readonly #model: LanguageModel;
  readonly #speech: SpeechModel;
  readonly #transcription: TranscriptionModel;
  readonly #buildPrompt: (turns: readonly Turn[]) => string;
  readonly #maxTurns: number;
  readonly #tools: ToolSet | undefined;

  constructor(options: VoiceUserSimulatorOptions) {
    this.#model = options.model;
    this.#speech = options.speech;
    this.#transcription = options.transcription;
    this.#maxTurns = options.maxTurns ?? 10;
    this.#tools = options.tools;
    this.#buildPrompt =
      "prompt" in options
        ? options.prompt
        : (turns) => defaultPrompt(options.persona, options.goal, turns);
  }

  async run(input: RunInput): Promise<Conversation> {
    const turns: Turn[] = [];

    if (input.awaitOpening) {
      const opening = await input.awaitOpening();
      const transcription = await transcribe({
        model: this.#transcription,
        audio: opening.data,
      });
      turns.push({ role: "assistant", content: transcription.text });
    }

    for (let i = 0; i < this.#maxTurns; i++) {
      let message: string;
      let done: boolean;

      if (i === 0 && input.opening) {
        message = input.opening;
        done = false;
      } else {
        const result = await generateText({
          model: this.#model,
          prompt: this.#buildPrompt(turns),
          output: Output.object({ schema: userResponseSchema }),
          tools: this.#tools,
          stopWhen: this.#tools ? stepCountIs(this.#maxTurns) : undefined,
        });
        message = result.output.message;
        done = result.output.done;
      }

      const speech = await generateSpeech({
        model: this.#speech,
        text: message,
      });

      turns.push({ role: "user", content: message });

      if (done) {
        return { turns, outcome: "goal_met" };
      }

      const reply = await input.onMessage({
        data: speech.audio.uint8Array,
        mediaType: speech.audio.mediaType,
      });
      if (!("data" in reply)) {
        return { turns, outcome: "terminated" };
      }
      const transcription = await transcribe({
        model: this.#transcription,
        audio: reply.data,
      });
      turns.push({ role: "assistant", content: transcription.text });
    }

    return { turns, outcome: "max_turns" };
  }
}
