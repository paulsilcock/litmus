import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { BaseBrowserDriver } from "#litmus-test/drivers/browser.ts";

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}.html`, import.meta.url)),
    "utf8",
  );

const app = new Hono()
  .get("/", (c) => c.html("<h1 id='greeting'>Hello, world</h1>"))
  .get("/audio-mic", (c) => c.html(fixture("audio-mic")))
  .get("/audio-speaker", (c) => c.html(fixture("audio-speaker")))
  .get("/audio-element", (c) => c.html(fixture("audio-element")))
  .get("/audio-webrtc", (c) => c.html(fixture("audio-webrtc")));

function sineWavePcm(
  frequencyHz: number,
  sampleRate: number,
  durationMs: number,
): number[] {
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000);
  return Array.from({ length: sampleCount }, (_, i) =>
    Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate),
  );
}

/** Estimate dominant frequency of a pure tone via zero-crossings. */
function detectFrequency(samples: number[], sampleRate: number): number {
  if (samples.length < 2) return 0;
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1] ?? 0;
    const curr = samples[i] ?? 0;
    if ((prev < 0 && curr >= 0) || (prev >= 0 && curr < 0)) crossings++;
  }
  return (crossings * sampleRate) / (2 * samples.length);
}

class TestDriver extends BaseBrowserDriver {
  async greeting() {
    await this.page.goto("/");
    return this.page.locator("#greeting").textContent();
  }

  async openMic() {
    await this.page.goto("/audio-mic");
  }

  async openSpeaker() {
    await this.page.goto("/audio-speaker");
  }

  async openMediaElement() {
    await this.page.goto("/audio-element");
  }

  async openWebRtc() {
    await this.page.goto("/audio-webrtc");
  }

  async sendTone(samples: number[], sampleRate: number) {
    await this.sendAudio(samples, sampleRate);
  }

  async captureTone(durationMs: number) {
    return this.captureAudio(durationMs);
  }

  async observedFrequency(): Promise<number> {
    return this.page.evaluate("globalThis.__observedFreq__ ?? 0");
  }

  getBrowserForTest() {
    return this.page.context().browser();
  }
}

describe("BaseBrowserDriver", () => {
  let server: ReturnType<typeof serve>;
  let baseUrl: string;
  let driver: TestDriver;

  beforeAll(async () => {
    server = serve({ fetch: app.fetch, port: 0 });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://localhost:${port}`;
    driver = new TestDriver({ baseUrl });
    await driver.init();
  });

  afterAll(async () => {
    await driver.cleanup();
    server.close();
  });

  it("subclasses can navigate and query the page", async () => {
    expect(await driver.greeting()).toBe("Hello, world");
  });

  it("audio sent to the page's mic is received by client code", async () => {
    const audioDriver = new TestDriver({ baseUrl, audio: true });
    await audioDriver.init();
    try {
      await audioDriver.openMic();
      const sampleRate = 48000;
      const pcm = sineWavePcm(440, sampleRate, 500);
      await audioDriver.sendTone(pcm, sampleRate);
      const observed = await audioDriver.observedFrequency();
      expect(observed).toBeGreaterThan(340);
      expect(observed).toBeLessThan(540);
    } finally {
      await audioDriver.cleanup();
    }
  });

  it("audio played by the page is captured by the test", async () => {
    const audioDriver = new TestDriver({ baseUrl, audio: true });
    await audioDriver.init();
    try {
      await audioDriver.openSpeaker();
      const { samples, sampleRate } = await audioDriver.captureTone(500);
      const observed = detectFrequency(samples, sampleRate);
      expect(observed).toBeGreaterThan(560);
      expect(observed).toBeLessThan(760);
    } finally {
      await audioDriver.cleanup();
    }
  });

  it("audio attached to a media element is captured by the test", async () => {
    const audioDriver = new TestDriver({ baseUrl, audio: true });
    await audioDriver.init();
    try {
      await audioDriver.openMediaElement();
      const { samples, sampleRate } = await audioDriver.captureTone(500);
      const observed = detectFrequency(samples, sampleRate);
      expect(observed).toBeGreaterThan(780);
      expect(observed).toBeLessThan(980);
    } finally {
      await audioDriver.cleanup();
    }
  });

  it("audio received via a peer connection is captured by the test", async () => {
    const audioDriver = new TestDriver({ baseUrl, audio: true });
    await audioDriver.init();
    try {
      await audioDriver.openWebRtc();
      await new Promise((r) => setTimeout(r, 3000));
      const { samples, sampleRate } = await audioDriver.captureTone(1000);
      const observed = detectFrequency(samples, sampleRate);
      expect(observed).toBeGreaterThan(1000);
      expect(observed).toBeLessThan(1200);
    } finally {
      await audioDriver.cleanup();
    }
  });

  it("cleanup closes the browser", async () => {
    const d = new TestDriver({ baseUrl: "http://localhost" });
    await d.init();

    const browser = d.getBrowserForTest();
    if (!browser) throw new Error("browser not initialised");
    const closeSpy = vi.spyOn(browser, "close");

    await d.cleanup();

    expect(closeSpy).toHaveBeenCalledOnce();
  });
});
