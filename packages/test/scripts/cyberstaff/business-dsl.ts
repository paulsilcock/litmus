import { expect } from "vite-plus/test";

import type { CyberstaffDriver } from "./cyberstaff-driver.ts";

/** What the business owner sets up, and what they see of their calls. */
export class BusinessDsl {
  readonly #driver: CyberstaffDriver;

  constructor(driver: CyberstaffDriver) {
    this.#driver = driver;
  }

  /** Has the receptionist take calls in `language`: English by default. */
  async acceptCallsIn(options: { language?: string }): Promise<void> {
    await this.#driver.acceptCallsIn(options.language);
  }

  /** Has the receptionist ask callers for their email address. */
  async asksCallersForTheirEmail(): Promise<void> {
    await this.#driver.askCallersForEmail();
  }

  /**
   * Checks the business has what it needs to follow up the customer's
   * last call: who they are, how to reach them, where the job is, what
   * it is, and when they're free. Checks their email only if they gave
   * one.
   */
  async checkEnquiryRecorded(expected: {
    name: string;
    phone: string;
    email?: string;
    area: string;
    job: string;
    available: string;
  }): Promise<void> {
    const call = await this.#driver.recordOfLastCall();
    const summary = call.summary.toLowerCase();
    expect
      .soft(call.name, "The customer's name")
      .toMatch(new RegExp(`^${expected.name}$`, "i"));
    expect
      .soft(digits(call.phone), "The customer's number")
      .toBe(digits(expected.phone));
    if (expected.email !== undefined) {
      expect
        .soft(
          call.emails.map((email) => email.toLowerCase()),
          "The customer's email addresses",
        )
        .toContain(expected.email.toLowerCase());
    }
    expect
      .soft(
        `${call.location}\n${summary}`.toLowerCase(),
        "Where the job is, on the customer's record or in the summary",
      )
      .toContain(expected.area.toLowerCase());
    expect
      .soft(summary, "The job, in the call summary")
      .toContain(expected.job.toLowerCase());
    expect
      .soft(summary, "When the customer's free, in the call summary")
      .toContain(expected.available.toLowerCase());
  }
}

function digits(text: string): string {
  return text.replace(/\D/g, "");
}
