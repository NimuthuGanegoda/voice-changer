// VCClient Virtual Mic - isolated-world bridge.
// Owns the socket.io connection to the local VCClient server (isolated world has the
// extension's CSP, so the page's connect-src cannot block it) and relays PCM chunks
// between the MAIN-world patch and the server.
(() => {
  let socket = null;
  let serverUrl = "http://127.0.0.1:18888";
  let enabled = false;

  function sendConfig() {
    window.postMessage({ __vcclient: true, type: "VC_CONFIG", enabled }, "*");
  }

  function connect() {
    if (socket) return;
    // Namespace /test is VCClient's realtime conversion namespace.
    socket = io(serverUrl + "/test", { transports: ["websocket"], reconnectionAttempts: 10 });
    socket.on("connect_error", (e) => console.warn("[VCClient VirtualMic] server connect error:", e.message));
  }

  function disconnect() {
    if (!socket) return;
    socket.disconnect();
    socket = null;
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__vcclient !== true) return;
    const d = ev.data;
    if (d.type === "VC_MAIN_READY") {
      sendConfig();
    } else if (d.type === "VC_AUDIO_REQ") {
      if (!enabled && !socket) connect(); // site picked the virtual device explicitly
      if (!socket || !socket.connected) return; // chunk dropped; MAIN outputs silence
      socket.emit("request_message", [Date.now(), d.buf]);
      socket.once("response", (msg) => {
        // msg = [timestamp, int16 pcm bytes, perf]
        const bin = msg && msg[1];
        if (!bin || typeof bin === "number") return;
        const buf = bin instanceof ArrayBuffer ? bin : bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
        window.postMessage({ __vcclient: true, type: "VC_AUDIO_RES", seq: d.seq, buf }, "*", [buf]);
      });
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
