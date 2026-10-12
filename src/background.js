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
const HISTORY_KEEP = 50; // finished songs kept (hidden) so "previous" can go back
const RETURN_FOCUS_TIMEOUT_MS = 8000;

const ytTabs = new Map(); // tabId -> { port, state, connectedAt }
const uiPorts = new Set();
// UI ports opened by the Zen mod's panel inside Zen's media card. While one is
// connected, the mod is installed and active.
const zenPorts = new Set();
let settings = { ...YTMiniSettings.DEFAULTS };
let queue = { nowPlaying: null, upNext: [], history: [] };
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
  postAll(uiPorts, { type: 'queue', queue: publicQueue() });
  const config = configMessage();
  for (const entry of ytTabs.values()) {
    try {
      entry.port.postMessage(config);
    } catch (e) {
      // tab is going away
    }
  }
}

function configMessage() {
  return {
    type: 'config',
    queueActive: queueActive(),
    upNextAvailable: queue.upNext.length > 0,
    crossfadeSeconds: Number(settings.crossfadeSeconds) || 0,
    skipSilence: !!settings.skipSilence,
  };
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
//
// Model: the song playing now, the songs coming up next, and a hidden history so
// "previous" can go back. Finished songs leave Up Next (they go to history).

const queueReady = browser.storage.local.get('queue').then(({ queue: saved }) => {
  queue = migrateQueue(saved);
});

// Accepts the stored queue in either the current shape or the old
// { items, current } shape from earlier versions.
function migrateQueue(saved) {
  const empty = { nowPlaying: null, upNext: [], history: [] };
  if (!saved || typeof saved !== 'object') return empty;
  if (Array.isArray(saved.upNext)) {
    return {
      nowPlaying: saved.nowPlaying || null,
      upNext: saved.upNext,
      history: Array.isArray(saved.history) ? saved.history : [],
    };
  }
  if (Array.isArray(saved.items)) {
    const cur = Number.isInteger(saved.current) ? saved.current : -1;
    return {
      nowPlaying: saved.items[cur] || null,
      upNext: saved.items.slice(cur + 1),
      history: cur > 0 ? saved.items.slice(0, cur) : [],
    };
  }
  return empty;
}

// What the UIs get (history stays hidden; only its size, for the ⏮ button).
function publicQueue() {
  return { nowPlaying: queue.nowPlaying, upNext: queue.upNext, historyCount: queue.history.length };
}

// The queue "drives" playback (media keys, end-of-song handling) while a queue
// session is going: a queued song is playing or more are waiting. Outside of
// that, YouTube behaves normally (its own autoplay, next/previous).
function queueActive() {
  return queue.upNext.length > 0 || queue.nowPlaying !== null;
}

function saveQueue() {
  if (queue.history.length > HISTORY_KEEP) queue.history.splice(0, queue.history.length - HISTORY_KEEP);
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

// "Nothing playing": no YouTube player, or its video has finished.
// A paused song still counts as playing.
function nothingPlaying() {
  const state = currentState();
  return !state || !state.videoId || !!state.ended;
}

function pushHistory(item) {
  if (item) queue.history.push(item);
}

// Make `item` the song playing now and load it in the player tab.
function playItem(item, { keepCurrent = true } = {}) {
  if (keepCurrent) pushHistory(queue.nowPlaying);
  queue.nowPlaying = item;
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
  if (queue.upNext.length) playItem(queue.upNext.shift());
  else if (!queueActive()) sendToActive({ type: 'cmd', cmd: 'next' }); // no queue: YouTube's own next
  // else: end of the queue -> stop
}

function prev() {
  const state = currentState();
  if (state && state.currentTime > 3) sendToActive({ type: 'cmd', cmd: 'seek', time: 0 });
  else if (queue.history.length) {
    if (queue.nowPlaying) queue.upNext.unshift(queue.nowPlaying);
    playItem(queue.history.pop(), { keepCurrent: false });
  } else if (!queueActive()) sendToActive({ type: 'cmd', cmd: 'prev' });
  else sendToActive({ type: 'cmd', cmd: 'seek', time: 0 });
}

// The song in the player tab finished: it leaves the list (into history) and the
// next one starts, or playback stops when Up Next is empty.
function onEnded() {
  if (queue.upNext.length) {
    playItem(queue.upNext.shift());
  } else if (queueActive()) {
    pushHistory(queue.nowPlaying);
    queue.nowPlaying = null;
    saveQueue();
    sendToActive({ type: 'cmd', cmd: 'stopAutoplay' });
  }
}

// Keep "now playing" in sync if the user picks a video some other way (e.g. in the tab).
function syncNowPlaying(state) {
  if (!state || !state.videoId || state.ad || !queueActive()) return;
  const cur = queue.nowPlaying;
  if (cur && cur.videoId === state.videoId) return;
  // Someone else's video took over; it's now the song playing (Up Next stays as is).
  const idx = queue.upNext.findIndex((it) => it.videoId === state.videoId);
  const item = idx >= 0 ? queue.upNext.splice(idx, 1)[0] : makeItem({ ...state, duration: '' });
  pushHistory(cur);
  queue.nowPlaying = item;
  saveQueue();
}

function handleQueueOp(msg) {
  const { upNext } = queue;
  switch (msg.op) {
    case 'add':
      if (nothingPlaying()) return playItem(makeItem(msg.item));
      upNext.push(makeItem(msg.item));
      break;
    case 'playNext':
      if (nothingPlaying()) return playItem(makeItem(msg.item));
      upNext.unshift(makeItem(msg.item));
      break;
    case 'playNow':
      return playItem(makeItem(msg.item));
    case 'play': {
      const i = msg.index;
      if (!(i >= 0 && i < upNext.length)) return;
      return playItem(upNext.splice(i, 1)[0]);
    }
    case 'remove': {
      const i = msg.index;
      if (!(i >= 0 && i < upNext.length)) return;
      upNext.splice(i, 1);
      break;
    }
    case 'move': {
      const { from, to } = msg;
      if (from === to || !(from >= 0 && from < upNext.length) || !(to >= 0 && to < upNext.length)) return;
      const [moved] = upNext.splice(from, 1);
      upNext.splice(to, 0, moved);
      break;
    }
    case 'clear':
      upNext.length = 0;
      break;
    default:
      return;
  }
  saveQueue();
}

// ---------- Floating player visibility ----------

// Closing the floating player hides it in every tab until the user reopens it
// (popup button, shortcut or settings page).
async function toggleFloating(show) {
  const { overlayClosed } = await browser.storage.local.get('overlayClosed');
  const closed = typeof show === 'boolean' ? !show : !overlayClosed;
  await browser.storage.local.set({ overlayClosed: closed });
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
  queueReady.then(broadcastQueue); // crossfade / skip-silence settings go to the player tab
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
      if (nothingPlaying() && queue.upNext.length) playItem(queue.upNext.shift());
      else sendToActive(msg);
      break;
    case 'toggleFloating':
      toggleFloating(msg.show);
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
        if (msg.state && activeEntry()?.tabId === tabId) syncNowPlaying(msg.state);
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
    port.postMessage(configMessage());
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
    port.postMessage({ type: 'queue', queue: publicQueue() });
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
    case 'toggle-floating-player':
      toggleFloating();
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
