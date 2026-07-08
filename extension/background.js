// VCClient Virtual Mic - background service worker.
// Tracks per-tab enable state and relays popup toggles to the content scripts.

const tabState = new Map(); // tabId -> { enabled: boolean }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "vc-toggle") {
    // From popup: enable/disable for a tab and notify its content scripts.
    tabState.set(msg.tabId, { enabled: msg.enabled });
    chrome.action.setBadgeText({ tabId: msg.tabId, text: msg.enabled ? "ON" : "" });
    chrome.action.setBadgeBackgroundColor({ tabId: msg.tabId, color: "#2e7d32" });
    chrome.tabs.sendMessage(msg.tabId, {
      type: "vc-set",
      enabled: msg.enabled,
      serverUrl: msg.serverUrl,
    }).catch(() => {});
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === "vc-get-state") {
    // From content bridge on page load, or from popup (with explicit tabId).
    const tabId = msg.tabId !== undefined ? msg.tabId : sender.tab && sender.tab.id;
    const state = tabState.get(tabId) || { enabled: false };
    sendResponse(state);
    return;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});
