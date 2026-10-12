'use strict';

// Runs inside youtube.com tabs. Reads the player's state, reports it to the
// background, and carries out commands sent from the mini player UIs.
(() => {
  if (globalThis.__ytMiniYouTube) return;
  globalThis.__ytMiniYouTube = true;

  const S = globalThis.YTMiniSelectors;
  const TIME_THROTTLE_MS = 1000;
  const QUEUE_REFRESH_MS = 4000;
  const UPNEXT_LIMIT = 25;
  const PLAYLIST_LIMIT = 200;

  let port = null;
  let lastPlayed = 0;
  let lastTimeSend = 0;
  let queueCache = null;
  let queueKey = '';
  let queueAt = 0;

  // ---------- DOM helpers ----------

  const video = () => document.querySelector(S.video);

  // The page's player object (movie_player) exposes YouTube's player API.
  // Content scripts see it through an Xray wrapper; wrappedJSObject reaches the page functions.
  function playerApi() {
    const el = document.querySelector(S.player);
    if (!el) return null;
    return el.wrappedJSObject || el;
  }

  function has(name) {
    try {
      const p = playerApi();
      return !!p && typeof p[name] === 'function';
    } catch (e) {
      return false;
    }
  }

  function call(name, ...args) {
    try {
      const p = playerApi();
      if (p && typeof p[name] === 'function') return p[name](...args);
    } catch (e) {
      // Player API not ready or changed; callers fall back to the <video> element.
    }
    return undefined;
  }

  function cleanText(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  function textOf(selectors, root = document) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      const t = el && cleanText(el.textContent);
      if (t) return t;
    }
    return '';
  }

  function isVisible(el) {
    return !!el && getComputedStyle(el).display !== 'none';
  }

  function urlParam(name) {
    return new URLSearchParams(location.search).get(name);
  }

  function videoIdFromHref(href) {
    if (!href) return null;
    try {
      return new URL(href, location.origin).searchParams.get('v');
    } catch (e) {
      return null;
    }
  }

  // ---------- State ----------

  function collectQueue(videoId) {
    const listId = urlParam('list');
    if (listId) {
      const panels = [...document.querySelectorAll(S.playlistPanel)];
      const panel = panels.find((p) => p.querySelector(S.playlistItem));
      if (panel) {
        const items = [...panel.querySelectorAll(S.playlistItem)].slice(0, PLAYLIST_LIMIT).map((el, index) => {
          const link = el.querySelector(S.playlistItemLink);
          return {
            index,
            title: textOf(S.playlistItemTitle, el),
            channel: textOf(S.playlistItemChannel, el),
            videoId: videoIdFromHref(link && link.getAttribute('href')),
            current: el.hasAttribute('selected'),
          };
        });
        return { type: 'playlist', title: textOf(S.playlistTitle, panel), items };
      }
    }

    const container = document.querySelector(S.upNextContainer);
    if (!container) return null;
    const items = [];
    for (const el of container.querySelectorAll(S.upNextItem)) {
      const link = el.querySelector(S.upNextLink);
      const id = videoIdFromHref(link && link.getAttribute('href'));
      if (!id || id === videoId) continue;
      const title = textOf(S.upNextTitle, el);
      if (!title) continue;
      items.push({ index: items.length, title, channel: textOf(S.upNextChannel, el), videoId: id, current: false });
      if (items.length >= UPNEXT_LIMIT) break;
    }
    return items.length ? { type: 'upnext', title: 'Up next', items } : null;
  }

  function getQueue(videoId) {
    const key = `${location.href}|${videoId}`;
    const now = Date.now();
    if (key !== queueKey || now - queueAt > QUEUE_REFRESH_MS) {
      queueCache = collectQueue(videoId);
      queueKey = key;
      queueAt = now;
    }
    return queueCache;
  }

  function collectState() {
    const v = video();
    if (!v) return null;

    let data = {};
    try {
      const d = call('getVideoData');
      if (d) data = { title: d.title, author: d.author, videoId: d.video_id };
    } catch (e) {
      // ignore
    }

    const videoId = data.videoId || urlParam('v');
    const title = data.title || textOf(S.title) || document.title.replace(/ - YouTube$/, '');
    if (!videoId && !title) return null;

    const ad = !!document.querySelector(S.adShowing);
    const apiDuration = Number(call('getDuration'));
    const apiTime = Number(call('getCurrentTime'));
    const duration = !ad && apiDuration > 0 ? apiDuration : v.duration || 0;
    const currentTime = !ad && Number.isFinite(apiTime) ? apiTime : v.currentTime || 0;

    const apiVolume = Number(call('getVolume'));
    const apiMuted = call('isMuted');

    const ccBtn = document.querySelector(S.captionsButton);

    return {
      videoId,
      title,
      channel: cleanText(data.author) || textOf(S.channel),
      url: location.href,
      ad,
      playing: !v.paused && !v.ended,
      currentTime: Number.isFinite(currentTime) ? currentTime : 0,
      duration: Number.isFinite(duration) ? duration : 0,
      volume: Number.isFinite(apiVolume) ? apiVolume : Math.round(v.volume * 100),
      muted: typeof apiMuted === 'boolean' ? apiMuted : v.muted,
      rate: v.playbackRate || 1,
      captionsAvailable: isVisible(ccBtn),
      captionsOn: !!ccBtn && ccBtn.getAttribute('aria-pressed') === 'true',
      isPlaylist: !!urlParam('list'),
      lastPlayed,
      queue: getQueue(videoId),
    };
  }

  function send() {
    if (!port) return;
    try {
      port.postMessage({ type: 'state', state: collectState() });
    } catch (e) {
      port = null;
    }
  }

  const sendSoon = (ms = 150) => setTimeout(send, ms);

  // ---------- Commands ----------

  function play() {
    if (has('playVideo')) call('playVideo');
    else video()?.play();
  }

  function pause() {
    if (has('pauseVideo')) call('pauseVideo');
    else video()?.pause();
  }

  function seek(time) {
    if (has('seekTo')) call('seekTo', time, true);
    else if (video()) video().currentTime = time;
  }

  function clickEl(selector) {
    const el = document.querySelector(selector);
    if (el) el.click();
    return !!el;
  }

  function playQueueItem({ index, videoId }) {
    queueKey = ''; // force refresh
    const scope = urlParam('list')
      ? [...document.querySelectorAll(S.playlistPanel)].find((p) => p.querySelector(S.playlistItem))
      : document.querySelector(S.upNextContainer);

    if (videoId && scope) {
      const link = [...scope.querySelectorAll('a[href*="/watch"]')].find(
        (a) => videoIdFromHref(a.getAttribute('href')) === videoId
      );
      if (link) {
        link.click();
        return;
      }
    }
    if (urlParam('list') && has('playVideoAt') && Number.isInteger(index)) {
      call('playVideoAt', index);
      return;
    }
    if (videoId) location.assign(`/watch?v=${encodeURIComponent(videoId)}`);
  }

  function exec(msg) {
    const v = video();
    switch (msg.cmd) {
      case 'togglePlay':
        if (v && v.paused) play();
        else pause();
        break;
      case 'play':
        play();
        break;
      case 'pause':
        pause();
        break;
      case 'next':
        if (has('nextVideo')) call('nextVideo');
        else clickEl(S.nextButton);
        break;
      case 'prev':
        if (v && v.currentTime > 3) seek(0);
        else if (urlParam('list') && has('previousVideo')) call('previousVideo');
        else if (!clickEl(`${S.prevButton}:not([style*="display: none"])`)) history.back();
        break;
      case 'seek':
        if (Number.isFinite(msg.time)) seek(msg.time);
        break;
      case 'setVolume': {
        const vol = Math.max(0, Math.min(100, Math.round(msg.volume)));
        if (has('setVolume')) {
          call('setVolume', vol);
          if (vol > 0 && call('isMuted')) call('unMute');
        } else if (v) {
          v.volume = vol / 100;
          if (vol > 0) v.muted = false;
        }
        break;
      }
      case 'toggleMute':
        if (has('isMuted')) {
          if (call('isMuted')) call('unMute');
          else call('mute');
        } else if (v) {
          v.muted = !v.muted;
        }
        break;
      case 'setRate':
        if (Number.isFinite(msg.rate)) {
          if (has('setPlaybackRate')) call('setPlaybackRate', msg.rate);
          else if (v) v.playbackRate = msg.rate;
        }
        break;
      case 'toggleCaptions':
        clickEl(S.captionsButton);
        break;
      case 'playQueueItem':
        playQueueItem(msg);
        break;
      default:
        return;
    }
    sendSoon();
  }

  // ---------- Wiring ----------

  function connect() {
    try {
      port = browser.runtime.connect({ name: 'yt' });
    } catch (e) {
      port = null; // extension was reloaded or removed
      return;
    }
    port.onMessage.addListener((msg) => {
      if (msg.type === 'cmd') exec(msg);
      else if (msg.type === 'requestState') send();
    });
    port.onDisconnect.addListener(() => {
      port = null;
      // The background event page can be suspended; reconnect to wake it.
      setTimeout(connect, 1000);
    });
    send();
  }

  const isMainVideo = (target) => target instanceof HTMLVideoElement && target === video();

  // Media events don't bubble, but capture-phase listeners on document still see them,
  // and keep working when YouTube swaps the <video> element.
  for (const type of ['play', 'playing']) {
    document.addEventListener(
      type,
      (e) => {
        if (!isMainVideo(e.target)) return;
        lastPlayed = Date.now();
        send();
      },
      true
    );
  }
  for (const type of ['pause', 'ended', 'seeked', 'durationchange', 'loadedmetadata', 'volumechange', 'ratechange']) {
    document.addEventListener(
      type,
      (e) => {
        if (isMainVideo(e.target)) send();
      },
      true
    );
  }
  document.addEventListener(
    'timeupdate',
    (e) => {
      if (!isMainVideo(e.target)) return;
      const now = Date.now();
      if (now - lastTimeSend < TIME_THROTTLE_MS) return;
      lastTimeSend = now;
      send();
    },
    true
  );

  // YouTube is a single-page app; metadata and queue update after navigation.
  document.addEventListener('yt-navigate-finish', () => {
    queueKey = '';
    sendSoon(500);
    sendSoon(2000);
  });

  // Periodic refresh picks up caption-button and queue changes that fire no media events.
  setInterval(() => {
    if (video()) send();
  }, 5000);

  const v = video();
  if (v && !v.paused) lastPlayed = Date.now();
  connect();
})();
