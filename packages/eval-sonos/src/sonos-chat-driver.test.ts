import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { SonosChatDriver } from "#sonos/sonos-chat-driver.ts";

const chatFixture = readFileSync(
  fileURLToPath(new URL("./fixtures/chat.html", import.meta.url)),
  "utf8",
);

const app = new Hono().get("/contact", (c) => c.html(chatFixture));

/**
 * Exercises the driver against a local stand-in for a hosted chat widget
 * (see fixtures/chat.html). These cover the mechanics that are
 * independent of Sonos's actual markup — opening, reading a streamed
 * greeting, sending, and reading a streamed reply — so the driver's
 * control flow has coverage even when the live selectors drift.
 *
 * Requires a Chromium binary (`vp dlx playwright install --with-deps
 * chromium`). They do not hit the network.
 */
describe("SonosChatDriver against a fake chat widget", () => {
  let baseUrl: string;
  let close: () => void;

  beforeAll(() => {
    const server = serve({ fetch: app.fetch, port: 0 });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://localhost:${port}`;
    close = () => server.close();
  });

  afterAll(() => close());

  function driver(): SonosChatDriver {
    return new SonosChatDriver({
      baseUrl,
      contactPath: "/contact",
      chatFrameCss: null,
    });
  }

  it("reads the agent's opening greeting after opening the chat", async () => {
    await using chat = driver();
    await chat.init();
    await chat.openChat();

    expect(await chat.awaitGreeting()).toContain("How can I help");
  });

  it("returns the agent's reply to a customer message", async () => {
    await using chat = driver();
    await chat.init();
    await chat.openChat();
    await chat.awaitGreeting();

    const reply = await chat.send("Will a Play:5 work with my Arc?");

    expect(reply).toBe("You said: Will a Play:5 work with my Arc?");
  });
});
