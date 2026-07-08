const enabledEl = document.getElementById("enabled");
const serverUrlEl = document.getElementById("serverUrl");
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

  const cfg = await chrome.storage.local.get({ serverUrl: "http://127.0.0.1:18888" });
  serverUrlEl.value = cfg.serverUrl;

  chrome.runtime.sendMessage({ type: "vc-get-state", tabId }, (state) => {
    enabledEl.checked = !!(state && state.enabled);
  });

  refreshStatus();
  setInterval(refreshStatus, 1500);
}

enabledEl.addEventListener("change", async () => {
  const serverUrl = serverUrlEl.value.trim() || "http://127.0.0.1:18888";
  await chrome.storage.local.set({ serverUrl });
  chrome.runtime.sendMessage({
    type: "vc-toggle",
    tabId,
    enabled: enabledEl.checked,
    serverUrl,
  });
  setTimeout(refreshStatus, 300);
});

serverUrlEl.addEventListener("change", async () => {
  await chrome.storage.local.set({ serverUrl: serverUrlEl.value.trim() });
});

init();
