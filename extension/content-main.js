// VCClient Virtual Mic - MAIN world script.
// Patches getUserMedia/enumerateDevices so sites receive VCClient-converted audio
// as their "microphone". Audio is relayed to the local VCClient server through the
// isolated-world bridge (content-bridge.js) via window.postMessage.
(() => {
  if (window.__vcclientVirtualMicInstalled) return;
  window.__vcclientVirtualMicInstalled = true;

  const VIRTUAL_DEVICE_ID = "vcclient-virtual-mic";
  const VIRTUAL_LABEL = "VCClient Virtual Mic";
  const SERVER_RATE = 48000; // VCClient default input/output sample rate
  const CHUNK_SIZE = 4096; // ScriptProcessor buffer; ~85ms @48k

  const state = {
    enabled: false,
    bridgeReady: false,
    activeSessions: 0,
  };

  let reqSeq = 0;
  const pendingBySeq = new Map(); // seq -> session

  // ---- messaging with the isolated-world bridge ----
  window.addEventListener("message", (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__vcclient !== true) return;
    const d = ev.data;
    if (d.type === "VC_CONFIG") {
      state.enabled = !!d.enabled;
      state.bridgeReady = true;
    } else if (d.type === "VC_AUDIO_RES") {
      const session = pendingBySeq.get(d.seq);
      pendingBySeq.delete(d.seq);
      if (session && d.buf) session.onConverted(new Int16Array(d.buf));
    }
  });
  window.postMessage({ __vcclient: true, type: "VC_MAIN_READY" }, "*");

  // ---- resampling helpers (linear; cheap and good enough for speech) ----
  function resample(f32, fromRate, toRate) {
    if (fromRate === toRate) return f32;
    const outLen = Math.round((f32.length * toRate) / fromRate);
    const out = new Float32Array(outLen);
    const ratio = (f32.length - 1) / Math.max(1, outLen - 1);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, f32.length - 1);
      out[i] = f32[i0] + (f32[i1] - f32[i0]) * (pos - i0);
    }
    return out;
  }

  function floatToInt16(f32) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  function int16ToFloat(i16) {
    const out = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 32768.0;
    return out;
  }

  // ---- conversion session: real mic -> server -> virtual track ----
  function createSession(realStream) {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(realStream);
    const sp = ctx.createScriptProcessor(CHUNK_SIZE, 1, 1);
    const dest = ctx.createMediaStreamDestination();

    // Jitter buffer of converted samples at ctx.sampleRate.
    let playBuffer = new Float32Array(0);
    const maxBuffered = CHUNK_SIZE * 6; // drop backlog beyond ~0.5s to bound latency

    const session = {
      onConverted(i16) {
        let f32 = int16ToFloat(i16);
        f32 = resample(f32, SERVER_RATE, ctx.sampleRate);
        const merged = new Float32Array(playBuffer.length + f32.length);
        merged.set(playBuffer);
        merged.set(f32, playBuffer.length);
        playBuffer = merged.length > maxBuffered ? merged.subarray(merged.length - maxBuffered) : merged;
      },
      stop() {
        try { sp.disconnect(); src.disconnect(); ctx.close(); } catch (e) {}
        realStream.getTracks().forEach((t) => t.stop());
        state.activeSessions--;
      },
    };

    sp.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0);
      const i16 = floatToInt16(resample(input, ctx.sampleRate, SERVER_RATE));
      const seq = ++reqSeq;
      pendingBySeq.set(seq, session);
      if (pendingBySeq.size > 20) {
        // Server not answering; forget oldest so the map does not grow forever.
        const oldest = pendingBySeq.keys().next().value;
        pendingBySeq.delete(oldest);
      }
      window.postMessage({ __vcclient: true, type: "VC_AUDIO_REQ", seq, buf: i16.buffer }, "*", [i16.buffer]);

      const output = ev.outputBuffer.getChannelData(0);
      if (playBuffer.length >= output.length) {
        output.set(playBuffer.subarray(0, output.length));
        playBuffer = playBuffer.slice(output.length);
      } else {
        output.fill(0);
      }
    };

    src.connect(sp);
    sp.connect(dest);
    state.activeSessions++;

    // End the session when the site stops the virtual track.
    const vTrack = dest.stream.getAudioTracks()[0];
    const origStop = vTrack.stop.bind(vTrack);
    vTrack.stop = () => { session.stop(); origStop(); };
    realStream.getAudioTracks()[0].addEventListener("ended", () => session.stop());

    return dest.stream;
  }

  // ---- getUserMedia / enumerateDevices patches ----
  const origGetUserMedia = MediaDevices.prototype.getUserMedia;
  const origEnumerate = MediaDevices.prototype.enumerateDevices;

  function wantsVirtualDevice(audioConstraints) {
    if (!audioConstraints || typeof audioConstraints !== "object") return false;
    const id = audioConstraints.deviceId;
    if (!id) return false;
    const ids = typeof id === "string" ? [id] : Array.isArray(id) ? id : [id.exact, id.ideal].flat();
    return ids.includes(VIRTUAL_DEVICE_ID);
  }

  MediaDevices.prototype.enumerateDevices = async function () {
    const devices = await origEnumerate.call(this);
    const virtual = {
      deviceId: VIRTUAL_DEVICE_ID,
      groupId: VIRTUAL_DEVICE_ID,
      kind: "audioinput",
      label: VIRTUAL_LABEL,
      toJSON() { return { deviceId: this.deviceId, groupId: this.groupId, kind: this.kind, label: this.label }; },
    };
    return [virtual, ...devices];
  };

  MediaDevices.prototype.getUserMedia = async function (constraints) {
    const audioReq = constraints && constraints.audio;
    const useVirtual = audioReq && (state.enabled || wantsVirtualDevice(audioReq));
    if (!useVirtual) return origGetUserMedia.call(this, constraints);

    // Real mic for capture: same constraints minus our fake deviceId.
    let realAudio = audioReq === true ? true : { ...audioReq };
    if (realAudio !== true && wantsVirtualDevice(realAudio)) delete realAudio.deviceId;
    const realStream = await origGetUserMedia.call(this, { audio: realAudio });

    const virtualStream = createSession(realStream);
    if (constraints.video) {
      const videoStream = await origGetUserMedia.call(this, { video: constraints.video });
      videoStream.getVideoTracks().forEach((t) => virtualStream.addTrack(t));
    }
    return virtualStream;
  };
})();
