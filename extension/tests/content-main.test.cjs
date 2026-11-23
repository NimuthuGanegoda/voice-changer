const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContentMain({ audioTracks = [{ stop() {}, addEventListener() {} }], ctxState = 'suspended' } = {}) {
  const posted = [];
  const messageHandlers = [];
  let resumed = 0;
  let lastProcessor = null;

  const window = {
    postMessage: (message) => posted.push(message),
    addEventListener: (event, handler) => { if (event === 'message') messageHandlers.push(handler); },
  };

  class FakeAudioContext {
    constructor() {
      this.sampleRate = 48000;
      this.state = ctxState;
    }
    resume() {
      resumed++;
      this.state = 'running';
      return Promise.resolve();
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    createScriptProcessor() {
      lastProcessor = { onaudioprocess: null, connect() {}, disconnect() {} };
      return lastProcessor;
    }
    createMediaStreamDestination() {
      const vTrack = { stop() {} };
      return {
        stream: {
          getAudioTracks: () => [vTrack],
          getTracks: () => [vTrack],
          addTrack() {},
        },
      };
    }
    close() {}
  }

  class FakeMediaDevices {}
  FakeMediaDevices.prototype.enumerateDevices = async () => [{ deviceId: 'real-mic', kind: 'audioinput', label: 'Real Mic' }];
  FakeMediaDevices.prototype.getUserMedia = async () => ({
    getAudioTracks: () => audioTracks,
    getTracks: () => audioTracks,
  });

  const sandbox = {
    window,
    AudioContext: FakeAudioContext,
    MediaDevices: FakeMediaDevices,
    DOMException,
    ArrayBuffer,
    Float32Array,
    Int16Array,
    Map,
    Set,
    Date,
    Math,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'audio-buffer.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'content-main.js'), 'utf8'), sandbox);

  const send = (data) => messageHandlers.forEach((handler) => handler({ source: window, data }));
  const mediaDevices = new FakeMediaDevices();
  return {
    posted,
    send,
    mediaDevices,
    resumed: () => resumed,
    processor: () => lastProcessor,
  };
}

test('content-main resumes suspended AudioContext, skips posting when disabled, and flushes on disable', async () => {
  const env = loadContentMain({ ctxState: 'suspended' });
  env.send({ __vcclient: true, type: 'VC_CONFIG', token: 'tok-1', enabled: true, serverUrl: 'http://127.0.0.1:18888' });

  await env.mediaDevices.getUserMedia({ audio: true });
  assert.equal(env.resumed(), 1);

  const proc = env.processor();
  const inBuf = new Float32Array(4096).fill(0.25);
  const outBuf = new Float32Array(4096);
  const fakeEvent = {
    inputBuffer: { getChannelData: () => inBuf },
    outputBuffer: { getChannelData: () => outBuf },
  };

  // Enabled -> posts VC_AUDIO_REQ with locked bridge token.
  proc.onaudioprocess(fakeEvent);
  const reqsAfterEnabled = env.posted.filter((m) => m.type === 'VC_AUDIO_REQ');
  assert.equal(reqsAfterEnabled.length, 1);
  assert.equal(reqsAfterEnabled[0].token, 'tok-1');

  // Feed converted audio into ring buffer, then disable -> must flush buffer and stop posting.
  const converted = new Int16Array(4096).fill(16384);
  env.send({ __vcclient: true, type: 'VC_AUDIO_RES', token: 'tok-1', seq: reqsAfterEnabled[0].seq, buf: converted.buffer });

  env.send({ __vcclient: true, type: 'VC_CONFIG', token: 'tok-1', enabled: false, serverUrl: 'http://127.0.0.1:18888' });
  outBuf.fill(0.5);
  proc.onaudioprocess(fakeEvent);
  assert.equal(env.posted.filter((m) => m.type === 'VC_AUDIO_REQ').length, 1);
  assert.equal(outBuf[0], 0);

  // Re-enabling must not play stale pre-disable samples from the ring buffer.
  env.send({ __vcclient: true, type: 'VC_CONFIG', token: 'tok-1', enabled: true, serverUrl: 'http://127.0.0.1:18888' });
  proc.onaudioprocess(fakeEvent);
  assert.equal(outBuf[0], 0);
});

test('content-main guards empty realStream audio tracks without throwing', async () => {
  const env = loadContentMain({ audioTracks: [] });
  env.send({ __vcclient: true, type: 'VC_CONFIG', token: 'tok-2', enabled: true, serverUrl: 'http://127.0.0.1:18888' });
  const stream = await env.mediaDevices.getUserMedia({ audio: true });
  assert.ok(stream);
});
