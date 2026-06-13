// VCClient: Sovereign Extension - Background Script
// This script enables tab audio capture for real-time conversion.

chrome.action.onClicked.addListener((tab) => {
  console.log("🥀 Sovereign Extension: Capturing tab audio for conversion...");
  chrome.tabCapture.capture({ audio: true, video: false }, (stream) => {
    if (!stream) {
      console.error("Initiation Failed: Tab capture rejected.");
      return;
    }
    // Route stream to our Web Audio context (implemented in the main app)
    console.log("Audio Stream Manifested. Forwarding to Sanctuary...");
  });
});
