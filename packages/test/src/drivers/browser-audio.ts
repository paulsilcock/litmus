// @ts-nocheck - this file is serialised via toString() and injected into
// the browser by Playwright's addInitScript. It references DOM globals
// (AudioContext, navigator, MediaStream) that the package's Node-only
// tsconfig deliberately doesn't load.

/**
 * Installs the driver-controlled audio I/O pipeline into the page:
 *
 * - Overrides `navigator.mediaDevices.getUserMedia` for audio requests
 *   to return a synthetic `MediaStream` the test controls.
 * - Wraps `AudioContext` so each new instance taps audio destined for
 *   its `destination` into a central capture mixer.
 *
 * Exposes:
 * - `globalThis.__litmusAudio.send(samples, sampleRate)` to push PCM
 *   into the synthetic mic.
 * - `globalThis.__litmusAudio.capture(durationMs)` to collect samples
 *   that flowed through the captured outputs over a time window.
 * - `globalThis.__litmusMicProbe` for peak/RMS observation of the mic
 *   stream (test-only diagnostic).
 *
 * Helpers are nested because the function body is serialised via
 * `toString()` and injected into the page — any module-scope helpers
 * wouldn't come along.
 */
export function installAudioPump(): void {
  const RealAudioContext = globalThis.AudioContext;
  const captureSinks = new Set();
  let lastSampleRate = 48000;

  function broadcast(samples) {
    for (const sink of captureSinks) sink(samples);
  }

  // --- Central capture route ----------------------------------------------

  let captureCtx;
  let captureMixer;

  function ensureCaptureRoute() {
    if (captureCtx) return;
    captureCtx = new RealAudioContext();
    captureMixer = captureCtx.createGain();
    const sp = captureCtx.createScriptProcessor(4096, 1, 1);
    captureMixer.connect(sp);
    sp.connect(captureCtx.destination);
    sp.onaudioprocess = (event) => {
      const inData = event.inputBuffer.getChannelData(0);
      const outData = event.outputBuffer.getChannelData(0);
      outData.fill(0);
      broadcast(inData);
    };
    lastSampleRate = captureCtx.sampleRate;
  }

  function pipeStreamToCapture(stream) {
    ensureCaptureRoute();
    const source = captureCtx.createMediaStreamSource(stream);
    source.connect(captureMixer);
  }

  // --- RTCPeerConnection track tap ----------------------------------------
  // Chromium quirk: a remote WebRTC audio track only starts receiving
  // RTP packets once it's attached to an HTMLMediaElement. Attach to a
  // hidden muted element to activate delivery; the srcObject hook
  // below routes the audio into the capture pipeline.

  const RealRTCPeerConnection = globalThis.RTCPeerConnection;
  if (RealRTCPeerConnection) {
    globalThis.RTCPeerConnection = class extends RealRTCPeerConnection {
      constructor(...args) {
        super(...args);
        this.addEventListener("track", (event) => {
          if (!event.track || event.track.kind !== "audio") return;
          const activator = document.createElement("audio");
          activator.srcObject =
            event.streams[0] ?? new MediaStream([event.track]);
          activator.muted = true;
          activator.play().catch(() => {});
        });
      }
    };
  }

  // --- HTMLMediaElement.srcObject tap -------------------------------------
  // Any MediaStream assigned to a media element's `srcObject` has its
  // audio tracks routed into the capture pipeline.

  const realSrcObjectDesc = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "srcObject",
  );
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
    configurable: true,
    get() {
      return realSrcObjectDesc.get.call(this);
    },
    set(value) {
      if (value instanceof MediaStream) {
        for (const track of value.getAudioTracks()) {
          pipeStreamToCapture(new MediaStream([track]));
        }
      }
      realSrcObjectDesc.set.call(this, value);
    },
  });

  // --- AudioContext destination tap ---------------------------------------
  // Any page-created AudioContext gets its `destination` swapped for a
  // gain node that fans out to the real destination AND a capture sink.

  globalThis.AudioContext = class extends RealAudioContext {
    constructor(...args) {
      super(...args);
      const realDest = this.destination;
      const tap = this.createGain();
      tap.connect(realDest);
      const streamDest = this.createMediaStreamDestination();
      tap.connect(streamDest);
      pipeStreamToCapture(streamDest.stream);
      Object.defineProperty(this, "destination", {
        value: tap,
        configurable: true,
      });
    }
  };

  // --- Microphone injection -----------------------------------------------

  let micCtx;
  let micDest;

  function installMicProbe(stream) {
    const probeCtx = new RealAudioContext();
    const source = probeCtx.createMediaStreamSource(stream);
    const sp = probeCtx.createScriptProcessor(2048, 1, 1);
    source.connect(sp);
    sp.connect(probeCtx.destination);
    let peak = 0;
    let energy = 0;
    let processedSamples = 0;
    sp.onaudioprocess = (event) => {
      const data = event.inputBuffer.getChannelData(0);
      const out = event.outputBuffer.getChannelData(0);
      out.fill(0);
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        const abs = v < 0 ? -v : v;
        if (abs > peak) peak = abs;
        energy += v * v;
      }
      processedSamples += data.length;
    };
    globalThis.__litmusMicProbe = {
      snapshot() {
        const rms =
          processedSamples > 0 ? Math.sqrt(energy / processedSamples) : 0;
        return { peak, rms, samples: processedSamples };
      },
      reset() {
        peak = 0;
        energy = 0;
        processedSamples = 0;
      },
    };
  }

  function ensureMic() {
    if (!micCtx) {
      micCtx = new RealAudioContext();
      micDest = micCtx.createMediaStreamDestination();
      // Consumers (notably @elevenlabs/convai-widget-embed) sometimes
      // call `track.stop()` on the mic track during setup. A stopped
      // track is terminal — it produces silence permanently regardless
      // of what we feed its source. Replace `stop` with a no-op on our
      // synthetic tracks so consumers can't kill them.
      for (const track of micDest.stream.getTracks()) {
        track.stop = () => {};
      }
      installMicProbe(micDest.stream);
    }
    return { ctx: micCtx, dest: micDest };
  }

  const realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices,
  );
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    if (!constraints?.audio) {
      return realGetUserMedia(constraints);
    }
    return ensureMic().dest.stream;
  };

  // --- Public API ---------------------------------------------------------

  globalThis.__litmusAudio = {
    send(samples, sampleRate) {
      const { ctx, dest } = ensureMic();
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
    capture(durationMs) {
      const collected = [];
      const sink = (chunk) => {
        for (let i = 0; i < chunk.length; i++) collected.push(chunk[i]);
      };
      captureSinks.add(sink);
      return new Promise((resolve) => {
        setTimeout(() => {
          captureSinks.delete(sink);
          resolve({ samples: collected, sampleRate: lastSampleRate });
        }, durationMs);
      });
    },
  };
}
