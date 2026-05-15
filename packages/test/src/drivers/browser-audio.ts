// @ts-nocheck - this file runs inside the browser via Playwright's
// `addInitScript` and references DOM globals (AudioContext, navigator,
// MediaStream). The package's tsconfig only loads Node types — adding the
// DOM lib here would pollute the whole project's type space, so this file
// opts out of type-checking entirely. Runtime errors here surface as test
// failures, which is the right feedback loop for browser code.

/**
 * Runs inside the browser via `context.addInitScript` before any page
 * script executes. Sets up the driver-controlled audio I/O pipeline:
 *
 * - Overrides `navigator.mediaDevices.getUserMedia` for audio requests
 *   to return a synthetic `MediaStream` the test controls.
 * - Wraps `AudioContext` so each new instance taps audio destined for
 *   its `destination` into a central capture mixer.
 * - Wraps `HTMLMediaElement.srcObject` so any audio attached to a
 *   media element (MediaStream-backed players) is also tapped into
 *   the central capture mixer.
 * - Wraps `RTCPeerConnection` so any audio track received from a peer
 *   is tapped, attached to a hidden muted element to activate RTP
 *   delivery (Chromium quirk), and routed into the capture mixer.
 *
 * A single capture AudioContext mixes all hooks through one mixer and
 * one ScriptProcessor, so concurrent sources sum naturally and the
 * captured stream has a single consistent sample rate.
 *
 * Exposes `globalThis.__litmusAudio` with `send(samples, sampleRate)`
 * for pushing PCM into the mic and `capture(durationMs)` for collecting
 * recently-played samples.
 */
export function installAudioPump(): void {
  // esbuild's class-name helper. When `class extends X` (or other
  // name-preserving constructs) is transpiled by tsx/esbuild, references to
  // `__name(target, "X")` get inserted in the output. Playwright serialises
  // this function via `.toString()` and injects it as a string into the page
  // — the helper itself doesn't come along, so the references fail with
  // "__name is not defined" inside the browser. Assign a no-op shim onto
  // `globalThis` so any references resolve harmlessly (`class.name` is
  // cosmetic for our purposes).
  if (typeof globalThis.__name !== "function") {
    globalThis.__name = (target) => target;
  }

  const captureSinks = new Set();
  const tappedTrackIds = new Set();
  let lastSampleRate = 48000;

  const RealAudioContext = globalThis.AudioContext;
  const realSrcObjectDesc = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "srcObject",
  );

  function broadcast(samples) {
    for (const sink of captureSinks) sink(samples);
  }

  // --- Central capture route -----------------------------------------------

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

  function tapTrack(track) {
    if (tappedTrackIds.has(track.id)) return;
    tappedTrackIds.add(track.id);
    pipeStreamToCapture(new MediaStream([track]));
  }

  // --- Microphone injection -------------------------------------------------

  let micCtx;
  let micDest;
  // Cumulative end-time of the last scheduled mic buffer. Each
  // `send()` schedules its buffer at `max(currentTime, micNextStartAt)`
  // and advances this by the buffer's duration — guaranteeing chunks
  // abut seamlessly. Without this, sequential `start()` calls have
  // tiny event-loop gaps which fragment STT in consuming widgets.
  let micNextStartAt = 0;

  function ensureMic() {
    if (!micCtx) {
      micCtx = new RealAudioContext();
      micDest = micCtx.createMediaStreamDestination();
      if (typeof micCtx.resume === "function") {
        micCtx.resume().catch(() => {});
      }
      // Consumers of the mic stream sometimes call `track.stop()` as
      // part of their setup or teardown — convai-widget-embed does
      // this. An "ended" MediaStreamTrack produces silence permanently
      // regardless of what we write into its source, breaking all
      // subsequent injection. Replace `stop()` with a no-op on our
      // synthetic tracks so consumers can't kill them.
      for (const track of micDest.stream.getTracks()) {
        track.stop = () => {};
      }
      installMicProbe(micDest.stream);
    }
    return { ctx: micCtx, dest: micDest };
  }

  // Diagnostic probe: taps the same stream getUserMedia consumers see and
  // reports peak/RMS for what's flowing through it. Lets tests verify
  // "did our sendAudio actually reach the consumer's mic" without relying
  // on the consumer's behaviour. Exposed at `globalThis.__litmusMicProbe`.
  function installMicProbe(stream) {
    const probeCtx = new RealAudioContext();
    if (typeof probeCtx.resume === "function") {
      probeCtx.resume().catch(() => {});
    }
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
        const track = stream.getAudioTracks()[0];
        return {
          peak,
          rms,
          samples: processedSamples,
          micCtxState: micCtx ? micCtx.state : "(no ctx)",
          probeCtxState: probeCtx.state,
          trackEnabled: track ? track.enabled : null,
          trackMuted: track ? track.muted : null,
          trackReadyState: track ? track.readyState : null,
          trackSettings:
            track && track.getSettings ? track.getSettings() : null,
        };
      },
      reset() {
        peak = 0;
        energy = 0;
        processedSamples = 0;
      },
    };
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

  // --- AudioContext destination tap ----------------------------------------

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

  // --- RTCPeerConnection track tap -----------------------------------------
  //
  // Chromium quirk: a remote WebRTC audio track only starts receiving RTP
  // packets once it's attached to an HTMLMediaElement. MediaStreamSource
  // alone doesn't activate the receiver. We attach to a hidden muted element
  // to pull data, bypassing our own srcObject hook with the raw setter.

  const RealRTCPeerConnection = globalThis.RTCPeerConnection;
  if (RealRTCPeerConnection) {
    globalThis.RTCPeerConnection = class extends RealRTCPeerConnection {
      constructor(...args) {
        super(...args);
        this.addEventListener("track", (event) => {
          if (!event.track || event.track.kind !== "audio") return;
          const activator = document.createElement("audio");
          const activatorStream =
            event.streams[0] ?? new MediaStream([event.track]);
          realSrcObjectDesc.set.call(activator, activatorStream);
          activator.muted = true;
          activator.play().catch(() => {});
          tapTrack(event.track);
        });
      }
    };
  }

  // --- HTMLMediaElement.srcObject tap --------------------------------------

  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
    configurable: true,
    get() {
      return realSrcObjectDesc.get.call(this);
    },
    set(value) {
      if (value instanceof MediaStream) {
        for (const track of value.getAudioTracks()) tapTrack(track);
      }
      realSrcObjectDesc.set.call(this, value);
    },
  });

  // --- Streaming capture state --------------------------------------------
  // Per-driver registry of open streams keyed by an id. `startStream`
  // installs a sink that pushes into a rolling buffer; `readStream`
  // drains the buffer and returns samples accumulated since the last
  // read. `stopStream` removes the sink and drains a final time.

  const streams = new Map();
  let nextStreamId = 0;

  // --- Public API ----------------------------------------------------------

  globalThis.__litmusAudio = {
    send(samples, sampleRate) {
      const { ctx, dest } = ensureMic();
      const buf = ctx.createBuffer(1, samples.length, sampleRate);
      buf.copyToChannel(new Float32Array(samples), 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(dest);
      const startAt = Math.max(ctx.currentTime, micNextStartAt);
      const duration = samples.length / sampleRate;
      micNextStartAt = startAt + duration;
      return new Promise((resolve) => {
        src.onended = () => resolve();
        src.start(startAt);
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
    startStream() {
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
      if (!entry) return { samples: [], sampleRate: lastSampleRate };
      captureSinks.delete(entry.sink);
      const out = entry.buffer.splice(0, entry.buffer.length);
      streams.delete(id);
      return { samples: out, sampleRate: lastSampleRate };
    },
  };
}
