const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBridge({ enabled = false } = {}) {
  const posted = [];
  const messageHandlers = [];
  const socketHandlers = {};
  const emitted = [];
  let runtimeListener;
  let ioCalls = 0;
  const socket = {
    connected: true,
    on: (event, handler) => { socketHandlers[event] = handler; },
    volatile: { emit: (event, payload) => emitted.push([event, payload]) },
    disconnect() { this.connected = false; },
  };
  const window = {
    postMessage: (message) => posted.push(message),
    addEventListener: (event, handler) => { if (event === 'message') messageHandlers.push(handler); },
  };
  const chrome = {
    runtime: {
      onMessage: { addListener: (handler) => { runtimeListener = handler; } },
      sendMessage: (_message, callback) => callback({ enabled }),
      lastError: null,
    },
    storage: { local: { get: (_defaults, callback) => callback({ serverUrl: 'http://127.0.0.1:18888', accessToken: 'token' }) } },
  };
  const sandbox = {
    window, chrome, console, Date, Math, ArrayBuffer, Uint8Array,
    self: { crypto: { randomUUID: () => 'page-token' } },
    crypto: { randomUUID: () => 'page-token' },
    io: () => { ioCalls++; return socket; },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'content-bridge.js'), 'utf8'), sandbox);
  const send = (data) => messageHandlers.forEach(handler => handler({ source: window, data }));
  const config = posted.find(message => message.type === 'VC_CONFIG');
  return { posted, emitted, socketHandlers, runtimeListener, send, token: config.token, ioCalls: () => ioCalls, socket };
}

test('bridge refuses audio while disabled and validates PCM before forwarding', () => {
  const bridge = loadBridge({ enabled: false });
  bridge.send({ __vcclient: true, token: bridge.token, type: 'VC_AUDIO_REQ', seq: 1, buf: new ArrayBuffer(256) });
  assert.equal(bridge.emitted.length, 0);
  assert.equal(bridge.ioCalls(), 0);

  bridge.runtimeListener({ type: 'vc-set', enabled: true, serverUrl: 'http://127.0.0.1:18888', accessToken: 'token' }, {}, () => {});
  bridge.send({ __vcclient: true, token: bridge.token, type: 'VC_AUDIO_REQ', seq: 2, buf: new ArrayBuffer(3) });
  assert.equal(bridge.emitted.length, 0);
  bridge.send({ __vcclient: true, token: bridge.token, type: 'VC_AUDIO_REQ', seq: 3, buf: new ArrayBuffer(256) });
  assert.equal(bridge.emitted.length, 1);
  assert.equal(bridge.emitted[0][0], 'request_message');

  bridge.send({ __vcclient: true, token: bridge.token, type: 'VC_AUDIO_REQ', seq: 4, buf: new ArrayBuffer(256) });
  const [badReqId, goodReqId] = bridge.emitted.map(call => call[1][0]);
  const before = bridge.posted.length;
  bridge.socketHandlers.response([badReqId, new ArrayBuffer(3)]);
  assert.equal(bridge.posted.length, before);
  bridge.socketHandlers.response([goodReqId, new ArrayBuffer(256)]);
  assert.equal(bridge.posted.at(-1).type, 'VC_AUDIO_RES');
});

test('disabling the tab disconnects and drops pending audio', () => {
  const bridge = loadBridge({ enabled: true });
  bridge.send({ __vcclient: true, token: bridge.token, type: 'VC_AUDIO_REQ', seq: 1, buf: new ArrayBuffer(256) });
  assert.equal(bridge.emitted.length, 1);
  bridge.runtimeListener({ type: 'vc-set', enabled: false }, {}, () => {});
  bridge.send({ __vcclient: true, token: bridge.token, type: 'VC_AUDIO_REQ', seq: 2, buf: new ArrayBuffer(256) });
  assert.equal(bridge.emitted.length, 1);
  assert.equal(bridge.socket.connected, false);
});

test('overrun and vc_error clear pending slots and status reports diagnostics', () => {
  const bridge = loadBridge({ enabled: true });
  for (let i = 1; i <= 4; i++) {
    bridge.send({ __vcclient: true, token: bridge.token, type: 'VC_AUDIO_REQ', seq: i, buf: new ArrayBuffer(256) });
  }
  assert.equal(bridge.emitted.length, 4);

  // Queue is now at 4; a 5th chunk is dropped until a slot frees up.
  bridge.send({ __vcclient: true, token: bridge.token, type: 'VC_AUDIO_REQ', seq: 5, buf: new ArrayBuffer(256) });
  assert.equal(bridge.emitted.length, 4);

  // Server emits overrun for req 1 and vc_error for req 2 -> 2 slots freed!
  bridge.socketHandlers.overrun({ timestamp: bridge.emitted[0][1][0] });
  bridge.socketHandlers.vc_error({ timestamp: bridge.emitted[1][1][0], msg: 'transient error' });

  bridge.send({ __vcclient: true, token: bridge.token, type: 'VC_AUDIO_REQ', seq: 6, buf: new ArrayBuffer(256) });
  assert.equal(bridge.emitted.length, 5);

  // Response computes RTT and clears its slot.
  bridge.socketHandlers.response([bridge.emitted[4][1][0], new ArrayBuffer(256)]);

  let status;
  bridge.runtimeListener({ type: 'vc-status' }, {}, (res) => { status = res; });
  assert.equal(status.overrunCount, 1);
  assert.equal(typeof status.lastRttMs, 'number');
  assert.equal(status.pendingCount, 2);

  // Reconnect resets overrun count and socket.
  bridge.runtimeListener({ type: 'vc-reconnect' }, {}, () => {});
  bridge.runtimeListener({ type: 'vc-status' }, {}, (res) => { status = res; });
  assert.equal(status.overrunCount, 0);
  assert.equal(status.pendingCount, 0);
});
