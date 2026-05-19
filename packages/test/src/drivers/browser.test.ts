import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import {
  type AudioStream,
  BrowserDriver,
} from "#litmus-test/drivers/browser.ts";

/**
 * Minimum sample count for the zero-crossing FFT-ish frequency
 * estimator to land within ~1.5% of the true tone frequency at 48kHz.
 * 4096 samples ≈ 85ms of audio.
 */
const MIN_SAMPLES_FOR_FFT = 4096;

/** Minimum sample magnitude treated as "signal" rather than silence. */
const SIGNAL_PEAK_THRESHOLD = 0.01;

/**
 * Drain `stream` until at least `minSamples` samples of *non-silent*
 * audio have been accumulated, then return them together. Skips any
 * silent prefix so callers (e.g. tests waiting on an RTC handshake)
 * get a clean window of real audio to assert against — no need to
 * pad with arbitrary sleeps.
 *
 * Polls with a small backoff and gives up after `timeoutMs`.
 */
async function readAtLeast(
  stream: AudioStream,
  minSamples: number,
  timeoutMs = 15_000,
): Promise<{ samples: number[]; sampleRate: number }> {
  const start = Date.now();
  let collecting = false;
  const accumulated: number[] = [];
  let sampleRate = 0;
  while (true) {
    const chunk = await stream.read();
    if (chunk.sampleRate > 0) sampleRate = chunk.sampleRate;
    if (!collecting && chunkHasSignal(chunk.samples)) {
      collecting = true;
    }
    if (collecting) {
      accumulated.push(...chunk.samples);
      if (accumulated.length >= minSamples) {
        return { samples: accumulated, sampleRate };
      }
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        collecting
          ? `readAtLeast: only ${accumulated.length}/${minSamples} samples after signal began (${timeoutMs}ms)`
          : `readAtLeast: no signal above ${SIGNAL_PEAK_THRESHOLD} after ${timeoutMs}ms`,
      );
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

function chunkHasSignal(samples: readonly number[]): boolean {
  for (const s of samples) {
    if (Math.abs(s) > SIGNAL_PEAK_THRESHOLD) return true;
  }
  return false;
}

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}.html`, import.meta.url)),
    "utf8",
  );

const app = new Hono()
  .get("/", (c) => c.html(""))
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

class TestDriver extends BrowserDriver {
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
    return this.page.evaluate(`(() => {
      if (!globalThis.__litmusMicProbe) {
        throw new Error("micProbe not installed — was the driver constructed with audio: true?");
      }
      return globalThis.__litmusMicProbe.snapshot();
    })()`);
  }

  async micProbeReset(): Promise<void> {
    await this.page.evaluate(`(() => {
      if (!globalThis.__litmusMicProbe) {
        throw new Error("micProbe not installed — was the driver constructed with audio: true?");
      }
      globalThis.__litmusMicProbe.reset();
    })()`);
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
}

describe("BrowserDriver", () => {
  let baseUrl: string;

  beforeAll(() => {
    const server = serve({ fetch: app.fetch, port: 0 });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://localhost:${port}`;
    return () => {
      server.close();
    };
  });

  it("the page reports the configured userAgent via both navigator.userAgent and navigator.userAgentData", async () => {
    // Many sites detect Chrome via `navigator.userAgentData.brands`
    // rather than parsing the UA string. Playwright's `userAgent`
    // option only sets the UA string + HTTP header — it does NOT
    // touch userAgentData. The driver must keep both consistent or
    // sites that read userAgentData will see the underlying engine
    // (Chromium) and refuse to render their Chrome-only paths.
    await using d = new TestDriver({
      baseUrl,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/131.0.0.0 Safari/537.36",
    });
    await d.init();
    const reported = await d.navigatorIdentity();
    expect(reported.userAgent).toContain("Chrome/131");
    expect(reported.brands).toContain("Google Chrome");
  });

  it("audio sent to the page's mic is received by client code", async () => {
    await using audioDriver = new TestDriver({ baseUrl, audio: true });
    await audioDriver.init();
    await audioDriver.openMic();
    const sampleRate = 48000;
    const pcm = sineWavePcm(440, sampleRate, 500);
    await audioDriver.sendTone(pcm, sampleRate);
    const observed = await audioDriver.observedFrequency();
    expect(observed).toBeGreaterThan(340);
    expect(observed).toBeLessThan(540);
  });

  it("audio injection survives a consumer calling track.stop() on the mic track", async () => {
    // Some consumers (notably @elevenlabs/convai-widget-embed) call
    // `track.stop()` on the mic track during setup. A stopped track is
    // terminal — it produces silence permanently and breaks all
    // subsequent injection. The driver must guarantee its synthetic
    // tracks survive this.
    await using audioDriver = new TestDriver({ baseUrl, audio: true });
    await audioDriver.init();
    await audioDriver.openMicStopsTrack();
    await audioDriver.micProbeReset();

    const sampleRate = 48000;
    const pcm = sineWavePcm(440, sampleRate, 500);
    await audioDriver.sendTone(pcm, sampleRate);

    // The probe sees whatever the consumer would see on the mic
    // stream. If `track.stop()` had killed the track, peak would
    // stay at 0 indefinitely.
    await expect
      .poll(() => audioDriver.micProbeSnapshot().then((p) => p.peak), {
        timeout: 3000,
      })
      .toBeGreaterThan(0.5);
  });

  it("audio played by the page is captured by the test", async () => {
    await using audioDriver = new TestDriver({ baseUrl, audio: true });
    await audioDriver.init();
    await audioDriver.openSpeaker();
    const { samples, sampleRate } = await audioDriver.captureTone(500);
    const observed = detectFrequency(samples, sampleRate);
    expect(observed).toBeGreaterThan(560);
    expect(observed).toBeLessThan(760);
  });

  it("audio attached to a media element is captured by the test", async () => {
    await using audioDriver = new TestDriver({ baseUrl, audio: true });
    await audioDriver.init();
    await audioDriver.openMediaElement();
    const { samples, sampleRate } = await audioDriver.captureTone(500);
    const observed = detectFrequency(samples, sampleRate);
    expect(observed).toBeGreaterThan(780);
    expect(observed).toBeLessThan(980);
  });

  it("audio received via a peer connection is captured by the test", async () => {
    await using audioDriver = new TestDriver({ baseUrl, audio: true });
    await audioDriver.init();
    await audioDriver.openWebRtc();

    // The fixture's RTC handshake takes a variable amount of time
    // before audio actually starts flowing. Open the capture stream
    // and drain until we've got a meaningful FFT window, rather
    // than guessing a fixed wait.
    const stream = await audioDriver.captureToneStream();
    try {
      const { samples, sampleRate } = await readAtLeast(
        stream,
        MIN_SAMPLES_FOR_FFT,
      );
      const observed = detectFrequency(samples, sampleRate);
      expect(observed).toBeGreaterThan(1000);
      expect(observed).toBeLessThan(1200);
    } finally {
      await stream.close();
    }
  });

  it("audio played by the page can be drained progressively while it's still playing", async () => {
    // Voice-agent scenarios need to read what the agent has said so
    // far without waiting for it to stop. A stream handle should
    // return samples accumulated since the last read, not block on a
    // fixed duration.
    await using audioDriver = new TestDriver({ baseUrl, audio: true });
    await audioDriver.init();
    await audioDriver.openSpeaker();
    const stream = await audioDriver.captureToneStream();
    try {
      const first = await readAtLeast(stream, MIN_SAMPLES_FOR_FFT);
      const second = await readAtLeast(stream, MIN_SAMPLES_FOR_FFT);

      // Each read drained a meaningful window. If reads returned
      // nothing once the buffer was drained — or if the stream
      // re-served the first window's samples on the second read —
      // we wouldn't get two independent windows that each contain
      // the playing tone.
      const observed = detectFrequency(second.samples, second.sampleRate);
      expect(first.samples.length).toBeGreaterThanOrEqual(MIN_SAMPLES_FOR_FFT);
      expect(second.samples.length).toBeGreaterThanOrEqual(MIN_SAMPLES_FOR_FFT);
      expect(observed).toBeGreaterThan(560);
      expect(observed).toBeLessThan(760);
    } finally {
      await stream.close();
    }
  });
});
