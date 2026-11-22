// VCClient Virtual Mic - isolated-world bridge.
// Owns the socket.io connection to the local VCClient server (isolated world has the
// extension's CSP, so the page's connect-src cannot block it) and relays PCM chunks
// between the MAIN-world patch and the server.
(() => {
  let socket = null;
  let serverUrl = "http://127.0.0.1:18888";
  let enabled = false;
  let accessToken = "";
  // The server echoes back whatever we put in msg[0] (it only uses it as an
  // opaque int), so we use a monotonic request id instead of Date.now() to
  // correlate responses - Date.now() can collide within the same ms when
  // chunks queue up, which used to cross-deliver audio between requests.
  let nextReqId = 1;
  const pending = new Map(); // reqId -> { seq, sentAt }
  const PENDING_TIMEOUT_MS = 10000;
  let lastRttMs = null;
  let overrunCount = 0;

  // window.postMessage is visible to page scripts, so this token only rejects
  // malformed/stale messages; it is NOT a security boundary. The bridge must
  // also enforce the user's per-tab enable switch before using the server token.
  const PAGE_TOKEN = (self.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

  function sendConfig() {
    window.postMessage({ __vcclient: true, token: PAGE_TOKEN, type: "VC_CONFIG", enabled, serverUrl }, "*");
  }

  function pruneStalePending(now) {
    for (const [reqId, entry] of pending) {
      if (now - entry.sentAt > PENDING_TIMEOUT_MS) {
        pending.delete(reqId);
      }
    }
  }

  function connect() {
    if (socket) return;
    // Namespace /test is VCClient's realtime conversion namespace.
    socket = io(serverUrl + "/test", { transports: ["websocket"], auth: { token: accessToken }, reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 5000 });
    socket.on("disconnect", () => pending.clear());
    socket.on("overrun", (msg) => {
      overrunCount += 1;
      if (msg && msg.timestamp !== undefined) {
        pending.delete(msg.timestamp);
      }
    });
    socket.on("vc_error", (error) => {
      if (error && error.timestamp !== undefined) {
        pending.delete(error.timestamp);
      } else {
        const oldest = pending.keys().next();
        if (!oldest.done) pending.delete(oldest.value);
      }
      console.warn("[VCClient VirtualMic]", error && error.msg ? error.msg : "conversion error");
    });
    socket.on("connect_error", (e) => console.warn("[VCClient VirtualMic] server connect error:", e.message));
    // Single persistent listener, not one `once` per request - `once` handlers
    // all fire on the same "response" event, so N pending requests meant N
    // handlers firing off the first reply that arrived.
    socket.on("response", (msg) => {
      const reqId = msg && msg[0];
      const entry = pending.get(reqId);
      if (entry === undefined) return; // stale/unknown response, drop it
      pending.delete(reqId);
      lastRttMs = Math.max(0, Date.now() - entry.sentAt);
      const bin = msg[1];
      const byteLength = bin instanceof ArrayBuffer ? bin.byteLength : ArrayBuffer.isView(bin) ? bin.byteLength : 0;
      if (!byteLength || byteLength % 2 !== 0 || byteLength > 1024 * 1024) return;
      const buf = bin instanceof ArrayBuffer ? bin : bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
      window.postMessage({ __vcclient: true, token: PAGE_TOKEN, type: "VC_AUDIO_RES", seq: entry.seq, buf }, "*", [buf]);
    });
  }

  function disconnect() {
    if (!socket) return;
    socket.disconnect();
    socket = null;
    pending.clear();
    lastRttMs = null;
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__vcclient !== true) return;
    const d = ev.data;
    if (d.type === "VC_MAIN_READY") {
      // No token to check yet - this is the one message content-main.js sends
      // before it has learned PAGE_TOKEN from our reply below.
      sendConfig();
    } else if (d.type === "VC_AUDIO_REQ") {
      // The token is observable by page scripts, so the real gate is the
      // per-tab enable switch owned by the isolated bridge/background worker.
      if (d.token !== PAGE_TOKEN || !enabled) return;
      if (!(d.buf instanceof ArrayBuffer) || d.buf.byteLength === 0 || d.buf.byteLength > 1024 * 1024 || d.buf.byteLength % 2 !== 0) return;
      if (!socket) connect();
      if (!socket.connected) return; // chunk dropped; MAIN outputs silence
      const now = Date.now();
      pruneStalePending(now);
      if (pending.size >= 4) return; // bound outstanding latency to four blocks
      const reqId = nextReqId++;
      pending.set(reqId, { seq: d.seq, sentAt: now });
      socket.volatile.emit("request_message", [reqId, d.buf]);
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "vc-set") {
      enabled = !!msg.enabled;
      const newUrl = msg.serverUrl || serverUrl;
      const newToken = msg.accessToken || "";
      if (newUrl !== serverUrl || newToken !== accessToken) disconnect();
      serverUrl = newUrl;
      accessToken = newToken;
      if (enabled) connect();
      else disconnect();
      sendConfig();
      sendResponse({ ok: true });
    } else if (msg.type === "vc-reconnect") {
      disconnect();
      overrunCount = 0;
      if (enabled) connect();
      sendConfig();
      sendResponse({ ok: true });
    } else if (msg.type === "vc-status") {
      sendResponse({
        enabled,
        connected: !!(socket && socket.connected),
        serverUrl,
        lastRttMs,
        overrunCount,
        pendingCount: pending.size,
      });
    }
  });

  // Restore state on page load (e.g. after navigation in an enabled tab).
  chrome.storage.local.get({ serverUrl: "http://127.0.0.1:18888", accessToken: "" }, (cfg) => {
    serverUrl = cfg.serverUrl;
    accessToken = cfg.accessToken;
    chrome.runtime.sendMessage({ type: "vc-get-state" }, (state) => {
      if (chrome.runtime.lastError) return;
      if (state && state.enabled) {
        enabled = true;
        connect();
      }
      sendConfig();
    });
  });
})();
