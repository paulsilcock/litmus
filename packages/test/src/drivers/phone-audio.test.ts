import { describe, expect, it } from "vite-plus/test";

import {
  decodeMulaw,
  encodeMulaw,
  resample,
} from "#litmus-test/drivers/phone-audio.ts";

function bytes(...values: number[]): string {
  return Buffer.from(values).toString("base64");
}

describe("phone audio", () => {
  it("decodes μ-law to the standard's values", () => {
    // 0xFF is silence; 0x80 and 0x00 are the loudest positive and negative.
    expect(decodeMulaw(bytes(0xff, 0x80, 0x00))).toEqual([
      0,
      32_124 / 32_768,
      -32_124 / 32_768,
    ]);
  });

  it("encodes to the standard's values", () => {
    expect(encodeMulaw([0, 1, -1])).toBe(bytes(0xff, 0x80, 0x00));
  });

  it("speech survives a round trip through the phone format", () => {
    const speech = [0.1, -0.3, 0.6, -0.05];

    const roundTrip = decodeMulaw(encodeMulaw(speech));

    roundTrip.forEach((sample, i) => {
      expect(sample).toBeCloseTo(speech[i] ?? 0, 1);
    });
  });

  it("raises the rate by filling in between samples", () => {
    expect(resample([0, 0.75], 8_000, 24_000)).toEqual([
      0, 0.25, 0.5, 0.75, 0.75, 0.75,
    ]);
  });

  it("lowers the rate by averaging", () => {
    expect(resample([0.25, 0.5, 0.75, 0, 0, 0], 24_000, 8_000)).toEqual([
      0.5, 0,
    ]);
  });

  it("refuses rates that aren't whole multiples of each other", () => {
    expect(() => resample([0], 44_100, 8_000)).toThrow(
      "Can't convert audio from 44100Hz to 8000Hz",
    );
  });
});
