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

  function ensureMic() {
    if (!micCtx) {
      micCtx = new RealAudioContext();
      micDest = micCtx.createMediaStreamDestination();
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

  // --- Public API ----------------------------------------------------------

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
