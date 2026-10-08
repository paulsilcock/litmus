import { setTimeout as sleep } from "node:timers/promises";

import type { Locator } from "playwright";

import { BrowserDriver } from "#litmus-test/drivers/browser.ts";

import { setting } from "./settings.ts";

/** A call as the business sees it in the dashboard. */
export interface RecordedCall {
  /** The caller's name as recorded, or "Unknown Caller". */
  name: string;
  /** The caller's number, in international format. */
  phone: string;
  /** Where the caller is, as recorded on their customer record. */
  location: string;
  /** The caller's email addresses on their customer record, if any. */
  emails: string[];
  /** The call's subject line and summary. */
  summary: string;
}

/**
 * Cyberstaff's dashboard pages, in a browser logged in with the
 * account's email and password from .env. Used by `CyberstaffDriver`;
 * tests and DSLs don't see it.
 */
export class Dashboard extends BrowserDriver {
  /** How to put back each setting changed, keyed by setting. */
  readonly #restores = new Map<string, () => Promise<void>>();

  constructor() {
    super({
      baseUrl: "https://cyberstaff.com",
      headless: process.env["HEADED"] === undefined,
    });
  }

  override async init(): Promise<void> {
    await super.init();
    await this.page.goto("/login");
    await this.page
      .getByPlaceholder("contact@example.com")
      .fill(setting("CYBERSTAFF_EMAIL"));
    await this.page
      .getByPlaceholder("••••••••")
      .fill(setting("CYBERSTAFF_PASSWORD"));
    await this.page.getByRole("button", { name: "Sign In" }).click();
    await this.page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 30_000,
    });
  }

  /**
   * Finds the call from `from` that started at or after `after`, once
   * it's listed and summarised: a call is listed straight away, but its
   * summary is written a little later.
   */
  async findCall(options: {
    from: string;
    after: Date;
    within?: number;
  }): Promise<RecordedCall> {
    const deadline = Date.now() + (options.within ?? 60_000);
    // The list shows minutes, so compare from the start of the minute.
    const earliest = new Date(options.after);
    earliest.setSeconds(0, 0);

    const row = await this.#waitFor(
      deadline,
      `No call from ${options.from} since ${options.after.toLocaleTimeString()} showed up in the dashboard.`,
      async () => {
        await this.page.goto("/calls");
        return this.#rowFor(options.from, earliest);
      },
    );
    await row.click();
    await this.page.waitForURL(/\/calls\/[^/]+$/, { timeout: 15_000 });

    const summary = await this.#waitFor(
      deadline,
      `The call from ${options.from} was never summarised.`,
      async () => {
        await this.page.reload();
        return this.#summary();
      },
    );
    return { ...(await this.#readCaller()), summary };
  }

  /** Switches multilingual calls on or off, until the driver closes. */
  setMultilingual(on: boolean): Promise<void> {
    return this.#setSwitch({
      page: "/settings",
      setting: "multilingual calls",
      toggle: () =>
        this.page.getByRole("switch", { name: "Enable multilingual" }),
      // The switch lives in the folded-away "Advanced settings" section.
      reveal: async () => {
        const advanced = this.page.getByRole("button", {
          name: "Advanced settings",
        });
        if ((await advanced.getAttribute("aria-expanded")) !== "true") {
          await advanced.click();
        }
      },
      on,
    });
  }

  /**
   * Switches asking callers for their email address on or off, until the
   * driver closes.
   */
  setEmailCollection(on: boolean): Promise<void> {
    return this.#setSwitch({
      page: "/workflows",
      setting: "asking for email addresses",
      // The switch isn't labelled: it shares a row with its label's text.
      toggle: () =>
        this.page
          .getByRole("main")
          .first()
          .locator("div")
          .filter({
            hasText: /^Email address$/,
            has: this.page.getByRole("switch"),
          })
          .getByRole("switch"),
      on,
    });
  }

  /** Puts back every setting the driver changed, then closes the browser. */
  override async [Symbol.asyncDispose](): Promise<void> {
    const failures: unknown[] = [];
    for (const restore of this.#restores.values()) {
      try {
        await restore();
      } catch (error) {
        failures.push(error);
      }
    }
    this.#restores.clear();
    await super[Symbol.asyncDispose]();
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Couldn't put the business's settings back as they were.",
      );
    }
  }

  /**
   * Turns a setting's switch on or off, checks the change saved, and
   * remembers how it was so closing the driver can put it back.
   * `reveal` opens whatever the switch is folded away in, if anything.
   */
  async #setSwitch(options: {
    page: string;
    setting: string;
    toggle: () => Locator;
    reveal?: () => Promise<void>;
    on: boolean;
  }): Promise<void> {
    await this.page.goto(options.page);
    const isOn = async () =>
      (await options.toggle().getAttribute("aria-checked", {
        timeout: 15_000,
      })) === "true";
    const was = await isOn();
    if (was !== options.on) {
      await options.reveal?.();
      await options.toggle().click();
      await this.page.waitForTimeout(1_500);
      // Check the change stuck, rather than trusting the click.
      await this.page.reload();
      if ((await isOn()) !== options.on) {
        throw new Error(
          `Couldn't switch ${options.setting} ${options.on ? "on" : "off"}: it didn't save.`,
        );
      }
      if (!this.#restores.has(options.setting)) {
        this.#restores.set(options.setting, () =>
          this.#setSwitch({ ...options, on: was }),
        );
      }
    }
  }

  /**
   * Retries `attempt` every few seconds until it finds something, or
   * fails with `failure` once `deadline` passes.
   */
  async #waitFor<T>(
    deadline: number,
    failure: string,
    attempt: () => Promise<T | undefined>,
  ): Promise<T> {
    for (;;) {
      const found = await attempt();
      if (found !== undefined) return found;
      if (Date.now() > deadline) throw new Error(failure);
      await sleep(5_000);
    }
  }

  /** The row for a call from `from` at or after `earliest`, if listed. */
  async #rowFor(from: string, earliest: Date) {
    const rows = this.page.getByRole("row");
    // The first row holds the column headers.
    await rows.nth(1).waitFor({ timeout: 15_000 });
    const headers = (
      await this.page.getByRole("columnheader").allInnerTexts()
    ).map((header) => header.trim());
    const timeColumn = headers.indexOf("Time");
    const phoneColumn = headers.indexOf("Phone");
    const caller = digits(from).slice(-10);
    for (const row of (await rows.all()).slice(1)) {
      const cells = row.getByRole("cell");
      const time = new Date((await cells.nth(timeColumn).innerText()).trim());
      const phone = digits(await cells.nth(phoneColumn).innerText());
      if (phone.endsWith(caller) && time >= earliest) return row;
    }
    return undefined;
  }

  /**
   * The open call's subject and summary: the paragraphs between the
   * "Call Summary" and "Notes" labels. Undefined until it's written.
   */
  async #summary(): Promise<string | undefined> {
    const main = this.page.getByRole("main").first();
    await main.getByText("Call Summary", { exact: true }).waitFor({
      timeout: 15_000,
    });
    const paragraphs = (await main.getByRole("paragraph").allInnerTexts()).map(
      (text) => text.trim(),
    );
    const summary = paragraphs
      .slice(
        paragraphs.indexOf("Call Summary") + 1,
        paragraphs.indexOf("Notes"),
      )
      .join("\n");
    return summary === "" ? undefined : summary;
  }

  /** Who made the open call, from their customer record. */
  async #readCaller(): Promise<Omit<RecordedCall, "summary">> {
    const caller = this.page
      .getByRole("main")
      .first()
      .locator('a[href^="/customers/"]')
      .first();
    const name = (await caller.innerText()).trim();
    await caller.click();
    await this.page.waitForURL(/\/customers\/[^/]+$/, { timeout: 15_000 });
    // The page's header has the business's own number, so look only in
    // the customer record.
    const record = this.page.getByRole("main").first();
    const location = await record
      .getByPlaceholder("Click to add location")
      .inputValue({ timeout: 15_000 });
    // Each saved address has its own box, above an empty one for adding
    // another: the boxes holding an address are the saved ones.
    const boxes = await record.getByRole("textbox").all();
    const values = await Promise.all(boxes.map((box) => box.inputValue()));
    const emails = values.filter((value) => value.includes("@"));
    const tel =
      (await record.locator('a[href^="tel:"]').first().getAttribute("href")) ??
      "";
    return { name, phone: tel.replace(/^tel:/, ""), location, emails };
  }
}

function digits(text: string): string {
  return text.replace(/\D/g, "");
}
