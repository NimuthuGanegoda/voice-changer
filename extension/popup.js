async function saveConnection() {
  const serverUrl = serverUrlEl.value.trim() || "http://127.0.0.1:18888";
  const url = new URL(serverUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Use an http(s) server URL");
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
    if (!granted) throw new Error("Permission to connect to this server was denied");
  }
  const accessToken = accessTokenEl.value.trim();
  await chrome.storage.local.set({ serverUrl, accessToken });
  await chrome.runtime.sendMessage({ type: "vc-toggle", tabId, enabled: enabledEl.checked, serverUrl, accessToken });
}
const enabledEl = document.getElementById("enabled");
const serverUrlEl = document.getElementById("serverUrl");
const accessTokenEl = document.getElementById("accessToken");
const statusEl = document.getElementById("status");

let tabId = null;

async function refreshStatus() {
  if (tabId === null) return;
  chrome.tabs.sendMessage(tabId, { type: "vc-status" }, (res) => {
    if (chrome.runtime.lastError || !res) {
      statusEl.textContent = "Not active on this page (reload the tab after installing).";
      return;
    }
    statusEl.textContent =
      `Enabled: ${res.enabled ? "yes" : "no"}\n` +
      `Server: ${res.serverUrl} (${res.connected ? "connected" : "not connected"})`;
  });
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab.id;

  const cfg = await chrome.storage.local.get({ serverUrl: "http://127.0.0.1:18888", accessToken: "" });
  serverUrlEl.value = cfg.serverUrl;
  accessTokenEl.value = cfg.accessToken;

  chrome.runtime.sendMessage({ type: "vc-get-state", tabId }, (state) => {
    enabledEl.checked = !!(state && state.enabled);
  });

  refreshStatus();
  setInterval(refreshStatus, 1500);
}

enabledEl.addEventListener("change", () => saveConnection().catch(e => { statusEl.textContent = String(e); }));
serverUrlEl.addEventListener("change", () => saveConnection().catch(e => { statusEl.textContent = String(e); }));
accessTokenEl.addEventListener("change", () => saveConnection().catch(e => { statusEl.textContent = String(e); }));

init();
