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
export function installAudioPump(opts: {
  captureSampleRate?: number;
  captureWebRtc?: boolean;
  captureWebAudio?: boolean;
  captureMediaElement?: boolean;
}): void {
  const RealAudioContext = globalThis.AudioContext;
  const captureSinks = new Set();
  let lastSampleRate = opts.captureSampleRate ?? 48000;

  function broadcast(samples) {
    for (const sink of captureSinks) sink(samples);
  }

  // --- AudioWorklet processor source -------------------------------------
  // Batches 128-sample render quanta into 4096-sample chunks before
  // posting to the main thread — preserves the cadence of the previous
  // ScriptProcessor implementation while running on the audio thread,
  // immune to main-thread jank.

  const WORKLET_SOURCE = `
    class BatchingProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.batch = new Float32Array(4096);
        this.pos = 0;
      }
      process(inputs) {
        const samples = inputs[0] && inputs[0][0];
        if (!samples || !samples.length) return true;
        for (let i = 0; i < samples.length; i++) {
          this.batch[this.pos++] = samples[i];
          if (this.pos === this.batch.length) {
            this.port.postMessage(this.batch.slice());
            this.pos = 0;
          }
        }
        return true;
      }
    }
    registerProcessor("litmus-batching", BatchingProcessor);
  `;
  const workletUrl = URL.createObjectURL(
    new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
  );

  // --- Central capture route ----------------------------------------------

  let captureCtx;
  let captureMixer;
  let captureReady = null;

  function ensureCaptureRoute() {
    if (captureReady) return captureReady;
    captureCtx = opts.captureSampleRate
      ? new RealAudioContext({ sampleRate: opts.captureSampleRate })
      : new RealAudioContext();
    captureMixer = captureCtx.createGain();
    lastSampleRate = captureCtx.sampleRate;
    // Continuous silent baseline. Without this, the capture graph has
    // no input until something piped in via pipeStreamToCapture, so
    // the worklet produces nothing and downstream (e.g. Realtime VAD)
    // has no buffer to apply prefix-padding against when real audio
    // finally arrives. Mixing a zero-offset constant source is a no-op
    // for amplitude but keeps the graph flowing.
    const silence = captureCtx.createConstantSource();
    silence.offset.value = 0;
    silence.connect(captureMixer);
    silence.start();
    captureReady = captureCtx.audioWorklet.addModule(workletUrl).then(() => {
      const node = new AudioWorkletNode(captureCtx, "litmus-batching");
      node.port.onmessage = (e) => broadcast(e.data);
      captureMixer.connect(node);
      node.connect(captureCtx.destination);
    });
    return captureReady;
  }

  function pipeStreamToCapture(stream) {
    ensureCaptureRoute().then(() => {
      const source = captureCtx.createMediaStreamSource(stream);
      source.connect(captureMixer);
    });
  }

  // Original srcObject descriptor — both the RTC wrap and the
  // media-element wrap need to read/write the underlying property
  // without triggering each other.
  const realSrcObjectDesc = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "srcObject",
  );

  // --- RTCPeerConnection track tap ----------------------------------------
  // Chromium quirk: a remote WebRTC audio track only starts receiving
  // RTP packets once it's attached to an HTMLMediaElement. Attach to a
  // hidden muted element to activate delivery, then pipe the stream
  // into the capture mixer directly.

  const RealRTCPeerConnection = globalThis.RTCPeerConnection;
  if (opts.captureWebRtc && RealRTCPeerConnection) {
    globalThis.RTCPeerConnection = class extends RealRTCPeerConnection {
      constructor(...args) {
        super(...args);
        this.addEventListener("track", (event) => {
          if (!event.track || event.track.kind !== "audio") return;
          const stream = event.streams[0] ?? new MediaStream([event.track]);
          const activator = document.createElement("audio");
          activator.muted = true;
          realSrcObjectDesc.set.call(activator, stream);
          activator.play().catch(() => {});
          pipeStreamToCapture(stream);
        });
      }
    };
  }

  // --- HTMLMediaElement.srcObject tap -------------------------------------
  // Any MediaStream assigned to a media element's `srcObject` has its
  // audio tracks routed into the capture pipeline.

  if (opts.captureMediaElement) {
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
  }

  // --- AudioContext destination tap ---------------------------------------
  // Any page-created AudioContext gets its `destination` swapped for a
  // gain node that fans out to the real destination AND a capture sink.

  if (opts.captureWebAudio) {
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
  }

  // --- Microphone injection -----------------------------------------------

  let micCtx;
  let micDest;

  function installMicProbe(stream) {
    const probeCtx = new RealAudioContext();
    const source = probeCtx.createMediaStreamSource(stream);
    let peak = 0;
    let energy = 0;
    let processedSamples = 0;
    probeCtx.audioWorklet.addModule(workletUrl).then(() => {
      const node = new AudioWorkletNode(probeCtx, "litmus-batching");
      node.port.onmessage = (e) => {
        const data = e.data;
        for (let i = 0; i < data.length; i++) {
          const v = data[i];
          const abs = v < 0 ? -v : v;
          if (abs > peak) peak = abs;
          energy += v * v;
        }
        processedSamples += data.length;
      };
      source.connect(node);
      node.connect(probeCtx.destination);
    });
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

  const streams = new Map();
  let nextStreamId = 0;
  // Wall-clock-relative cursor (in micCtx.currentTime units) of the
  // next free moment in the playback queue. Each `send` schedules its
  // buffer to start here, then advances the cursor by the buffer's
  // duration — gap-free, no overlap. Resolving immediately (instead
  // of awaiting onended) means consumers can pipeline writes without
  // each call paying the chunk's playback duration as latency.
  let nextStart = 0;

  globalThis.__litmusAudio = {
    send(samples, sampleRate) {
      const { ctx, dest } = ensureMic();
      const buf = ctx.createBuffer(1, samples.length, sampleRate);
      buf.copyToChannel(new Float32Array(samples), 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(dest);
      const startAt = Math.max(ctx.currentTime, nextStart);
      src.start(startAt);
      nextStart = startAt + buf.duration;
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
    startStream() {
      ensureCaptureRoute();
      const id = ++nextStreamId;
      const buffer = [];
      const sink = (chunk) => {
        for (let i = 0; i < chunk.length; i++) buffer.push(chunk[i]);
      };
      captureSinks.add(sink);
      streams.set(id, { buffer, sink });
      return { id, sampleRate: lastSampleRate };
    },
    readStream(id) {
      const entry = streams.get(id);
      if (!entry) return { samples: [], sampleRate: lastSampleRate };
      const out = entry.buffer.splice(0, entry.buffer.length);
      return { samples: out, sampleRate: lastSampleRate };
    },
    stopStream(id) {
      const entry = streams.get(id);
      if (!entry) return;
      captureSinks.delete(entry.sink);
      streams.delete(id);
    },
  };
}
