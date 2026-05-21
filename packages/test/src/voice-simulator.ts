import {
  experimental_generateSpeech as generateSpeech,
  generateText,
  type LanguageModel,
  Output,
  type SpeechModel,
  experimental_transcribe as transcribe,
  type TranscriptionModel,
} from "ai";
import { z } from "zod";

interface VoiceUserSimulatorOptions {
  model: LanguageModel;
  speech: SpeechModel;
  transcription: TranscriptionModel;
  persona: string;
  goal: string;
  maxTurns?: number;
}

/**
 * One side of an audio exchange: the bytes plus their IANA media
 * type. Carried by `onMessage` in both directions.
 */
export interface AudioMessage {
  data: Uint8Array;
  mediaType: string;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
}

interface Conversation {
  turns: Turn[];
  outcome: "goal_met" | "max_turns" | "terminated";
}

interface RunInput {
  onMessage: (audio: AudioMessage) => Promise<AudioMessage>;
  awaitOpening?: () => Promise<AudioMessage>;
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
  readonly #persona: string;
  readonly #goal: string;
  readonly #maxTurns: number;

  constructor(options: VoiceUserSimulatorOptions) {
    this.#model = options.model;
    this.#speech = options.speech;
    this.#transcription = options.transcription;
    this.#persona = options.persona;
    this.#goal = options.goal;
    this.#maxTurns = options.maxTurns ?? 10;
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
      const result = await generateText({
        model: this.#model,
        prompt: defaultPrompt(this.#persona, this.#goal, turns),
        output: Output.object({ schema: userResponseSchema }),
      });
      const { message, done } = result.output;

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
      const transcription = await transcribe({
        model: this.#transcription,
        audio: reply.data,
      });
      turns.push({ role: "assistant", content: transcription.text });
    }

    return { turns, outcome: "max_turns" };
  }
}
