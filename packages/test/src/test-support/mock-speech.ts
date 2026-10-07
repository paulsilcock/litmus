/**
 * Mock speech: words written straight into the audio samples, so fakes on
 * either side of a conversation can understand each other. It's the right
 * shape, not real speech. Each utterance ends with a marker standing in
 * for the pause a real listener would hear.
 *
 * Samples are character codes / 32768, which 16-bit PCM carries exactly.
 */
const PCM16_SCALE = 32_768;
const END_OF_UTTERANCE = 3;
const SAMPLES_PER_CHUNK = 8;

/** Speaks the words as mock speech, in small chunks the way speech streams. */
export function mockSpeech(words: string): number[][] {
  const codes = Array.from({ length: words.length }, (_, i) =>
    words.charCodeAt(i),
  );
  const samples = [...codes, END_OF_UTTERANCE].map(
    (code) => code / PCM16_SCALE,
  );
  const chunks: number[][] = [];
  for (let i = 0; i < samples.length; i += SAMPLES_PER_CHUNK) {
    chunks.push(samples.slice(i, i + SAMPLES_PER_CHUNK));
  }
  return chunks;
}

/** Listens to mock speech chunk by chunk, recognising complete utterances. */
export class MockSpeechListener {
  #heard: number[] = [];

  /** Returns any utterances completed by these samples. Silence is ignored. */
  hear(samples: readonly number[]): string[] {
    const utterances: string[] = [];
    for (const sample of samples) {
      const code = Math.round(sample * PCM16_SCALE);
      if (code === 0) continue;
      if (code === END_OF_UTTERANCE) {
        utterances.push(String.fromCharCode(...this.#heard));
        this.#heard = [];
      } else {
        this.#heard.push(code);
      }
    }
    return utterances;
  }
}
