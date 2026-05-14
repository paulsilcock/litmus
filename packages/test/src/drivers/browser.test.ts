import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { BaseBrowserDriver } from "#litmus-test/drivers/browser.ts";

const app = new Hono()
  .get("/", (c) => c.html("<h1 id='greeting'>Hello, world</h1>"))
  .get("/audio-mic", (c) =>
    c.html(`<!DOCTYPE html>
<html><body><script>
  window.__observedFreq__ = 0;
  window.__observedPeak__ = 0;
  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    (function loop() {
      analyser.getByteFrequencyData(data);
      let maxMag = 0, maxIdx = 0;
      for (let i = 0; i < data.length; i++) {
        if (data[i] > maxMag) { maxMag = data[i]; maxIdx = i; }
      }
      if (maxMag > window.__observedPeak__) {
        window.__observedPeak__ = maxMag;
        window.__observedFreq__ = (maxIdx * ctx.sampleRate) / analyser.fftSize;
      }
      requestAnimationFrame(loop);
    })();
  });
</script></body></html>`),
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

class TestDriver extends BaseBrowserDriver {
  async greeting() {
    await this.page.goto("/");
    return this.page.locator("#greeting").textContent();
  }

  async openMic() {
    await this.page.goto("/audio-mic");
  }

  async sendTone(samples: number[], sampleRate: number) {
    await this.sendAudio(samples, sampleRate);
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
