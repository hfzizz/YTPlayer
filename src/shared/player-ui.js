'use strict';

/* global YTMiniSettings */

// The mini player UI. Used by the popup, sidebar, detached window and the
// in-page overlay (inside a Shadow DOM). It builds its DOM without innerHTML,
// so it works on pages that enforce Trusted Types.
(() => {
  if (globalThis.YTMini && globalThis.YTMini.mountPlayer) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const TICK_MS = 250;

  const ICONS = {
    play: 'M8 5v14l11-7z',
    pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
    next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
    prev: 'M6 6h2v12H6zm3.5 6l8.5 6V6z',
    volume:
      'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
    muted:
      'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
    cc: 'M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z',
    queue: 'M3 10h11v2H3zm0-4h11v2H3zm0 8h7v2H3zm13-1v8l6-4z',
    openTab:
      'M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
    window:
      'M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z',
    sidebar: 'M3 4h18v16H3V4zm2 2v12h4V6H5zm6 0v12h8V6h-8z',
    settings:
      'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
    expand: 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z',
    collapse: 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z',
    close:
      'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  };

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.appendChild(path);
    return svg;
  }

  function el(tag, className, props) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (props) Object.assign(node, props);
    return node;
  }

  function iconButton(name, title, className = '') {
    const b = el('button', `ytm-btn ${className}`.trim(), { type: 'button', title });
    b.setAttribute('aria-label', title);
    b.appendChild(icon(name));
    return b;
  }

  function setIcon(button, name) {
    if (button.dataset.icon === name) return;
    button.dataset.icon = name;
    button.replaceChildren(icon(name));
  }

  function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = String(sec % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  /**
   * Mount a mini player into `root`.
   * opts.compact     smaller layout (overlay)
   * opts.footer      array of footer buttons: 'window' | 'sidebar' | 'settings'
   * opts.keyboard    enable keyboard shortcuts on the document (extension pages only)
   * opts.queueOpen   start with the queue expanded
   * opts.onState     callback(state|null) on every state update
   */
  function mountPlayer(root, opts = {}) {
    const o = { compact: false, footer: [], keyboard: false, queueOpen: false, onState: null, ...opts };

    let state = null;
    let receivedAt = 0;
    let seeking = false;
    let adjustingVolume = false;
    let queueOpen = o.queueOpen;
    let queueRenderKey = '';
    let port = null;
    let destroyed = false;
    let settings = null;

    // ----- Build DOM -----
    const container = el('div', `ytm-player${o.compact ? ' ytm-compact' : ''}`);

    const empty = el('div', 'ytm-empty');
    const emptyText = el('p', 'ytm-empty-text', { textContent: 'Nothing playing on YouTube' });
    const openYtBtn = el('button', 'ytm-pill', { type: 'button', textContent: 'Open YouTube' });
    empty.append(emptyText, openYtBtn);

    const main = el('div', 'ytm-main');

    const meta = el('div', 'ytm-meta');
    const titleBtn = el('button', 'ytm-title', { type: 'button', title: 'Go to the YouTube tab' });
    const titleText = el('span', 'ytm-title-text');
    titleBtn.appendChild(titleText);
    const sub = el('div', 'ytm-sub');
    const adBadge = el('span', 'ytm-ad', { textContent: 'Ad' });
    const channel = el('span', 'ytm-channel');
    sub.append(adBadge, channel);
    const focusBtn = iconButton('openTab', 'Go to the YouTube tab', 'ytm-focus');
    meta.append(el('div', 'ytm-meta-text'), focusBtn);
    meta.firstChild.append(titleBtn, sub);

    const progress = el('div', 'ytm-progress');
    const curTime = el('span', 'ytm-time', { textContent: '0:00' });
    const seekBar = el('input', 'ytm-range ytm-seek', { type: 'range', min: '0', max: '0', step: 'any', value: '0' });
    seekBar.setAttribute('aria-label', 'Seek');
    const durTime = el('span', 'ytm-time', { textContent: '0:00' });
    progress.append(curTime, seekBar, durTime);

    const controls = el('div', 'ytm-controls');
    const prevBtn = iconButton('prev', 'Previous');
    const playBtn = iconButton('play', 'Play', 'ytm-play');
    const nextBtn = iconButton('next', 'Next');
    controls.append(prevBtn, playBtn, nextBtn);

    const secondary = el('div', 'ytm-secondary');
    const muteBtn = iconButton('volume', 'Mute');
    const volBar = el('input', 'ytm-range ytm-volume', { type: 'range', min: '0', max: '100', step: '1', value: '100' });
    volBar.setAttribute('aria-label', 'Volume');
    const volGroup = el('div', 'ytm-volume-group');
    volGroup.append(muteBtn, volBar);
    const rateSelect = el('select', 'ytm-rate', { title: 'Playback speed' });
    rateSelect.setAttribute('aria-label', 'Playback speed');
    for (const r of RATES) rateSelect.appendChild(el('option', '', { value: String(r), textContent: `${r}\u00d7` }));
    const ccBtn = iconButton('cc', 'Captions', 'ytm-toggle');
    const queueBtn = iconButton('queue', 'Queue', 'ytm-toggle');
    secondary.append(volGroup, rateSelect, ccBtn, queueBtn);

    const queue = el('div', 'ytm-queue');
    const queueHeader = el('div', 'ytm-queue-header');
    const queueList = el('ol', 'ytm-queue-list');
    queue.append(queueHeader, queueList);

    main.append(meta, progress, controls, secondary, queue);

    const footer = el('div', 'ytm-footer');
    const footerButtons = {};
    const FOOTER_DEFS = {
      window: ['window', 'Open mini window'],
      sidebar: ['sidebar', 'Open in sidebar'],
      settings: ['settings', 'Settings'],
    };
    for (const key of o.footer) {
      if (!FOOTER_DEFS[key]) continue;
      const [iconName, label] = FOOTER_DEFS[key];
      const b = iconButton(iconName, label, 'ytm-footer-btn');
      b.dataset.action = key;
      footerButtons[key] = b;
      footer.appendChild(b);
    }

    container.append(empty, main);
    if (o.footer.length) container.appendChild(footer);
    root.appendChild(container);

    // ----- Messaging -----
    function connect() {
      if (destroyed) return;
      try {
        port = browser.runtime.connect({ name: 'ui' });
      } catch (e) {
        port = null;
        return;
      }
      port.onMessage.addListener((msg) => {
        if (msg.type !== 'state') return;
        state = msg.state;
        receivedAt = performance.now();
        render();
        if (o.onState) o.onState(state);
      });
      port.onDisconnect.addListener(() => {
        port = null;
        if (!destroyed) setTimeout(connect, 1000);
      });
    }

    function send(cmd, extra) {
      if (!port) return;
      try {
        port.postMessage({ type: 'cmd', cmd, ...extra });
      } catch (e) {
        port = null;
      }
    }

    // ----- Rendering -----
    function liveTime() {
      if (!state) return 0;
      let t = state.currentTime;
      if (state.playing) t += ((performance.now() - receivedAt) / 1000) * (state.rate || 1);
      return state.duration ? Math.min(t, state.duration) : t;
    }

    function renderProgress() {
      if (!state || seeking) return;
      const t = liveTime();
      curTime.textContent = fmtTime(t);
      seekBar.value = String(t);
    }

    function render() {
      container.classList.toggle('ytm-has-state', !!state);
      if (!state) return;

      titleText.textContent = state.title || 'Untitled';
      titleBtn.title = state.title || '';
      channel.textContent = state.channel || '';
      adBadge.hidden = !state.ad;
      requestAnimationFrame(updateMarquee);

      seekBar.max = String(state.duration || 0);
      seekBar.disabled = !state.duration || state.ad;
      durTime.textContent = fmtTime(state.duration);
      renderProgress();

      setIcon(playBtn, state.playing ? 'pause' : 'play');
      playBtn.title = state.playing ? 'Pause' : 'Play';
      playBtn.setAttribute('aria-label', playBtn.title);

      setIcon(muteBtn, state.muted || state.volume === 0 ? 'muted' : 'volume');
      muteBtn.title = state.muted ? 'Unmute' : 'Mute';
      if (!adjustingVolume) volBar.value = String(state.muted ? 0 : state.volume);

      const rate = String(state.rate || 1);
      if (![...rateSelect.options].some((op) => op.value === rate)) {
        rateSelect.appendChild(el('option', '', { value: rate, textContent: `${rate}\u00d7` }));
      }
      if (document.activeElement !== rateSelect) rateSelect.value = rate;

      ccBtn.hidden = !state.captionsAvailable;
      ccBtn.setAttribute('aria-pressed', String(!!state.captionsOn));

      renderQueue();
    }

    function updateMarquee() {
      const overflow = titleText.scrollWidth - titleBtn.clientWidth;
      titleBtn.classList.toggle('ytm-marquee', overflow > 4);
      titleBtn.style.setProperty('--ytm-marquee-shift', `${-Math.max(0, overflow + 16)}px`);
    }

    function renderQueue() {
      const q = state && state.queue;
      queueBtn.hidden = !q || !q.items.length;
      queueBtn.setAttribute('aria-pressed', String(queueOpen && !queueBtn.hidden));
      container.classList.toggle('ytm-queue-open', queueOpen && !queueBtn.hidden);
      if (!q) return;

      const key = `${q.type}|${q.items.map((i) => `${i.videoId}${i.current ? '*' : ''}`).join(',')}`;
      if (key === queueRenderKey) return;
      queueRenderKey = key;

      const current = q.items.findIndex((i) => i.current);
      queueHeader.textContent =
        q.type === 'playlist'
          ? `${q.title || 'Playlist'}${current >= 0 ? ` \u00b7 ${current + 1}/${q.items.length}` : ''}`
          : 'Up next';

      const rows = q.items.map((item) => {
        const li = el('li', `ytm-queue-item${item.current ? ' ytm-current' : ''}`);
        const b = el('button', 'ytm-queue-btn', { type: 'button' });
        const idx = el('span', 'ytm-queue-index', {
          textContent: item.current ? '\u25b6' : q.type === 'playlist' ? String(item.index + 1) : '',
        });
        const text = el('span', 'ytm-queue-text');
        text.append(
          el('span', 'ytm-queue-title', { textContent: item.title }),
          el('span', 'ytm-queue-channel', { textContent: item.channel })
        );
        b.append(idx, text);
        b.title = item.title;
        b.addEventListener('click', () =>
          send('playQueueItem', { index: item.index, videoId: item.videoId, queueType: q.type })
        );
        li.appendChild(b);
        return li;
      });
      queueList.replaceChildren(...rows);
      if (queueOpen) scrollCurrentIntoView();
    }

    function scrollCurrentIntoView() {
      const cur = queueList.querySelector('.ytm-current');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    }

    function applySettings(s) {
      settings = s;
      if (footerButtons.window) footerButtons.window.hidden = !s.windowEnabled;
      if (footerButtons.sidebar) footerButtons.sidebar.hidden = !s.sidebarEnabled || !browser.sidebarAction;
    }

    // ----- Events -----
    openYtBtn.addEventListener('click', () => send('openYouTube'));
    titleBtn.addEventListener('click', () => send('focusTab'));
    focusBtn.addEventListener('click', () => send('focusTab'));
    playBtn.addEventListener('click', () => send('togglePlay'));
    prevBtn.addEventListener('click', () => send('prev'));
    nextBtn.addEventListener('click', () => send('next'));
    ccBtn.addEventListener('click', () => send('toggleCaptions'));
    muteBtn.addEventListener('click', () => send('toggleMute'));

    queueBtn.addEventListener('click', () => {
      queueOpen = !queueOpen;
      renderQueue();
      if (queueOpen) scrollCurrentIntoView();
    });

    seekBar.addEventListener('input', () => {
      seeking = true;
      curTime.textContent = fmtTime(Number(seekBar.value));
    });
    seekBar.addEventListener('change', () => {
      const time = Number(seekBar.value);
      send('seek', { time });
      if (state) {
        state.currentTime = time;
        receivedAt = performance.now();
      }
      seeking = false;
    });

    volBar.addEventListener('input', () => {
      adjustingVolume = true;
      send('setVolume', { volume: Number(volBar.value) });
    });
    volBar.addEventListener('change', () => {
      adjustingVolume = false;
    });
    volBar.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const v = Math.max(0, Math.min(100, Number(volBar.value) + (e.deltaY < 0 ? 5 : -5)));
        volBar.value = String(v);
        send('setVolume', { volume: v });
      },
      { passive: false }
    );

    rateSelect.addEventListener('change', () => {
      send('setRate', { rate: Number(rateSelect.value) });
      rateSelect.blur();
    });

    footer.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      const action = b.dataset.action;
      if (action === 'sidebar') {
        // Must be called synchronously inside the click handler (user gesture).
        if (browser.sidebarAction) browser.sidebarAction.open();
      } else if (action === 'window') {
        send('openWindow');
      } else if (action === 'settings') {
        send('openOptions');
      }
      if (o.onFooterAction) o.onFooterAction(action);
    });

    function onKeyDown(e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) && e.key !== ' ') return;
      if (/^(BUTTON|SELECT)$/.test(tag) && (e.key === ' ' || e.key === 'Enter')) return;
      const actions = {
        ' ': () => send('togglePlay'),
        k: () => send('togglePlay'),
        n: () => send('next'),
        p: () => send('prev'),
        m: () => send('toggleMute'),
        c: () => send('toggleCaptions'),
        ArrowRight: () => state && send('seek', { time: liveTime() + 5 }),
        ArrowLeft: () => state && send('seek', { time: Math.max(0, liveTime() - 5) }),
      };
      const fn = actions[e.key];
      if (!fn) return;
      e.preventDefault();
      fn();
    }
    if (o.keyboard) document.addEventListener('keydown', onKeyDown);

    const ticker = setInterval(() => {
      if (state && state.playing) renderProgress();
    }, TICK_MS);

    const unsubscribe = YTMiniSettings.onChange(applySettings);
    YTMiniSettings.get().then((s) => {
      applySettings(s);
      if (!('queueOpen' in opts) && s.queueOpenByDefault) {
        queueOpen = true;
        renderQueue();
      }
    });

    render();
    connect();

    return {
      element: container,
      get state() {
        return state;
      },
      get settings() {
        return settings;
      },
      destroy() {
        destroyed = true;
        clearInterval(ticker);
        unsubscribe();
        if (o.keyboard) document.removeEventListener('keydown', onKeyDown);
        if (port) port.disconnect();
        container.remove();
      },
    };
  }

  globalThis.YTMini = { mountPlayer, icon, fmtTime };
})();
