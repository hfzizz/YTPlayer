'use strict';

/* global YTMiniSettings */

// Background hub: tracks YouTube tabs, picks the one to control, relays state
// to every mini player UI, and routes commands back to that tab.

const POPUP_URL = browser.runtime.getURL('src/popup/popup.html');
const WINDOW_URL = browser.runtime.getURL('src/window/window.html');
const OVERLAY_ID = 'ytmini-overlay';
const OVERLAY_FILES = ['src/shared/settings.js', 'src/shared/player-ui.js', 'src/content/overlay.js'];
const PAGE_MATCHES = ['http://*/*', 'https://*/*'];
const YOUTUBE_MATCHES = ['*://*.youtube.com/*'];
const DEFAULT_WINDOW = { width: 380, height: 600 };

const ytTabs = new Map(); // tabId -> { port, state, connectedAt }
const uiPorts = new Set();
let settings = { ...YTMiniSettings.DEFAULTS };
let lastBadge = '';

// ---------- Active tab selection ----------

// Prefer a tab that is playing right now; otherwise the one that played most recently;
// ties go to the most recently connected tab.
function activeEntry() {
  let best = null;
  for (const [tabId, entry] of ytTabs) {
    if (!entry.state) continue;
    const rank = [entry.state.playing ? 1 : 0, entry.state.lastPlayed || 0, entry.connectedAt];
    if (!best || compareRank(rank, best.rank) > 0) best = { tabId, entry, rank };
  }
  return best && { tabId: best.tabId, ...best.entry };
}

function compareRank(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function currentState() {
  const active = activeEntry();
  return active ? { ...active.state, tabId: active.tabId } : null;
}

function broadcast() {
  const state = currentState();
  const msg = { type: 'state', state };
  for (const port of uiPorts) {
    try {
      port.postMessage(msg);
    } catch (e) {
      uiPorts.delete(port);
    }
  }
  updateBadge(state);
}

function sendToActive(msg) {
  const active = activeEntry();
  if (!active) return false;
  try {
    active.port.postMessage(msg);
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- Badge ----------

function updateBadge(state, force = false) {
  const text = settings.badgeEnabled && state ? (state.playing ? '\u25b6' : '\u275a\u275a') : '';
  const title = state ? `${state.title}${state.channel ? ` \u2014 ${state.channel}` : ''}` : 'YT Mini Player';
  const key = `${text}|${title}`;
  if (!force && key === lastBadge) return;
  lastBadge = key;
  browser.action.setBadgeText({ text });
  browser.action.setBadgeBackgroundColor({ color: state && state.playing ? '#ff0033' : '#606060' });
  if (browser.action.setBadgeTextColor) browser.action.setBadgeTextColor({ color: '#ffffff' });
  browser.action.setTitle({ title });
}

// ---------- Mini window ----------

async function openMiniWindow() {
  if (!settings.windowEnabled) return;
  const existing = await browser.tabs.query({ url: WINDOW_URL });
  if (existing.length) {
    await browser.windows.update(existing[0].windowId, { focused: true });
    return;
  }
  const { windowBounds } = await browser.storage.local.get('windowBounds');
  await browser.windows.create({ url: WINDOW_URL, type: 'popup', ...DEFAULT_WINDOW, ...(windowBounds || {}) });
}

async function focusActiveTab() {
  const active = activeEntry();
  if (!active) return;
  const tab = await browser.tabs.update(active.tabId, { active: true });
  await browser.windows.update(tab.windowId, { focused: true });
}

// ---------- Settings-driven behaviour ----------

function applyAction() {
  const usePopup = settings.popupEnabled && (settings.clickAction === 'popup' || !settings.windowEnabled);
  browser.action.setPopup({ popup: usePopup ? POPUP_URL : '' });
}

// The overlay is registered dynamically so it only runs on other sites when the
// user turned it on and granted the "all websites" permission.
async function syncOverlay() {
  try {
    const granted = await browser.permissions.contains({ origins: ['<all_urls>'] });
    const want = settings.overlayEnabled && granted;
    const registered = await browser.scripting.getRegisteredContentScripts({ ids: [OVERLAY_ID] });

    if (want && !registered.length) {
      await browser.scripting.registerContentScripts([
        {
          id: OVERLAY_ID,
          matches: PAGE_MATCHES,
          excludeMatches: YOUTUBE_MATCHES,
          js: OVERLAY_FILES,
          runAt: 'document_idle',
          persistAcrossSessions: true,
        },
      ]);
      await injectOverlayIntoOpenTabs();
    } else if (!want && registered.length) {
      // Overlays already on pages remove themselves when they see the setting change.
      await browser.scripting.unregisterContentScripts({ ids: [OVERLAY_ID] });
    }
  } catch (e) {
    console.error('YT Mini: failed to sync overlay', e);
  }
}

async function injectOverlayIntoOpenTabs() {
  const tabs = await browser.tabs.query({ url: PAGE_MATCHES });
  await Promise.all(
    tabs
      .filter((t) => !/^https?:\/\/([^/]+\.)?youtube\.com\//.test(t.url || ''))
      .map((t) => browser.scripting.executeScript({ target: { tabId: t.id }, files: OVERLAY_FILES }).catch(() => {}))
  );
}

function applySettings() {
  applyAction();
  syncOverlay();
  updateBadge(currentState(), true);
}

// ---------- Connections ----------

function handleUiCommand(msg) {
  switch (msg.cmd) {
    case 'focusTab':
      focusActiveTab();
      break;
    case 'openYouTube':
      browser.tabs.create({ url: 'https://www.youtube.com/' });
      break;
    case 'openWindow':
      openMiniWindow();
      break;
    case 'openOptions':
      browser.runtime.openOptionsPage();
      break;
    default:
      sendToActive(msg);
  }
}

browser.runtime.onConnect.addListener((port) => {
  if (port.name === 'yt') {
    const tabId = port.sender && port.sender.tab && port.sender.tab.id;
    if (tabId == null) return;
    ytTabs.set(tabId, { port, state: null, connectedAt: Date.now() });
    port.onMessage.addListener((msg) => {
      const entry = ytTabs.get(tabId);
      if (!entry || entry.port !== port || msg.type !== 'state') return;
      entry.state = msg.state;
      broadcast();
    });
    port.onDisconnect.addListener(() => {
      const entry = ytTabs.get(tabId);
      if (entry && entry.port === port) {
        ytTabs.delete(tabId);
        broadcast();
      }
    });
  } else if (port.name === 'ui') {
    uiPorts.add(port);
    port.postMessage({ type: 'state', state: currentState() });
    port.onMessage.addListener((msg) => {
      if (msg.type === 'cmd') handleUiCommand(msg);
    });
    port.onDisconnect.addListener(() => uiPorts.delete(port));
  }
});

browser.commands.onCommand.addListener((command) => {
  switch (command) {
    case 'toggle-play':
      sendToActive({ type: 'cmd', cmd: 'togglePlay' });
      break;
    case 'next-video':
      sendToActive({ type: 'cmd', cmd: 'next' });
      break;
    case 'prev-video':
      sendToActive({ type: 'cmd', cmd: 'prev' });
      break;
    case 'open-mini-window':
      openMiniWindow();
      break;
  }
});

// Only fires when no popup is set (popup disabled, or click action = window).
browser.action.onClicked.addListener(() => {
  if (settings.windowEnabled) openMiniWindow();
  else browser.runtime.openOptionsPage();
});

browser.permissions.onAdded.addListener(syncOverlay);
browser.permissions.onRemoved.addListener(syncOverlay);

YTMiniSettings.onChange((s) => {
  settings = s;
  applySettings();
});

YTMiniSettings.get().then((s) => {
  settings = s;
  applySettings();
});
