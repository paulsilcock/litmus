/** Phone audio's sample rate: Twilio streams calls as 8kHz G.711 μ-law. */
export const PHONE_SAMPLE_RATE = 8_000;

/** Decodes base64 G.711 μ-law into float samples (-1..1). */
export function decodeMulaw(base64: string): number[] {
  return [...Buffer.from(base64, "base64")].map((byte) => {
    const value = ~byte & 0xff;
    const exponent = (value >> 4) & 0x07;
    const magnitude = ((((value & 0x0f) << 3) + 0x84) << exponent) - 0x84;
    return ((value & 0x80) !== 0 ? -magnitude : magnitude) / 32_768;
  });
}

/** Encodes float samples (-1..1) as base64 G.711 μ-law. */
export function encodeMulaw(samples: readonly number[]): string {
  const bytes = samples.map((sample) => {
    let value = Math.max(
      -32_768,
      Math.min(32_767, Math.round(sample * 32_768)),
    );
    const sign = value < 0 ? 0x80 : 0;
    value = Math.min(Math.abs(value), 32_635) + 0x84;
    let exponent = 7;
    for (let mask = 0x4000; (value & mask) === 0 && exponent > 0; mask >>= 1) {
      exponent--;
    }
    const mantissa = (value >> (exponent + 3)) & 0x0f;
    return ~(sign | (exponent << 4) | mantissa) & 0xff;
  });
  return Buffer.from(bytes).toString("base64");
}

/**
 * Converts samples between rates that are whole multiples of each other:
 * averaging when going down, interpolating when going up. Plenty for
 * speech, which a phone line limits to 4kHz anyway.
 */
export function resample(
  samples: readonly number[],
  from: number,
  to: number,
): number[] {
  if (from === to) return [...samples];
  const ratio = from > to ? from / to : to / from;
  if (!Number.isInteger(ratio)) {
    throw new Error(
      `Can't convert audio from ${from}Hz to ${to}Hz: one must be a whole multiple of the other.`,
    );
  }
  const out: number[] = [];
  if (from > to) {
    for (let i = 0; i + ratio <= samples.length; i += ratio) {
      let sum = 0;
      for (let j = 0; j < ratio; j++) sum += samples[i + j] ?? 0;
      out.push(sum / ratio);
    }
    return out;
  }
  samples.forEach((sample, i) => {
    const next = samples[i + 1] ?? sample;
    for (let j = 0; j < ratio; j++) {
      out.push(sample + ((next - sample) * j) / ratio);
    }
  });
  return out;
}
