import { setImmediate } from "node:timers/promises";

import type { Audio } from "@litmus/core/ai";
import { expect } from "vite-plus/test";

import {
  MockSpeechListener,
  mockSpeech,
} from "#litmus-test/test-support/mock-speech.ts";

const SAMPLE_RATE = 24_000;
const SILENCE: Audio = {
  samples: Array.from({ length: 240 }, () => 0),
  sampleRate: SAMPLE_RATE,
};

/**
 * A pretend voice support line. It understands mock speech, refunds an
 * order when a customer asks for a refund by order number (if the order
 * exists), and otherwise asks how it can help. Between replies it's silent.
 */
class FakeSupportLine {
  readonly #orders = new Set<string>();
  readonly #refunds: string[] = [];
  readonly #speech: number[][] = [];
  readonly #listener = new MockSpeechListener();

  addOrder(order: string): void {
    this.#orders.add(order);
  }

  refunds(): readonly string[] {
    return [...this.#refunds];
  }

  hear(audio: Audio): void {
    for (const words of this.#listener.hear(audio.samples)) {
      this.#respondTo(words);
    }
  }

  async nextSpeech(): Promise<Audio> {
    // Real audio arrives over time; yielding keeps the line from monopolising
    // the event loop.
    await setImmediate();
    const samples = this.#speech.shift();
    return samples ? { samples, sampleRate: SAMPLE_RATE } : SILENCE;
  }

  #respondTo(words: string): void {
    const order = /\d+/.exec(words)?.[0];
    if (!/refund/i.test(words)) {
      this.#say("How can I help?");
    } else if (order && this.#orders.has(order)) {
      this.#refunds.push(order);
      this.#say(`Your refund for order ${order} is on its way.`);
    } else {
      this.#say("I can't find that order.");
    }
  }

  #say(words: string): void {
    this.#speech.push(...mockSpeech(words));
  }
}

class FakeOrdersDsl {
  readonly #line: FakeSupportLine;

  constructor(line: FakeSupportLine) {
    this.#line = line;
  }

  async customerHasOrdered(input: { order: string }): Promise<void> {
    this.#line.addOrder(input.order);
  }

  async assertRefunded(input: { order: string }): Promise<void> {
    expect(this.#line.refunds()).toContain(input.order);
  }
}

class FakeSupportDsl {
  readonly #line: FakeSupportLine;

  constructor(line: FakeSupportLine) {
    this.#line = line;
  }

  async customerSays(audio: Audio): Promise<void> {
    this.#line.hear(audio);
  }

  async agentSays(): Promise<Audio> {
    return this.#line.nextSpeech();
  }
}

/** DSL over a fake voice support system. No driver: the DSL plays the system. */
export class FakeVoiceSupportDsl {
  readonly orders: FakeOrdersDsl;
  readonly support: FakeSupportDsl;

  constructor() {
    const line = new FakeSupportLine();
    this.orders = new FakeOrdersDsl(line);
    this.support = new FakeSupportDsl(line);
  }
}
