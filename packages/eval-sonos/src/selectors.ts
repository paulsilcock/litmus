import type { Page } from "playwright";

/**
 * The Sonos support contact page that hosts the chat entry point.
 *
 * `baseUrl` + `contactPath` are kept separate so `page.goto(contactPath)`
 * resolves against the browser context's base URL — and so tests can
 * point the driver at a local fixture server instead.
 */
export const SONOS_BASE_URL = "https://support.sonos.com";
export const CONTACT_PATH = "/en-gb/contact";

/**
 * Set this to a CSS selector for the chat widget's `<iframe>` if live
 * exploration shows the conversation renders inside one (Salesforce,
 * Zendesk, Ada, Gladly and friends usually do). Leave `null` when the
 * widget renders inline in the top-level document.
 *
 * UNVERIFIED — confirm with the exploration harness (see explore.test.ts).
 */
export const CHAT_FRAME_CSS: string | null = null;

/** ARIA role accepted by Playwright's `getByRole`. */
type Role = Parameters<Page["getByRole"]>[0];

/**
 * A resilient, multi-strategy description of one element. The driver
 * tries `role` queries first (they mirror how a user finds the control
 * and survive markup churn), then visible `text`, then `css` as a last
 * resort. The first strategy that resolves to a visible element wins.
 *
 * `description` is surfaced in the error when nothing matches, so a
 * failure tells you exactly which selector group to refresh.
 */
export interface ElementQuery {
  description: string;
  role?: { role: Role; name?: string | RegExp; exact?: boolean }[];
  text?: (string | RegExp)[];
  css?: string[];
}

/**
 * Everything the driver needs to locate, grouped by purpose.
 *
 * ⚠️  THE SELECTORS BELOW ARE UNVERIFIED GUESSES. They could not be
 * confirmed against the live site from the build sandbox (no browser
 * binary + egress is allow-listed away from sonos.com). They encode the
 * *common shapes* of hosted chat widgets so the driver has a fighting
 * chance on first run, and — more importantly — they are the SINGLE
 * PLACE to correct once you have the real DOM.
 *
 * To get the real DOM: run the exploration harness from an environment
 * with a browser and network access to support.sonos.com:
 *
 *   LITMUS_SONOS_LIVE=1 vp test explore
 *
 * It writes `artifacts/sonos-contact-report.json` (frames, scripts,
 * candidate buttons, accessibility tree) and screenshots. Read those,
 * then update the entries here.
 */
export interface SonosSelectors {
  /** Cookie/consent "accept" control, dismissed before anything else. */
  cookieAccept: ElementQuery;
  /** The control that opens the chat window from the contact page. */
  chatLauncher: ElementQuery;
  /** The text box the customer types into. */
  composer: ElementQuery;
  /** Explicit send control. Falls back to pressing Enter when absent. */
  sendButton: ElementQuery;
  /** A single agent/bot message bubble. Matched as a set; the last is "latest". */
  agentMessage: ElementQuery;
}

export const sonosSelectors: SonosSelectors = {
  cookieAccept: {
    description: "cookie consent accept button",
    role: [{ role: "button", name: /accept all|accept|agree|got it/i }],
    css: ["#onetrust-accept-btn-handler", "button[aria-label*='accept' i]"],
  },

  chatLauncher: {
    description: "chat launcher / 'start chat' button",
    role: [
      {
        role: "button",
        name: /chat|message us|start a conversation|live chat/i,
      },
      { role: "link", name: /chat|message us|live chat/i },
    ],
    text: [/chat with us/i, /start chat/i, /live chat/i],
    css: [
      "[aria-label*='chat' i]",
      "[data-testid*='chat' i]",
      "button[class*='chat' i]",
    ],
  },

  composer: {
    description: "chat message input box",
    role: [{ role: "textbox" }],
    css: [
      "textarea",
      "input[type='text']",
      "[contenteditable='true']",
      "[data-testid*='input' i]",
    ],
  },

  sendButton: {
    description: "send message button",
    role: [{ role: "button", name: /send/i }],
    css: [
      "button[type='submit']",
      "[aria-label*='send' i]",
      "[data-testid*='send' i]",
    ],
  },

  agentMessage: {
    description: "agent/bot message bubble",
    css: [
      "[data-author='agent']",
      "[data-from='bot']",
      "[class*='agent' i][class*='message' i]",
      "[class*='bot' i][class*='message' i]",
      "[class*='received' i]",
      ".agent-msg",
    ],
  },
};
