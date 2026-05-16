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
  .get("/audio-webrtc", (c) => c.html(fixture("audio-webrtc")))
  .get("/audio-mic-stops-track", (c) =>
    c.html(fixture("audio-mic-stops-track")),
  );

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

  async navigatorIdentity(): Promise<{
    userAgent: string;
    brands: string[];
  }> {
    await this.page.goto("/");
    return this.page.evaluate(
      `(() => {
        const uad = navigator.userAgentData;
        return {
          userAgent: navigator.userAgent,
          brands: uad ? uad.brands.map((b) => b.brand) : [],
        };
      })()`,
    );
  }

  async openMicStopsTrack() {
    await this.page.goto("/audio-mic-stops-track");
    await this.page.waitForFunction("globalThis.__readyForAudio__ === true", {
      timeout: 5000,
    });
  }

  async micProbeSnapshot(): Promise<{
    peak: number;
    rms: number;
    samples: number;
  }> {
    return this.page.evaluate(
      "globalThis.__litmusMicProbe ? globalThis.__litmusMicProbe.snapshot() : { peak: 0, rms: 0, samples: 0 }",
    );
  }

  async micProbeReset(): Promise<void> {
    await this.page.evaluate("globalThis.__litmusMicProbe?.reset()");
  }

  async sendTone(samples: number[], sampleRate: number) {
    await this.sendAudio(samples, sampleRate);
  }

  async captureTone(durationMs: number) {
    return this.captureAudio(durationMs);
  }

  async captureToneStream() {
    return this.captureAudioStream();
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

  it("the page reports the configured userAgent via both navigator.userAgent and navigator.userAgentData", async () => {
    // Many sites detect Chrome via `navigator.userAgentData.brands`
    // rather than parsing the UA string. Playwright's `userAgent`
    // option only sets the UA string + HTTP header — it does NOT
    // touch userAgentData. The driver must keep both consistent or
    // sites that read userAgentData will see the underlying engine
    // (Chromium) and refuse to render their Chrome-only paths.
    const d = new TestDriver({
      baseUrl,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/131.0.0.0 Safari/537.36",
    });
    await d.init();
    try {
      const reported = await d.navigatorIdentity();
      expect(reported.userAgent).toContain("Chrome/131");
      expect(reported.brands).toContain("Google Chrome");
    } finally {
      await d.cleanup();
    }
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

  it("audio injection survives a consumer calling track.stop() on the mic track", async () => {
    // Some consumers (notably @elevenlabs/convai-widget-embed) call
    // `track.stop()` on the mic track during setup. A stopped track is
    // terminal — it produces silence permanently and breaks all
    // subsequent injection. The driver must guarantee its synthetic
    // tracks survive this.
    const audioDriver = new TestDriver({ baseUrl, audio: true });
    await audioDriver.init();
    try {
      await audioDriver.openMicStopsTrack();
      await audioDriver.micProbeReset();

      const sampleRate = 48000;
      const pcm = sineWavePcm(440, sampleRate, 500);
      await audioDriver.sendTone(pcm, sampleRate);
      await new Promise((r) => setTimeout(r, 200));

      const probe = await audioDriver.micProbeSnapshot();
      expect(probe.peak).toBeGreaterThan(0.5);
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

  it("audio played by the page can be drained progressively while it's still playing", async () => {
    // Voice-agent scenarios need to read what the agent has said so
    // far without waiting for it to stop. A stream handle should
    // return samples accumulated since the last read, not block on a
    // fixed duration.
    const audioDriver = new TestDriver({ baseUrl, audio: true });
    await audioDriver.init();
    try {
      await audioDriver.openSpeaker();
      const stream = await audioDriver.captureToneStream();
      try {
        await new Promise((r) => setTimeout(r, 300));
        const first = await stream.read();
        await new Promise((r) => setTimeout(r, 300));
        const second = await stream.read();

        expect(first.samples.length).toBeGreaterThan(0);
        expect(second.samples.length).toBeGreaterThan(0);
        // Second read must not re-include samples from the first.
        const overlap = first.samples.length + second.samples.length;
        expect(overlap).toBeGreaterThan(first.samples.length);

        const observed = detectFrequency(second.samples, second.sampleRate);
        expect(observed).toBeGreaterThan(560);
        expect(observed).toBeLessThan(760);
      } finally {
        await stream.close();
      }
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
