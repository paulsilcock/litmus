import { expect } from "vite-plus/test";

import type { Turn } from "#litmus-test/conversation.ts";

import type { Caller, CyberstaffDriver } from "./cyberstaff-driver.ts";

/** What the business's customers do, and what they're told. */
export class CustomerDsl {
  readonly #driver: CyberstaffDriver;

  constructor(driver: CyberstaffDriver) {
    this.#driver = driver;
  }

  /**
   * The customer rings the business, explains the job, and gives their
   * details, then says goodbye once they're told someone will be in touch.
   */
  async phonesTheBusiness(caller: Caller): Promise<void> {
    await this.#driver.phoneTheBusiness(caller);
  }

  /**
   * The customer rings the business to ask what a job costs, then says
   * goodbye once they've been told a price.
   */
  async asksWhatItCosts(enquiry: {
    phone: string;
    area: string;
    job: string;
  }): Promise<void> {
    await this.#driver.askWhatItCosts(enquiry);
  }

  /** Checks the receptionist named the business when it answered. */
  checkWasGreetedAs(expected: { business: string }): void {
    const { greeting } = this.#driver.lastCall();
    expect
      .soft(
        greeting.toLowerCase().includes(expected.business.toLowerCase()),
        `The receptionist didn't say "${expected.business}" when it answered. It said: ${greeting}`,
      )
      .toBe(true);
  }

  /**
   * Checks the receptionist never had to ask the customer to say
   * something again. Only spots English requests.
   */
  checkWasNotAskedToRepeatThemselves(): void {
    const askedAgain = saidByReceptionist(
      this.#driver.lastCall().transcript,
    ).filter((said) => ASKED_AGAIN.test(said));
    expect
      .soft(
        askedAgain,
        "The receptionist asked the customer to repeat themselves.",
      )
      .toEqual([]);
  }

  /** Checks the receptionist quoted this price, in pounds. */
  checkWasQuoted(expected: { pounds: number }): void {
    const said = saidByReceptionist(this.#driver.lastCall().transcript).join(
      "\n",
    );
    const quoted = new RegExp(
      `£\\s?${expected.pounds}\\b|\\b${expected.pounds} pounds`,
      "i",
    );
    expect
      .soft(
        quoted.test(said),
        `The receptionist never quoted £${expected.pounds}. It said:\n${said}`,
      )
      .toBe(true);
  }
}

const ASKED_AGAIN =
  /\b(repeat|say that again|didn'?t (quite )?catch|pardon|come again)\b/i;

function saidByReceptionist(transcript: readonly Turn[]): string[] {
  return transcript
    .filter((turn) => turn.speaker === "systemUnderTest")
    .map((turn) => turn.content);
}
