import { setTimeout as sleep } from "node:timers/promises";

import { Dsl } from "@litmus/test";

import { ElevenLabsDocsDriver } from "./driver.ts";
import { type BridgeTurn, RealtimeBridge } from "./realtime-bridge.ts";

export type ConversationTurn = BridgeTurn;

interface CustomerCallInput {
  /** System instructions injected into the Realtime API as the
   *  simulated customer's persona, situation, and goals. */
  persona: string;
  /** Hard cap on the call duration. The bridge stops pumping audio
   *  and tears down the WebSocket when this elapses. */
  durationMs: number;
  /** Voice the simulated customer speaks with. Defaults to "alloy". */
  voice?: string;
}

/**
 * Test-author surface for evals against the ElevenLabs El voice
 * support agent. Hides the docs driver + Realtime bridge mechanics
 * behind a single business action per call.
 *
 * Stateless: each invocation of `customerCallsSupport` runs an
 * independent conversation. The driver instance is shared for the
 * lifetime of the DSL but not the call state.
 */
export class ElevenLabsDsl extends Dsl {
  readonly #driver = new ElevenLabsDocsDriver();

  override async init(): Promise<void> {
    await this.#driver.init();
  }

  override async cleanup(): Promise<void> {
    await this.#driver.cleanup();
  }

  /**
   * Drive a full customer-support call. Navigates to the El widget
   * on elevenlabs.io, joins the voice call, waits briefly for the
   * agent's greeting to buffer, then lets the Realtime-driven
   * simulated customer carry on the conversation until either the
   * goal is met or the duration cap elapses. Returns the full
   * transcript with speaker labels from the test author's
   * perspective (`agent` is El, `user` is the simulated customer).
   */
  async customerCallsSupport({
    persona,
    durationMs,
    voice,
  }: CustomerCallInput): Promise<readonly ConversationTurn[]> {
    await this.#driver.openVoiceCall();

    const bridge = new RealtimeBridge({
      driver: this.#driver,
      instructions: persona,
      voice,
    });
    // Buffer the agent's greeting while we wait — without this, the
    // first thing the simulator hears is El nudging "you might be on
    // mute?" rather than the actual greeting.
    await bridge.startCapture();
    await sleep(4000);

    return bridge.run({ maxDurationMs: durationMs });
  }
}
