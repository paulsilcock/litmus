import { BrowserDriver } from "@litmus/test";
import type { FrameLocator, Locator, Page } from "playwright";

import {
  CHAT_FRAME_CSS,
  CONTACT_PATH,
  type ElementQuery,
  SONOS_BASE_URL,
  type SonosSelectors,
  sonosSelectors,
} from "#sonos/selectors.ts";

export interface SonosChatDriverOptions {
  /** Run the browser headlessly. Defaults to `true`. */
  headless?: boolean;
  /**
   * Origin to resolve navigations against. Defaults to the live Sonos
   * support site; override to point at a local fixture server in tests.
   */
  baseUrl?: string;
  /** Path of the contact page that hosts the chat entry point. */
  contactPath?: string;
  /**
   * CSS selector of the chat `<iframe>`, or `null` when the widget
   * renders inline. Defaults to {@link CHAT_FRAME_CSS}.
   */
  chatFrameCss?: string | null;
  /** Override the element selectors (defaults to {@link sonosSelectors}). */
  selectors?: SonosSelectors;
}

/** A snapshot of the contact page, produced by the exploration harness. */
export interface ContactPageReport {
  url: string;
  title: string;
  frames: { name: string; url: string }[];
  scriptHosts: string[];
  candidateControls: { tag: string; role: string; text: string }[];
  accessibilityTree: unknown;
}

/**
 * Drives the Sonos customer-support chat widget through a real browser.
 *
 * Extends litmus's {@link BrowserDriver}, which spoofs a current-Chrome
 * User-Agent (and matching Client Hints) by default — this is what gets
 * us past the bot wall that 403s plain HTTP clients and headless
 * fingerprints. Construct synchronously, then `await init()` to launch
 * the browser; scope the lifetime with `await using` so it's released.
 *
 * The day-to-day driving surface is small and intention-revealing:
 * {@link openChat}, {@link awaitGreeting}, {@link send}. Everything that
 * depends on Sonos's actual markup is funnelled through the selectors in
 * `selectors.ts`, so a markup change is a one-file fix.
 *
 * @example
 * ```typescript
 * await using driver = new SonosChatDriver();
 * await driver.init();
 * await driver.openChat();
 * const greeting = await driver.awaitGreeting();
 * const reply = await driver.send("Can I use a Play:5 with my Arc?");
 * ```
 */
export class SonosChatDriver extends BrowserDriver {
  readonly #contactPath: string;
  readonly #chatFrameCss: string | null;
  readonly #selectors: SonosSelectors;

  constructor(options: SonosChatDriverOptions = {}) {
    super({
      baseUrl: options.baseUrl ?? SONOS_BASE_URL,
      headless: options.headless ?? true,
    });
    this.#contactPath = options.contactPath ?? CONTACT_PATH;
    this.#chatFrameCss =
      options.chatFrameCss === undefined
        ? CHAT_FRAME_CSS
        : options.chatFrameCss;
    this.#selectors = options.selectors ?? sonosSelectors;
  }

  // ── Driving surface ────────────────────────────────────────────────

  /**
   * Navigate to the contact page, dismiss any cookie banner, open the
   * chat widget, and wait until the message composer is ready to type
   * into. Idempotent enough to be the first call in every scenario.
   */
  async openChat(): Promise<void> {
    await this.page.goto(this.#contactPath, { waitUntil: "domcontentloaded" });
    await this.#dismissCookies();
    const launcher = await this.#firstVisible(
      this.page,
      this.#selectors.chatLauncher,
    );
    await launcher.click();
    // The composer becoming visible is our signal the widget has loaded.
    await this.#firstVisible(this.#chatRoot(), this.#selectors.composer);
  }

  /**
   * Wait for the agent's opening message (many support bots greet first)
   * and return its text. Use as `UserSimulator`'s `awaitOpening`.
   */
  async awaitGreeting(): Promise<string> {
    return this.#awaitNewAgentMessage(0);
  }

  /**
   * Send one customer message and resolve with the agent's reply text
   * once it has finished streaming in. Use as `UserSimulator`'s
   * `onMessage`.
   */
  async send(message: string): Promise<string> {
    const before = await this.#agentMessageCount();
    const composer = await this.#firstVisible(
      this.#chatRoot(),
      this.#selectors.composer,
    );
    await composer.click();
    await composer.fill(message);
    await this.#submit(composer);
    return this.#awaitNewAgentMessage(before);
  }

  /** The most recent agent message currently on screen, or `""`. */
  async latestAgentMessage(): Promise<string> {
    const messages = await this.#agentMessages();
    const count = await messages.count();
    if (count === 0) return "";
    return (await messages.nth(count - 1).innerText()).trim();
  }

  // ── Exploration harness support ────────────────────────────────────
  //
  // These exist so the exploration harness can capture the real DOM and
  // tell you how to fill in `selectors.ts`. They are not part of the
  // day-to-day driving API.

  /** Open the contact page and capture a structural snapshot of it. */
  async describeContactPage(): Promise<ContactPageReport> {
    await this.page.goto(this.#contactPath, { waitUntil: "domcontentloaded" });
    await this.#dismissCookies();
    await this.page.waitForTimeout(2_000); // let late widgets boot

    const scriptHosts = await this.page.evaluate(() => {
      const srcs = Array.from(document.querySelectorAll("script[src]"))
        .map((s) => s.getAttribute("src") ?? "")
        .filter(Boolean);
      const hosts = srcs.map((src) => {
        try {
          return new URL(src, document.baseURI).host;
        } catch {
          return src;
        }
      });
      return Array.from(new Set(hosts)).sort();
    });

    const candidateControls = await this.page.evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll("button, a, [role='button']"),
      ).slice(0, 300);
      return nodes.map((el) => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") ?? "",
        text: (el.textContent ?? "").trim().slice(0, 80),
      }));
    });

    return {
      url: this.page.url(),
      title: await this.page.title(),
      frames: this.page.frames().map((f) => ({ name: f.name(), url: f.url() })),
      scriptHosts,
      candidateControls,
      accessibilityTree: await this.page.locator("body").ariaSnapshot(),
    };
  }

  /** Write a full-page screenshot to `path` (PNG). */
  async screenshot(path: string): Promise<void> {
    await this.page.screenshot({ path, fullPage: true });
  }

  // ── Internals ──────────────────────────────────────────────────────

  /** Root to search within: the chat iframe when configured, else the page. */
  #chatRoot(): Page | FrameLocator {
    return this.#chatFrameCss === null
      ? this.page
      : this.page.frameLocator(this.#chatFrameCss);
  }

  #candidates(root: Page | FrameLocator, query: ElementQuery): Locator[] {
    const out: Locator[] = [];
    for (const r of query.role ?? []) {
      out.push(
        root.getByRole(
          r.role,
          r.name === undefined
            ? { exact: r.exact }
            : { name: r.name, exact: r.exact },
        ),
      );
    }
    for (const t of query.text ?? []) out.push(root.getByText(t));
    for (const c of query.css ?? []) out.push(root.locator(c));
    return out;
  }

  /** First candidate that resolves to a visible element, polled to `timeoutMs`. */
  async #firstVisible(
    root: Page | FrameLocator,
    query: ElementQuery,
    timeoutMs = 20_000,
  ): Promise<Locator> {
    const deadline = Date.now() + timeoutMs;
    const candidates = this.#candidates(root, query);
    while (Date.now() < deadline) {
      for (const candidate of candidates) {
        const first = candidate.first();
        if (await first.isVisible().catch(() => false)) return first;
      }
      await this.page.waitForTimeout(250);
    }
    throw new Error(
      `Sonos chat: could not find ${query.description}. The selectors in ` +
        `selectors.ts likely need updating — capture the live DOM with ` +
        `\`LITMUS_SONOS_LIVE=1 vp test explore\` and refresh them.`,
    );
  }

  async #dismissCookies(): Promise<void> {
    for (const candidate of this.#candidates(
      this.page,
      this.#selectors.cookieAccept,
    )) {
      const first = candidate.first();
      if (await first.isVisible().catch(() => false)) {
        await first.click().catch(() => {});
        return;
      }
    }
  }

  async #submit(composer: Locator): Promise<void> {
    for (const candidate of this.#candidates(
      this.#chatRoot(),
      this.#selectors.sendButton,
    )) {
      const first = candidate.first();
      const ready =
        (await first.isVisible().catch(() => false)) &&
        (await first.isEnabled().catch(() => false));
      if (ready) {
        await first.click();
        return;
      }
    }
    await composer.press("Enter");
  }

  /** The agent-message candidate that currently matches the most nodes. */
  async #agentMessages(): Promise<Locator> {
    const candidates = this.#candidates(
      this.#chatRoot(),
      this.#selectors.agentMessage,
    );
    let best = candidates[0];
    let bestCount = -1;
    for (const candidate of candidates) {
      const count = await candidate.count().catch(() => 0);
      if (count > bestCount) {
        bestCount = count;
        best = candidate;
      }
    }
    if (best === undefined) {
      throw new Error(
        "Sonos chat: no agent-message selector configured in selectors.ts",
      );
    }
    return best;
  }

  async #agentMessageCount(): Promise<number> {
    return (await this.#agentMessages()).count().catch(() => 0);
  }

  /**
   * Wait for a new agent bubble (count grows past `before`), then for its
   * text to stop changing — so we return the whole reply rather than a
   * half-streamed fragment.
   */
  async #awaitNewAgentMessage(
    before: number,
    timeoutMs = 45_000,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if ((await this.#agentMessageCount()) > before) break;
      await this.page.waitForTimeout(300);
    }

    let last = "";
    let stableSince = Date.now();
    while (Date.now() < deadline) {
      const text = await this.latestAgentMessage();
      if (text.length > 0 && text === last) {
        if (Date.now() - stableSince > 1_500) return text;
      } else {
        last = text;
        stableSince = Date.now();
      }
      await this.page.waitForTimeout(300);
    }

    if (last.length > 0) return last;
    throw new Error("Sonos chat: timed out waiting for the agent's reply.");
  }
}
