import type {
  Audio,
  SimulatedUserAction,
  VoiceModel,
  VoiceSession,
} from "@litmus/core/ai";

import { Conversation, type Turn } from "#litmus-test/conversation.ts";
import type { PursuitResult } from "#litmus-test/simulator.ts";

export interface VoiceOptions {
  /**
   * The voice model that plays the simulated user — e.g.
   * `new OpenAIRealtimeVoiceModel({ apiKey })` from `@litmus/ai/openai`.
   */
  model: VoiceModel;
  /** Who the simulated user is. */
  persona: string;
  /**
   * Plays the simulated user's speech to the system under test, e.g.
   * through a `BrowserDriver`'s fake microphone. It may return before the
   * audio has finished playing.
   */
  speak: (audio: Audio) => Promise<void>;
  /**
   * Returns the next chunk of what the system under test says, silences
   * included, as it happens. It must be at the model's `inputSampleRate`:
   * with a `BrowserDriver`, set `captureSampleRate: model.inputSampleRate`.
   */
  listen: () => Promise<Audio>;
  /**
   * How long, in milliseconds, the system may stay silent when it's its
   * turn to speak before the simulator gives up on it. Defaults to 10000.
   */
  silenceTimeout?: number;
}

/** Marks a wait for the system that ran out. */
const SILENT = Symbol("silent");

/** The open conversation, and what the simulated user does in it. */
interface Joined {
  session: VoiceSession;
  actions: AsyncIterator<SimulatedUserAction>;
}

/**
 * A simulated user that talks to the system under test out loud. It has
 * one conversation, which starts on first use and ends when the simulator
 * is disposed (`await using`), when a pursuit gives up, or when something
 * fails. After that, every call throws, saying why it ended.
 */
export class VoiceSimulator {
  readonly #model: VoiceModel;
  readonly #persona: string;
  readonly #speak: (audio: Audio) => Promise<void>;
  readonly #listen: () => Promise<Audio>;
  readonly #silenceTimeout: number;
  readonly #conversation = new Conversation();
  #joined?: Joined;
  /** Why the conversation ended, once it has. */
  #ended?: string;
  #silenceClock?: SilenceClock;
  /** When the simulated user's audio will have finished playing. */
  #playedUntil = 0;

  constructor(options: VoiceOptions) {
    this.#model = options.model;
    this.#persona = options.persona;
    this.#speak = options.speak;
    this.#listen = options.listen;
    this.#silenceTimeout = options.silenceTimeout ?? 10_000;
  }

  /**
   * Listens until the system has said something, and returns its words.
   * Throws if they can't be made out.
   */
  async hear(): Promise<string> {
    const joined = await this.#join();
    return this.#whileListening(joined, () =>
      this.#unlessSilent(async () => {
        // Nobody is talking yet, so the system's silence counts from now.
        this.#silenceClock?.start();
        for (;;) {
          const action = await this.#next(joined);
          await this.#handle(action);
          if (action.type === "heard") return action.text;
          if (action.type === "unclear") {
            throw new Error(
              `Couldn't make out what the system said (${action.reason}). Check that \`listen\` returns the system's speech.`,
            );
          }
        }
      }),
    );
  }

  /** Ends the conversation, closing the model's session. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.#leave("The simulator was disposed.");
  }

  /**
   * Everything said so far by the simulated user and the system under
   * test, in order.
   */
  async transcript(): Promise<readonly Turn[]> {
    return this.#conversation.turns();
  }

  /**
   * Has the simulated user pursue `goal` until it's met, or until it has
   * taken `maxTurns` turns (default 10) — then it gives up and hangs up.
   * Throws if the system falls silent or the conversation fails.
   */
  async pursueGoal(
    goal: string,
    opts: { maxTurns?: number } = {},
  ): Promise<PursuitResult> {
    const maxTurns = opts.maxTurns ?? 10;
    const joined = await this.#join();
    joined.session.pursue(goal);
    const result = await this.#whileListening(joined, () =>
      this.#unlessSilent(async (): Promise<PursuitResult> => {
        let turns = 0;
        for (;;) {
          const action = await this.#next(joined);
          await this.#handle(action);
          if (action.type !== "finishedTurn") continue;
          if (action.goalMet) return { met: true, reason: "goal_met" };
          if (++turns >= maxTurns) return { met: false, reason: "max_turns" };
        }
      }),
    );
    // A simulated user that gives up hangs up.
    if (!result.met) {
      await this.#leave(
        `The simulated user gave up after ${maxTurns} turn${maxTurns === 1 ? "" : "s"}.`,
      );
    }
    return result;
  }

  /** Opens the conversation on first use; later calls carry it on. */
  async #join(): Promise<Joined> {
    if (this.#ended !== undefined) {
      throw new Error(`The conversation has ended. ${this.#ended}`);
    }
    if (!this.#joined) {
      const session = await this.#model.connect({ persona: this.#persona });
      this.#joined = {
        session,
        actions: session.actions()[Symbol.asyncIterator](),
      };
    }
    return this.#joined;
  }

  async #leave(why: string): Promise<void> {
    this.#ended ??= why;
    const joined = this.#joined;
    this.#joined = undefined;
    await joined?.session[Symbol.asyncDispose]();
  }

  /** What the simulated user does next, for as long as the conversation lasts. */
  async #next(joined: Joined): Promise<SimulatedUserAction> {
    let next: IteratorResult<SimulatedUserAction>;
    try {
      next = await joined.actions.next();
    } catch (error) {
      await this.#leave(messageOf(error));
      throw error;
    }
    if (next.done) throw new Error("The conversation has ended.");
    return next.value;
  }

  /**
   * Runs `work`, unless the system says nothing for the silence timeout —
   * then the conversation can't go on, so it ends.
   */
  async #unlessSilent<T>(work: () => Promise<T>): Promise<T> {
    const clock = new SilenceClock(this.#silenceTimeout);
    this.#silenceClock = clock;
    const working = work();
    // If the system falls silent, how the work then ends no longer matters.
    working.catch(() => {});
    try {
      const first = await Promise.race([working, clock.silent]);
      if (first !== SILENT) return first;
    } finally {
      clock.stop();
      this.#silenceClock = undefined;
    }
    const silence = `The system said nothing for ${this.#silenceTimeout}ms. Check that \`listen\` returns what the system says.`;
    await this.#leave(silence);
    throw new Error(silence);
  }

  /**
   * Passes everything the system says to the model while `work` runs. If
   * listening fails, so does the work, and the conversation ends.
   */
  async #whileListening<T>(joined: Joined, work: () => Promise<T>): Promise<T> {
    let listening = true;
    let failListening = (_error: unknown): void => {};
    const listenFailed = new Promise<never>((_resolve, reject) => {
      failListening = reject;
    });
    const loop = (async () => {
      while (listening) {
        const audio = await this.#listen();
        const { inputSampleRate } = this.#model;
        if (audio.sampleRate !== inputSampleRate) {
          throw new Error(
            `The voice model listens at ${inputSampleRate}Hz, but \`listen\` gave audio at ${audio.sampleRate}Hz. With a browser driver, set \`captureSampleRate: model.inputSampleRate\`.`,
          );
        }
        joined.session.listenTo(audio);
      }
    })().catch(async (error: unknown) => {
      // Fail the work with what went wrong, before ending the conversation.
      failListening(error);
      await this.#leave(messageOf(error));
    });
    try {
      return await Promise.race([work(), listenFailed]);
    } finally {
      listening = false;
      await loop;
    }
  }

  async #handle(action: SimulatedUserAction): Promise<void> {
    switch (action.type) {
      case "speak":
        // Audio plays after any still queued, so it finishes later still.
        this.#playedUntil =
          Math.max(Date.now(), this.#playedUntil) + lengthInMs(action.audio);
        await this.#speak(action.audio);
        break;
      case "hearing":
        // The system has started speaking, so it isn't silent.
        this.#silenceClock?.stop();
        break;
      case "said":
        this.#conversation.add({
          speaker: "simulatedUser",
          content: action.text,
        });
        break;
      case "heard":
        this.#conversation.add({
          speaker: "systemUnderTest",
          content: action.text,
        });
        break;
      case "finishedTurn":
        // Now it's the system's turn to speak — once it's heard the
        // simulated user out.
        if (!action.goalMet) {
          this.#silenceClock?.start(
            Math.max(0, this.#playedUntil - Date.now()),
          );
        }
        break;
      case "unclear":
        break;
    }
  }
}

/**
 * Times how long the system stays silent while the simulated user waits
 * for it to speak.
 */
class SilenceClock {
  /** Settles once the system has been silent for too long. */
  readonly silent: Promise<typeof SILENT>;
  readonly #timeout: number;
  readonly #fallSilent: () => void;
  #timer?: ReturnType<typeof setTimeout>;

  constructor(timeout: number) {
    this.#timeout = timeout;
    let fallSilent = (): void => {};
    this.silent = new Promise((resolve) => {
      fallSilent = () => resolve(SILENT);
    });
    this.#fallSilent = fallSilent;
  }

  /** Starts (or restarts) timing, `delay` ms from now. */
  start(delay = 0): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(this.#fallSilent, delay + this.#timeout);
  }

  stop(): void {
    clearTimeout(this.#timer);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function lengthInMs(audio: Audio): number {
  return (audio.samples.length / audio.sampleRate) * 1000;
}
