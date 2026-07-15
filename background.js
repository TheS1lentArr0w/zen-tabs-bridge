// Must match the "name" field in the native messaging host manifest.
const HOST_NAME = "zen_tabs_bridge_host";

let port = null;
let reconnectDelayMs = 1000;

function connect() {
  try {
    port = browser.runtime.connectNative(HOST_NAME);
  } catch (err) {
    console.error("[zen-tabs-bridge] connectNative failed:", err);
    scheduleReconnect();
    return;
  }

  port.onMessage.addListener(handleHostMessage);

  port.onDisconnect.addListener(() => {
    if (browser.runtime.lastError) {
      console.warn(
        "[zen-tabs-bridge] native port disconnected:",
        browser.runtime.lastError.message,
      );
    }
    port = null;
    scheduleReconnect();
  });

  // Reset backoff and push current state as soon as we connect.
  reconnectDelayMs = 1000;
  sendSnapshot();
}

function scheduleReconnect() {
  setTimeout(connect, reconnectDelayMs);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000);
}

// Pull all open tabs across all windows and push the full list.
// A diffed/incremental version is a reasonable later optimization,
// but a full snapshot is simplest to get right first.
async function sendSnapshot() {
  if (!port) return;

  const tabs = await browser.tabs.query({});
  const payload = {
    type: "tabs_snapshot",
    tabs: tabs.map((t) => ({
      id: t.id,
      windowId: t.windowId,
      title: t.title,
      url: t.url,
      active: t.active,
      favIconUrl: t.favIconUrl || null,
    })),
  };

  try {
    port.postMessage(payload);
  } catch (err) {
    console.error("[zen-tabs-bridge] postMessage failed:", err);
  }
}

// Messages coming back from the native host (i.e. relayed from Raycast).
function handleHostMessage(message) {
  if (!message || typeof message !== "object") return;

  if (message.type === "activate_tab" && typeof message.tabId === "number") {
    activateTab(message.tabId);
  }
}

async function activateTab(tabId) {
  try {
    const tab = await browser.tabs.update(tabId, { active: true });
    if (tab && tab.windowId != null) {
      await browser.windows.update(tab.windowId, { focused: true });
    }
  } catch (err) {
    console.error(`[zen-tabs-bridge] failed to activate tab ${tabId}:`, err);
  }
}

// Re-send the snapshot whenever the tab list changes.
browser.tabs.onCreated.addListener(sendSnapshot);
browser.tabs.onRemoved.addListener(sendSnapshot);
browser.tabs.onUpdated.addListener(sendSnapshot);
browser.tabs.onActivated.addListener(sendSnapshot);
browser.tabs.onMoved.addListener(sendSnapshot);

connect();
