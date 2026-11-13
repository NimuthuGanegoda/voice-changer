const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBackground(sessionStore = {}) {
  let listener;
  const sent = [];
  const chrome = {
    runtime: { onMessage: { addListener: (handler) => { listener = handler; } } },
    storage: {
      session: {
        set: (items) => Object.assign(sessionStore, items),
        get: (key, callback) => callback({ [key]: sessionStore[key] }),
        remove: (key) => { delete sessionStore[key]; },
      },
    },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    tabs: {
      sendMessage: (tabId, message) => { sent.push([tabId, message]); return Promise.resolve(); },
      onRemoved: { addListener: () => {} },
    },
  };
  const sandbox = { chrome, console, Map, Promise };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), sandbox);
  return { listener: () => listener, sent, sessionStore };
}

test('per-tab enable state survives a service worker restart', () => {
  const store = {};
  const first = loadBackground(store);
  first.listener()({ type: 'vc-toggle', tabId: 7, enabled: true, serverUrl: 'http://127.0.0.1:18888', accessToken: 'token' }, {}, () => {});
  assert.equal(store['vc-tab-7'].enabled, true);
  assert.equal(first.sent[0][0], 7);

  const restarted = loadBackground(store);
  let state;
  const asyncResponse = restarted.listener()({ type: 'vc-get-state', tabId: 7 }, {}, (value) => { state = value; });
  assert.equal(asyncResponse, true);
  assert.equal(state.enabled, true);
});
