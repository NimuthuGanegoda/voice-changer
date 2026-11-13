// VCClient Virtual Mic - background service worker.
// Tracks per-tab enable state and relays popup toggles to the content scripts.
// storage.session survives MV3 worker restarts but is cleared when the browser closes.
const tabState = new Map(); // tabId -> { enabled: boolean }
const keyFor = (tabId) => `vc-tab-${tabId}`;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "vc-toggle") {
    const state = { enabled: !!msg.enabled };
    tabState.set(msg.tabId, state);
    if (chrome.storage.session) chrome.storage.session.set({ [keyFor(msg.tabId)]: state });
    chrome.action.setBadgeText({ tabId: msg.tabId, text: state.enabled ? "ON" : "" });
    chrome.action.setBadgeBackgroundColor({ tabId: msg.tabId, color: "#2e7d32" });
    chrome.tabs.sendMessage(msg.tabId, {
      type: "vc-set",
      enabled: state.enabled,
      serverUrl: msg.serverUrl,
      accessToken: msg.accessToken,
    }).catch(() => {});
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === "vc-get-state") {
    const tabId = msg.tabId !== undefined ? msg.tabId : sender.tab && sender.tab.id;
    const cached = tabState.get(tabId);
    if (cached) {
      sendResponse(cached);
      return;
    }
    if (chrome.storage.session) {
      chrome.storage.session.get(keyFor(tabId), (result) => {
        if (chrome.runtime.lastError || !result) {
          sendResponse({ enabled: false });
          return;
        }
        const state = result[keyFor(tabId)] || { enabled: false };
        tabState.set(tabId, state);
        sendResponse(state);
      });
      return true; // asynchronous sendResponse
    }
    sendResponse({ enabled: false });
    return;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
  if (chrome.storage.session) chrome.storage.session.remove(keyFor(tabId));
});
