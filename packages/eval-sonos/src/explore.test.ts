import { mkdirSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { SonosChatDriver } from "#sonos/sonos-chat-driver.ts";

/**
 * The exploration harness. This is how you "work out how to drive their
 * UI": it launches litmus's UA-spoofing browser at the live Sonos
 * contact page and dumps everything you need to fill in `selectors.ts` —
 * the iframe list, third-party script hosts (which reveal the chat
 * platform), every candidate button, the accessibility tree, and
 * screenshots.
 *
 * It is gated behind `LITMUS_SONOS_LIVE=1` because it needs a real
 * browser and outbound network access to support.sonos.com — neither of
 * which exists in CI or the build sandbox. Run it from a machine that
 * has both:
 *
 *   LITMUS_SONOS_LIVE=1 vp test explore
 *
 * Artifacts land in `packages/eval-sonos/artifacts/`. Set
 * `LITMUS_SONOS_HEADED=1` to watch it run.
 */
const LIVE = process.env["LITMUS_SONOS_LIVE"] === "1";
const ARTIFACTS = new URL("../artifacts/", import.meta.url);

describe("Sonos contact page exploration", () => {
  it.runIf(LIVE)(
    "captures the contact page structure and chat entry point",
    async () => {
      await using driver = new SonosChatDriver({
        headless: process.env["LITMUS_SONOS_HEADED"] !== "1",
      });
      await driver.init();

      const report = await driver.describeContactPage();

      mkdirSync(ARTIFACTS, { recursive: true });
      writeFileSync(
        new URL("sonos-contact-report.json", ARTIFACTS),
        JSON.stringify(report, null, 2),
      );
      await driver.screenshot(new URL("sonos-contact.png", ARTIFACTS).pathname);

      // A sanity check that we actually reached Sonos and not a block
      // page. Inspect the JSON + screenshot in artifacts/ next, then
      // update selectors.ts from what you find.
      expect(report.title.length).toBeGreaterThan(0);
    },
    180_000,
  );
});
