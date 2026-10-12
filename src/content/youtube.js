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
  const EARLY_ADVANCE_S = 0.35; // switch just before the end, so YouTube's end screen never shows
  const ENSURE_PLAY_MS = 1500;
  const FADE_STEPS_PER_S = 20;
  const SILENCE_WINDOW_S = 20; // only look for trailing silence this close to the end
  const SILENCE_RMS = 0.004;
  const SILENCE_HOLD_MS = 1500;
  const RESTORE_VOLUME_KEY = 'ytmini-restore-volume';

  let port = null;
  let lastPlayed = 0;
  let lastTimeSend = 0;
  let queueActive = false; // set by the background: our queue decides what plays next
  let upNextAvailable = false; // a queued song follows the current one
  let crossfadeSeconds = 0;
  let skipSilence = false;
  let advancedFor = null; // videoId we already reported as finished
  let fade = null; // { timer, kind: 'out' | 'in' }
  let expectedVolume = null; // the volume we last set while fading
  let audio = null; // skip-silence analyser: object, or false when unavailable
  let silentSince = 0;
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
      ended: !!v.ended,
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
    ensurePlaying(videoId);
  }

  // YouTube sometimes leaves the new video paused (e.g. after an end screen).
  // Nudge it once or twice so the queue keeps flowing.
  function ensurePlaying(videoId) {
    for (const delay of [ENSURE_PLAY_MS, ENSURE_PLAY_MS * 2]) {
      setTimeout(() => {
        const v = video();
        if (v && v.paused && currentVideoId() === videoId && !document.querySelector(S.adShowing)) play();
      }, delay);
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

  // ---------- Transitions between queued songs ----------

  function getVolume() {
    const v = Number(call('getVolume'));
    if (Number.isFinite(v)) return v;
    const el = video();
    return el ? Math.round(el.volume * 100) : 100;
  }

  function setVolumeQuiet(vol) {
    expectedVolume = Math.round(vol);
    if (has('setVolume')) call('setVolume', expectedVolume);
    else if (video()) video().volume = expectedVolume / 100;
  }

  function stopFade() {
    if (fade) clearInterval(fade.timer);
    fade = null;
    expectedVolume = null;
  }

  // The volume to return to after a fade, and the video that was faded out.
  // Kept in sessionStorage so it survives a full page load of the next video.
  function savedFade() {
    try {
      const raw = sessionStorage.getItem(RESTORE_VOLUME_KEY);
      if (!raw) return null;
      const { volume, from } = JSON.parse(raw);
      return Number.isFinite(volume) ? { volume, from } : null;
    } catch (e) {
      return null;
    }
  }

  function savedRestoreVolume() {
    const f = savedFade();
    return f ? f.volume : null;
  }

  function setRestoreVolume(vol) {
    try {
      if (vol === null) sessionStorage.removeItem(RESTORE_VOLUME_KEY);
      else sessionStorage.setItem(RESTORE_VOLUME_KEY, JSON.stringify({ volume: vol, from: currentVideoId() }));
    } catch (e) {
      // ignore
    }
  }

  // Ramp the volume from its current level to `target` over `seconds`.
  function rampVolume(kind, target, seconds, onDone) {
    stopFade();
    const from = getVolume();
    const steps = Math.max(1, Math.round(seconds * FADE_STEPS_PER_S));
    let i = 0;
    fade = {
      kind,
      timer: setInterval(() => {
        i++;
        setVolumeQuiet(from + ((target - from) * i) / steps);
        if (i >= steps) {
          stopFade();
          if (onDone) onDone();
        }
      }, 1000 / FADE_STEPS_PER_S),
    };
  }

  // Tell the background this song is done (once per video), so it starts the next one.
  function advance() {
    const id = currentVideoId();
    if (!id || advancedFor === id) return;
    advancedFor = id;
    silentSince = 0;
    notify({ type: 'ended', videoId: id });
  }

  // Skip-silence: an analyser on the video's audio. Only hooked up while the
  // audio context is running, so it can never silence playback.
  function audioLevel() {
    if (audio === false) return null;
    const el = video();
    if (!el) return null;
    try {
      if (!audio || audio.el !== el) {
        const ctx = audio ? audio.ctx : new AudioContext();
        if (ctx.state !== 'running') {
          if (!audio) ctx.close();
          audio = false;
          return null;
        }
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        const source = ctx.createMediaElementSource(el);
        source.connect(analyser);
        analyser.connect(ctx.destination);
        audio = { ctx, analyser, el, buf: new Float32Array(analyser.fftSize) };
      }
      audio.analyser.getFloatTimeDomainData(audio.buf);
      let sum = 0;
      for (const x of audio.buf) sum += x * x;
      return Math.sqrt(sum / audio.buf.length);
    } catch (e) {
      audio = false;
      return null;
    }
  }

  // Runs on every timeupdate of the main video.
  function onProgress() {
    const v = video();
    if (!v || !queueActive || document.querySelector(S.adShowing)) return;
    const id = currentVideoId();
    const duration = Number(call('getDuration')) || v.duration;
    const time = Number(call('getCurrentTime'));
    const current = Number.isFinite(time) ? time : v.currentTime;
    if (!(duration > 0)) return;
    const remaining = duration - current;
    if (advancedFor === id) {
      // Replayed or seeked back after we switched: allow switching again.
      if (remaining > Math.max(crossfadeSeconds, 1) + 2) advancedFor = null;
      else return;
    }

    // Fade out into the next queued song.
    if (upNextAvailable && crossfadeSeconds > 0 && !v.paused) {
      if (remaining <= crossfadeSeconds && !(fade && fade.kind === 'out')) {
        const saved = savedFade();
        setRestoreVolume(saved && saved.from === id ? saved.volume : getVolume());
        rampVolume('out', 0, Math.max(0.2, remaining - EARLY_ADVANCE_S));
      } else if (fade && fade.kind === 'out' && remaining > crossfadeSeconds + 1) {
        // The user seeked back: undo the fade.
        stopFade();
        const restore = savedRestoreVolume();
        if (restore !== null) setVolumeQuiet(restore);
        setRestoreVolume(null);
        expectedVolume = null;
      }
    }

    if (upNextAvailable && remaining <= EARLY_ADVANCE_S) {
      advance();
      return;
    }

    if (skipSilence && remaining <= SILENCE_WINDOW_S && remaining > EARLY_ADVANCE_S && !v.paused) {
      const level = audioLevel();
      if (level === null || level > SILENCE_RMS) {
        silentSince = 0;
      } else if (!silentSince) {
        silentSince = Date.now();
      } else if (Date.now() - silentSince >= SILENCE_HOLD_MS) {
        advance();
      }
    }
  }

  // A new video started: fade back in to the volume from before the fade-out.
  function onNewVideoPlaying() {
    const saved = savedFade();
    if (!saved || saved.from === currentVideoId()) return; // still the song we faded out
    const restore = saved.volume;
    if (fade && fade.kind === 'in') return;
    setRestoreVolume(null);
    stopFade();
    setVolumeQuiet(0);
    rampVolume('in', restore, Math.max(0.5, crossfadeSeconds / 2));
  }

  // The user moved the volume while we were fading: stop and keep their choice.
  function onVolumeChange() {
    if (!fade || expectedVolume === null) return;
    if (Math.abs(getVolume() - expectedVolume) > 2) {
      stopFade();
      setRestoreVolume(null);
    }
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
        upNextAvailable = !!msg.upNextAvailable;
        crossfadeSeconds = Math.max(0, Math.min(12, Number(msg.crossfadeSeconds) || 0));
        skipSilence = !!msg.skipSilence;
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
        if (e.type === 'playing' && advancedFor && advancedFor !== currentVideoId()) advancedFor = null;
        if (e.type === 'playing' && !document.querySelector(S.adShowing)) onNewVideoPlaying();
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
      advance();
    },
    true
  );
  document.addEventListener(
    'volumechange',
    (e) => {
      if (isMainVideo(e.target)) onVolumeChange();
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
      onProgress();
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
