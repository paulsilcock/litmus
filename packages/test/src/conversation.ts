/** One contribution to a conversation: who spoke, and what they said. */
export interface Turn {
  speaker: "simulatedUser" | "systemUnderTest";
  content: string;
}

/**
 * The record of what the simulated user and the system under test have
 * said to each other, in order.
 */
export class Conversation {
  readonly #turns: Turn[] = [];

  add(turn: Turn): void {
    this.#turns.push(turn);
  }

  turns(): readonly Turn[] {
    return [...this.#turns];
  }

  /**
   * What the system under test just said, if the simulated user hasn't
   * responded to it yet. Empty when the simulated user spoke last or
   * nothing has been said.
   */
  latestReply(): string {
    return this.#unansweredReply()?.content ?? "";
  }

  /** Everything said before {@link latestReply}. */
  previousTurns(): readonly Turn[] {
    return this.#unansweredReply()
      ? this.#turns.slice(0, -1)
      : [...this.#turns];
  }

  #unansweredReply(): Turn | undefined {
    const newest = this.#turns.at(-1);
    return newest?.speaker === "systemUnderTest" ? newest : undefined;
  }
}
