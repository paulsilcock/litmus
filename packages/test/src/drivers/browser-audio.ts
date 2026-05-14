// @ts-nocheck - this file runs inside the browser via Playwright's
// `addInitScript` and references DOM globals (AudioContext, navigator,
// MediaStream). The package's tsconfig only loads Node types — adding the
// DOM lib here would pollute the whole project's type space, so this file
// opts out of type-checking entirely. Runtime errors here surface as test
// failures, which is the right feedback loop for browser code.

/**
 * Runs inside the browser via `context.addInitScript` before any page
 * script executes. Overrides `navigator.mediaDevices.getUserMedia` for
 * audio requests to return a synthetic `MediaStream` the test controls,
 * and exposes `globalThis.__litmusAudio` for pumping PCM into it.
 */
export function installAudioPump(): void {
  let ctx;
  let dest;

  function ensure() {
    if (!ctx) {
      ctx = new AudioContext();
      dest = ctx.createMediaStreamDestination();
    }
    return { ctx, dest };
  }

  const realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices,
  );
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    if (!constraints?.audio) {
      return realGetUserMedia(constraints);
    }
    return ensure().dest.stream;
  };

  globalThis.__litmusAudio = {
    send(samples, sampleRate) {
      const { ctx, dest } = ensure();
      const buf = ctx.createBuffer(1, samples.length, sampleRate);
      buf.copyToChannel(new Float32Array(samples), 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(dest);
      return new Promise((resolve) => {
        src.onended = () => resolve();
        src.start();
      });
    },
  };
}
