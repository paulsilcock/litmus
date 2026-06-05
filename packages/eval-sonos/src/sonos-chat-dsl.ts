import { Dsl } from "@litmus/test";

import { type SonosChatDriver } from "#sonos/sonos-chat-driver.ts";

/**
 * Domain language for an acceptance/eval suite that talks to the Sonos
 * support chatbot the way a customer would: open the chat, read what the
 * agent says, say something back.
 *
 * Thin by design — it reads like the steps of a support conversation and
 * delegates every "how" to {@link SonosChatDriver}. Disposing the DSL
 * (via `await using` or the `acceptance()` fixture) closes the browser.
 *
 * @example
 * ```typescript
 * await using chat = new SonosChatDsl(driver);
 * await chat.openSupportChat();
 * const greeting = await chat.awaitGreeting();
 * const reply = await chat.say("Will a Play:5 work with my Arc?");
 * ```
 */
export class SonosChatDsl extends Dsl<SonosChatDriver> {
  /** Open the contact page and start a chat session. */
  async openSupportChat(): Promise<void> {
    await this.driver.openChat();
  }

  /** Wait for and return the agent's opening message. */
  async awaitGreeting(): Promise<string> {
    return this.driver.awaitGreeting();
  }

  /** Send a customer message and return the agent's reply. */
  async say(message: string): Promise<string> {
    return this.driver.send(message);
  }
}
