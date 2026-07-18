// VCClient Virtual Mic - isolated-world bridge.
// Owns the socket.io connection to the local VCClient server (isolated world has the
// extension's CSP, so the page's connect-src cannot block it) and relays PCM chunks
// between the MAIN-world patch and the server.
(() => {
  let socket = null;
  let serverUrl = "http://127.0.0.1:18888";
  let enabled = false;
  // The server echoes back whatever we put in msg[0] (it only uses it as an
  // opaque int), so we use a monotonic request id instead of Date.now() to
  // correlate responses - Date.now() can collide within the same ms when
  // chunks queue up, which used to cross-deliver audio between requests.
  let nextReqId = 1;
  const pending = new Map(); // reqId -> seq

  // window.postMessage is the only channel between this isolated-world script
  // and the MAIN-world patch (content-main.js), but it's also visible to any
  // script running in the page. Both content scripts run at document_start,
  // before the page's own <script> tags execute, so this token - generated
  // here and locked onto by whichever side sees it first - is not observable
  // by ordinary page JS. It doesn't defend against another document_start
  // extension racing us, but that's a much narrower threat than "any page
  // script, any time" (which is what an unauthenticated bridge allows).
  const PAGE_TOKEN = (self.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

  function sendConfig() {
    window.postMessage({ __vcclient: true, token: PAGE_TOKEN, type: "VC_CONFIG", enabled }, "*");
  }

  function connect() {
    if (socket) return;
    // Namespace /test is VCClient's realtime conversion namespace.
    socket = io(serverUrl + "/test", { transports: ["websocket"], reconnectionAttempts: 10 });
    socket.on("connect_error", (e) => console.warn("[VCClient VirtualMic] server connect error:", e.message));
    // Single persistent listener, not one `once` per request - `once` handlers
    // all fire on the same "response" event, so N pending requests meant N
    // handlers firing off the first reply that arrived.
    socket.on("response", (msg) => {
      const reqId = msg && msg[0];
      const seq = pending.get(reqId);
      if (seq === undefined) return; // stale/unknown response, drop it
      pending.delete(reqId);
      const bin = msg[1];
      if (!bin || typeof bin === "number") return;
      const buf = bin instanceof ArrayBuffer ? bin : bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
      window.postMessage({ __vcclient: true, token: PAGE_TOKEN, type: "VC_AUDIO_RES", seq, buf }, "*", [buf]);
    });
  }

  function disconnect() {
    if (!socket) return;
    socket.disconnect();
    socket = null;
    pending.clear();
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__vcclient !== true) return;
    const d = ev.data;
    if (d.type === "VC_MAIN_READY") {
      // No token to check yet - this is the one message content-main.js sends
      // before it has learned PAGE_TOKEN from our reply below.
      sendConfig();
    } else if (d.type === "VC_AUDIO_REQ") {
      // Only content-main.js has seen PAGE_TOKEN (via the VC_CONFIG reply
      // above), so this rejects audio requests forged by a page script that
      // started listening after that handshake - which is any ordinary
      // <script>, since those run after document_start content scripts.
      if (d.token !== PAGE_TOKEN) return;
      if (!enabled && !socket) connect(); // site picked the virtual device explicitly
      if (!socket || !socket.connected) return; // chunk dropped; MAIN outputs silence
      const reqId = nextReqId++;
      pending.set(reqId, d.seq);
      socket.emit("request_message", [reqId, d.buf]);
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "vc-set") {
      enabled = !!msg.enabled;
      if (msg.serverUrl) serverUrl = msg.serverUrl;
      if (enabled) connect();
      else disconnect();
      sendConfig();
      sendResponse({ ok: true });
    } else if (msg.type === "vc-status") {
      sendResponse({ enabled, connected: !!(socket && socket.connected), serverUrl });
    }
  });

  // Restore state on page load (e.g. after navigation in an enabled tab).
  chrome.storage.local.get({ serverUrl: "http://127.0.0.1:18888" }, (cfg) => {
    serverUrl = cfg.serverUrl;
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
