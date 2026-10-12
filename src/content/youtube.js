'use strict';

/* global cloneInto */

// Runs inside youtube.com tabs. Reads the player's state, reports it to the
// background, and carries out commands sent from the mini player UIs.
(() => {
  if (globalThis.__ytMiniYouTube) return;
  globalThis.__ytMiniYouTube = true;

  const S = globalThis.YTMiniSelectors;
  const TIME_THROTTLE_MS = 1000;
  const LOAD_VERIFY_MS = 3000;
  const BLOCKED_AFTER_MS = 4000;

  let port = null;
  let lastPlayed = 0;
  let lastTimeSend = 0;
  let queueActive = false; // set by the background: our queue decides what plays next
  let wantPlaySince = 0; // when we asked for playback; used to detect autoplay blocking
  let blocked = false;

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

  function currentVideoId() {
    try {
      const d = call('getVideoData');
      if (d && d.video_id) return d.video_id;
    } catch (e) {
      // ignore
    }
    return urlParam('v');
  }

  // ---------- State ----------

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
    const playing = !v.paused && !v.ended;
    if (playing) {
      blocked = false;
      wantPlaySince = 0;
    } else if (wantPlaySince && Date.now() - wantPlaySince > BLOCKED_AFTER_MS) {
      blocked = true;
    }

    return {
      videoId,
      title,
      channel: cleanText(data.author) || textOf(S.channel),
      url: location.href,
      ad,
      playing,
      blocked,
      currentTime: Number.isFinite(currentTime) ? currentTime : 0,
      duration: Number.isFinite(duration) ? duration : 0,
      volume: Number.isFinite(apiVolume) ? apiVolume : Math.round(v.volume * 100),
      muted: typeof apiMuted === 'boolean' ? apiMuted : v.muted,
      rate: v.playbackRate || 1,
      captionsAvailable: isVisible(ccBtn),
      captionsOn: !!ccBtn && ccBtn.getAttribute('aria-pressed') === 'true',
      lastPlayed,
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

  function notify(msg) {
    if (!port) return;
    try {
      port.postMessage(msg);
    } catch (e) {
      port = null;
    }
  }

  // ---------- Commands ----------

  function play() {
    wantPlaySince = Date.now();
    if (has('playVideo')) call('playVideo');
    else video()?.play();
  }

  function pause() {
    wantPlaySince = 0;
    blocked = false;
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

  // Switch to another video without reloading the page (keeps playback allowed
  // in this tab). Uses YouTube's own in-app navigation; if that doesn't take
  // effect, falls back to a normal page load.
  function loadVideo(videoId) {
    if (!/^[\w-]{6,20}$/.test(videoId)) return;
    wantPlaySince = Date.now();
    const app = document.querySelector('ytd-app');
    if (app) {
      const detail = {
        endpoint: {
          commandMetadata: {
            webCommandMetadata: { url: `/watch?v=${videoId}`, webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 },
          },
          watchEndpoint: { videoId },
        },
      };
      const pageDetail = typeof cloneInto === 'function' ? cloneInto(detail, window) : detail;
      app.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: pageDetail }));
      setTimeout(() => {
        if (currentVideoId() !== videoId) location.assign(`/watch?v=${videoId}`);
      }, LOAD_VERIFY_MS);
    } else {
      location.assign(`/watch?v=${videoId}`);
    }
  }

  // At the end of a video YouTube counts down to an autoplay video. When our
  // queue is in charge, cancel that so we can load the next queued item (or stop).
  function cancelAutoplay() {
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      clickEl(S.autonavCancel);
      if (tries >= 10) clearInterval(timer);
    }, 150);
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
        else history.back();
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
      case 'load':
        loadVideo(msg.videoId);
        break;
      case 'stopAutoplay':
        cancelAutoplay();
        break;
      default:
        return;
    }
    sendSoon();
  }

  // ---------- Media Session (Zen's media player, media keys, OS controls) ----------

  // YouTube sets its own next/previous handlers for every video. While our queue
  // is active we take them over so those buttons follow the queue instead.
  function claimMediaSession() {
    const ms = navigator.mediaSession;
    if (!ms || !queueActive) return;
    try {
      ms.setActionHandler('nexttrack', () => notify({ type: 'action', action: 'next' }));
      ms.setActionHandler('previoustrack', () => notify({ type: 'action', action: 'prev' }));
    } catch (e) {
      // Not supported; media keys keep YouTube's behaviour.
    }
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
      else if (msg.type === 'config') {
        queueActive = !!msg.queueActive;
        claimMediaSession();
      } else if (msg.type === 'requestState') send();
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
        // Re-claim after YouTube re-registers its handlers for the new video.
        setTimeout(claimMediaSession, 500);
      },
      true
    );
  }
  document.addEventListener(
    'ended',
    (e) => {
      if (!isMainVideo(e.target) || document.querySelector(S.adShowing)) return;
      send();
      if (queueActive) cancelAutoplay();
      notify({ type: 'ended', videoId: currentVideoId() });
    },
    true
  );
  for (const type of ['pause', 'seeked', 'durationchange', 'loadedmetadata', 'volumechange', 'ratechange']) {
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

  // YouTube is a single-page app; metadata updates after navigation.
  document.addEventListener('yt-navigate-finish', () => {
    sendSoon(500);
    sendSoon(2000);
    setTimeout(claimMediaSession, 1000);
  });

  // Periodic refresh picks up caption-button changes (no media event) and
  // re-asserts the media session handlers.
  setInterval(() => {
    if (!video()) return;
    send();
    claimMediaSession();
  }, 5000);

  const v = video();
  if (v && !v.paused) lastPlayed = Date.now();
  connect();
})();
