'use strict';

/* global YTMiniSettings, YTMiniSearch */

// Background hub:
// - tracks YouTube tabs and picks the one that is the "player"
// - owns the user's queue (search -> play now / play next / add), persisted in storage
// - relays player state + queue to every mini player UI and routes commands back
// - opens a background YouTube tab when something is played and none exists

const POPUP_URL = browser.runtime.getURL('src/popup/popup.html');
const WINDOW_URL = browser.runtime.getURL('src/window/window.html');
const OVERLAY_ID = 'ytmini-overlay';
const OVERLAY_FILES = ['src/shared/settings.js', 'src/shared/player-ui.js', 'src/content/overlay.js'];
const PAGE_MATCHES = ['http://*/*', 'https://*/*'];
const YOUTUBE_MATCHES = ['*://*.youtube.com/*'];
const DEFAULT_WINDOW = { width: 380, height: 640 };
const HISTORY_KEEP = 50; // played items kept above the current one
const RETURN_FOCUS_TIMEOUT_MS = 8000;

const ytTabs = new Map(); // tabId -> { port, state, connectedAt }
const uiPorts = new Set();
// UI ports opened by the Zen mod's panel inside Zen's media card. While one is
// connected, the mod is installed and active.
const zenPorts = new Set();
let settings = { ...YTMiniSettings.DEFAULTS };
let queue = { items: [], current: -1 };
let lastBadge = '';
let nextUid = Date.now();
// When we open a player tab we briefly show it (Firefox won't start media in a
// never-visited background tab), then switch back to where the user was.
let pendingReturn = null; // { tabId, returnTo, timer }

// ---------- Active tab selection ----------

// Prefer a tab that is playing right now; otherwise the one that played most
// recently; ties go to the most recently connected tab.
function activeEntry() {
  let best = null;
  for (const [tabId, entry] of ytTabs) {
    if (!entry.state) continue;
    const rank = [entry.state.playing ? 1 : 0, entry.state.lastPlayed || 0, entry.connectedAt];
    if (!best || compareRank(rank, best.rank) > 0) best = { tabId, entry, rank };
  }
  if (!best) {
    // A connected tab without a video (e.g. YouTube home page) can still be used to load one.
    for (const [tabId, entry] of ytTabs) {
      if (!best || entry.connectedAt > best.entry.connectedAt) best = { tabId, entry };
    }
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
  return active && active.state ? { ...active.state, tabId: active.tabId } : null;
}

function postAll(ports, msg) {
  for (const port of ports) {
    try {
      port.postMessage(msg);
    } catch (e) {
      ports.delete(port);
    }
  }
}

function broadcastState() {
  const state = currentState();
  postAll(uiPorts, { type: 'state', state });
  updateBadge(state);
}

function broadcastQueue() {
  postAll(uiPorts, { type: 'queue', queue });
  const config = { type: 'config', queueActive: queueActive() };
  for (const entry of ytTabs.values()) {
    try {
      entry.port.postMessage(config);
    } catch (e) {
      // tab is going away
    }
  }
}

function envMessage() {
  return { type: 'env', zenMod: zenPorts.size > 0 };
}

function broadcastEnv() {
  postAll(uiPorts, envMessage());
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

// ---------- Queue ----------

const queueReady = browser.storage.local.get('queue').then(({ queue: saved }) => {
  if (saved && Array.isArray(saved.items)) {
    queue = { items: saved.items, current: Math.min(saved.current ?? -1, saved.items.length - 1) };
  }
});

// The queue "drives" playback when there's something in it the user hasn't finished.
function queueActive() {
  return queue.items.length > 0 && queue.current < queue.items.length;
}

function saveQueue() {
  // Trim old history so the stored queue doesn't grow forever.
  if (queue.current > HISTORY_KEEP) {
    const drop = queue.current - HISTORY_KEEP;
    queue.items.splice(0, drop);
    queue.current -= drop;
  }
  browser.storage.local.set({ queue });
  broadcastQueue();
}

function makeItem(src) {
  return {
    uid: String(nextUid++),
    videoId: String(src.videoId),
    title: String(src.title || ''),
    channel: String(src.channel || ''),
    duration: String(src.duration || ''),
  };
}

function playIndex(index) {
  const item = queue.items[index];
  if (!item) return;
  queue.current = index;
  saveQueue();
  loadVideo(item.videoId);
}

async function loadVideo(videoId) {
  const active = activeEntry();
  if (active) {
    active.port.postMessage({ type: 'cmd', cmd: 'load', videoId });
    return;
  }
  await openPlayerTab(videoId);
}

async function openPlayerTab(videoId) {
  const [returnTo] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = await browser.tabs.create({
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    active: true,
    pinned: !!settings.pinPlayerTab,
    windowId: returnTo ? returnTo.windowId : undefined,
  });
  if (pendingReturn) clearTimeout(pendingReturn.timer);
  pendingReturn = {
    tabId: tab.id,
    returnTo: returnTo && returnTo.id !== tab.id ? returnTo.id : null,
    timer: setTimeout(finishReturn, RETURN_FOCUS_TIMEOUT_MS),
  };
}

function finishReturn() {
  if (!pendingReturn) return;
  const { returnTo, timer } = pendingReturn;
  clearTimeout(timer);
  pendingReturn = null;
  if (returnTo != null) browser.tabs.update(returnTo, { active: true }).catch(() => {});
}

function next() {
  if (queue.current + 1 < queue.items.length) playIndex(queue.current + 1);
  else if (!queue.items.length) sendToActive({ type: 'cmd', cmd: 'next' }); // no queue: YouTube's own next
  // else: end of the queue -> do nothing (stop)
}

function prev() {
  const state = currentState();
  if (state && state.currentTime > 3) sendToActive({ type: 'cmd', cmd: 'seek', time: 0 });
  else if (queue.current > 0) playIndex(queue.current - 1);
  else if (!queue.items.length) sendToActive({ type: 'cmd', cmd: 'prev' });
  else sendToActive({ type: 'cmd', cmd: 'seek', time: 0 });
}

function onEnded() {
  if (queue.current + 1 < queue.items.length) playIndex(queue.current + 1);
  else if (queue.items.length) sendToActive({ type: 'cmd', cmd: 'stopAutoplay' });
}

// Keep `current` in sync if the user picks a video some other way (e.g. in the tab).
function syncCurrentWithVideo(videoId) {
  if (!videoId) return;
  const cur = queue.items[queue.current];
  if (cur && cur.videoId === videoId) return;
  const idx = queue.items.findIndex((it, i) => it.videoId === videoId && i >= queue.current);
  const found = idx >= 0 ? idx : queue.items.findIndex((it) => it.videoId === videoId);
  if (found >= 0) {
    queue.current = found;
    saveQueue();
  }
}

function handleQueueOp(msg) {
  const { items } = queue;
  switch (msg.op) {
    case 'add':
      items.push(makeItem(msg.item));
      // Nothing playing and nothing queued before -> start right away.
      if (!currentState() && items.length === 1) return playIndex(0);
      break;
    case 'playNext':
      items.splice(queue.current + 1, 0, makeItem(msg.item));
      if (!currentState() && items.length === 1) return playIndex(0);
      break;
    case 'playNow':
      items.splice(queue.current + 1, 0, makeItem(msg.item));
      return playIndex(queue.current + 1);
    case 'play':
      return playIndex(msg.index);
    case 'remove': {
      const i = msg.index;
      if (i < 0 || i >= items.length) return;
      items.splice(i, 1);
      if (i <= queue.current) queue.current--;
      break;
    }
    case 'move': {
      const { from, to } = msg;
      if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      if (queue.current === from) queue.current = to;
      else if (from < queue.current && to >= queue.current) queue.current--;
      else if (from > queue.current && to <= queue.current) queue.current++;
      break;
    }
    case 'clear':
      queue = { items: [], current: -1 };
      break;
    case 'clearUpcoming':
      items.splice(queue.current + 1);
      break;
    default:
      return;
  }
  saveQueue();
}

// ---------- Search ----------

const searches = new Map(); // ui port -> AbortController

async function handleSearch(port, msg) {
  const prevCtl = searches.get(port);
  if (prevCtl) prevCtl.abort();
  const ctl = new AbortController();
  searches.set(port, ctl);
  try {
    const results = await YTMiniSearch.search(msg.query, { signal: ctl.signal });
    port.postMessage({ type: 'searchResults', reqId: msg.reqId, results });
  } catch (e) {
    if (e.name !== 'AbortError') {
      port.postMessage({ type: 'searchResults', reqId: msg.reqId, error: e.message || 'Search failed' });
    }
  } finally {
    if (searches.get(port) === ctl) searches.delete(port);
  }
}

// ---------- Badge ----------

function updateBadge(state, force = false) {
  const text = settings.badgeEnabled && state ? (state.playing ? '▶' : '❚❚') : '';
  const title = state ? `${state.title}${state.channel ? ` — ${state.channel}` : ''}` : 'YT Mini Player';
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
    case 'next':
      next();
      break;
    case 'prev':
      prev();
      break;
    case 'togglePlay':
      // Nothing loaded yet but there's a queue: start it.
      if (!currentState() && queue.items.length) playIndex(Math.max(0, queue.current));
      else sendToActive(msg);
      break;
    default:
      sendToActive(msg);
  }
}

browser.runtime.onConnect.addListener(async (port) => {
  if (port.name === 'yt') {
    const tabId = port.sender && port.sender.tab && port.sender.tab.id;
    if (tabId == null) return;
    ytTabs.set(tabId, { port, state: null, connectedAt: Date.now() });
    port.onMessage.addListener((msg) => {
      const entry = ytTabs.get(tabId);
      if (!entry || entry.port !== port) return;
      if (msg.type === 'state') {
        entry.state = msg.state;
        if (msg.state && activeEntry()?.tabId === tabId) syncCurrentWithVideo(msg.state.videoId);
        if (pendingReturn && pendingReturn.tabId === tabId && msg.state && msg.state.playing) finishReturn();
        broadcastState();
      } else if (msg.type === 'ended') {
        if (activeEntry()?.tabId === tabId) onEnded();
      } else if (msg.type === 'action') {
        // Media keys / Zen's media controls (via the Media Session API).
        if (msg.action === 'next') next();
        else if (msg.action === 'prev') prev();
      }
    });
    port.onDisconnect.addListener(() => {
      const entry = ytTabs.get(tabId);
      if (entry && entry.port === port) {
        ytTabs.delete(tabId);
        broadcastState();
      }
    });
    await queueReady;
    port.postMessage({ type: 'config', queueActive: queueActive() });
  } else if (port.name === 'ui') {
    uiPorts.add(port);
    port.onMessage.addListener(async (msg) => {
      await queueReady;
      if (msg.type === 'hello') {
        if (msg.zen && !zenPorts.has(port)) {
          zenPorts.add(port);
          if (zenPorts.size === 1) broadcastEnv();
        }
      } else if (msg.type === 'cmd') handleUiCommand(msg);
      else if (msg.type === 'queue') handleQueueOp(msg);
      else if (msg.type === 'search') handleSearch(port, msg);
    });
    port.onDisconnect.addListener(() => {
      uiPorts.delete(port);
      if (zenPorts.delete(port) && zenPorts.size === 0) broadcastEnv();
      const ctl = searches.get(port);
      if (ctl) ctl.abort();
      searches.delete(port);
    });
    port.postMessage({ type: 'state', state: currentState() });
    port.postMessage(envMessage());
    await queueReady;
    port.postMessage({ type: 'queue', queue });
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  if (pendingReturn && pendingReturn.tabId === tabId) {
    clearTimeout(pendingReturn.timer);
    pendingReturn = null;
  }
});

browser.commands.onCommand.addListener(async (command) => {
  await queueReady;
  switch (command) {
    case 'toggle-play':
      handleUiCommand({ type: 'cmd', cmd: 'togglePlay' });
      break;
    case 'next-video':
      next();
      break;
    case 'prev-video':
      prev();
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

browser.runtime.onInstalled.addListener(({ reason }) => {
  // The floating player needs the optional "all websites" permission; the
  // settings page explains it and has the button to grant it.
  if (reason === 'install') browser.runtime.openOptionsPage();
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
