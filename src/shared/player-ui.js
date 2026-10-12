'use strict';

/* global YTMiniSettings */

// The mini player UI: a music-player card plus a Search / Queue panel.
// Used by the popup, sidebar, detached window and the in-page floating card
// (inside a Shadow DOM). Builds its DOM without innerHTML so it also works on
// pages that enforce Trusted Types.
(() => {
  if (globalThis.YTMini && globalThis.YTMini.mountPlayer) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const TICK_MS = 250;
  const SEARCH_DEBOUNCE_MS = 450;

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
    search:
      'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    playNext: 'M3 10h11v2H3zm0-4h11v2H3zm0 8h7v2H3zm13-1v-3h-2v3h-3v2h3v3h2v-3h3v-2z',
    drag: 'M9 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9 16a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
    note: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
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

  // Fill level for Chromium-style range tracks (Firefox uses ::-moz-range-progress).
  function paintRange(range) {
    const max = Number(range.max) || 0;
    const pct = max ? (Number(range.value) / max) * 100 : 0;
    range.style.setProperty('--ytm-pct', `${pct}%`);
  }

  function isTextInput(node) {
    return !!node && (node.tagName === 'TEXTAREA' || (node.tagName === 'INPUT' && /^(text|search)$/.test(node.type)));
  }

  /**
   * Mount a mini player into `root`.
   * opts.compact        smaller card (floating overlay)
   * opts.card           false = panel only, no player card (Zen's media card is the player)
   * opts.zen            identifies the UI embedded in Zen's media card by the Zen mod
   * opts.panelPosition  'below' (popup/window) or 'above' (overlay/sidebar) the card
   * opts.panelAlwaysOpen  panel is always shown (sidebar/window); otherwise toggled from the card
   * opts.panel          initially open panel: 'search' | 'queue' | null
   * opts.footer         footer buttons: 'window' | 'sidebar' | 'settings'
   * opts.keyboard       keyboard shortcuts on the document (extension pages only)
   * opts.onState        callback(state|null) on every state update
   * opts.onPanelChange  callback(panel|null) when the panel opens/closes/switches
   * opts.onEnv          callback({ zenMod }) when the environment changes
   * opts.onFooterAction callback(action) after a footer button is used
   */
  function mountPlayer(root, opts = {}) {
    const o = {
      card: true,
      zen: false,
      compact: false,
      panelPosition: 'below',
      panelAlwaysOpen: false,
      panel: null,
      footer: [],
      keyboard: false,
      ...opts,
    };

    let state = null;
    let queue = { items: [], current: -1 };
    let receivedAt = 0;
    let seeking = false;
    let adjustingVolume = false;
    let panel = o.panelAlwaysOpen ? o.panel || 'search' : o.panel;
    let port = null;
    let destroyed = false;
    let queueRenderKey = '';
    let searchReq = 0;
    let searchTimer = 0;
    let lastQuery = '';
    let flashTimer = 0;
    let dragFrom = -1;

    // =============== Build DOM ===============
    const container = el(
      'div',
      [
        'ytm-player',
        o.compact && 'ytm-compact',
        `ytm-panel-${o.panelPosition}`,
        o.panelAlwaysOpen && 'ytm-panel-fixed',
        !o.card && 'ytm-no-card',
      ]
        .filter(Boolean)
        .join(' ')
    );

    // ----- Card -----
    const card = el('div', 'ytm-card');

    const empty = el('div', 'ytm-empty');
    const emptyIcon = el('div', 'ytm-empty-icon');
    emptyIcon.appendChild(icon('note'));
    const emptyText = el('p', 'ytm-empty-text', { textContent: 'Nothing playing' });
    const emptyActions = el('div', 'ytm-empty-actions');
    const startQueueBtn = el('button', 'ytm-pill ytm-pill-accent', { type: 'button', textContent: 'Play queue' });
    const emptySearchBtn = el('button', 'ytm-pill', { type: 'button', textContent: 'Search' });
    emptyActions.append(startQueueBtn, emptySearchBtn);
    empty.append(emptyIcon, emptyText, emptyActions);

    const now = el('div', 'ytm-now');

    const meta = el('div', 'ytm-meta');
    const metaText = el('div', 'ytm-meta-text');
    const titleBtn = el('button', 'ytm-title', { type: 'button', title: 'Go to the YouTube tab' });
    const titleText = el('span', 'ytm-title-text');
    titleBtn.appendChild(titleText);
    const sub = el('div', 'ytm-sub');
    const adBadge = el('span', 'ytm-ad', { textContent: 'Ad' });
    const channel = el('span', 'ytm-channel');
    sub.append(adBadge, channel);
    metaText.append(titleBtn, sub);
    const focusBtn = iconButton('openTab', 'Go to the YouTube tab', 'ytm-focus');
    meta.append(metaText, focusBtn);

    const blockedNote = el('div', 'ytm-blocked');
    blockedNote.append(
      el('span', '', { textContent: 'Firefox blocked playback in the background tab.' }),
      el('button', 'ytm-link', { type: 'button', textContent: 'Open it once' })
    );

    const progress = el('div', 'ytm-progress');
    const curTime = el('span', 'ytm-time', { textContent: '0:00' });
    const seekBar = el('input', 'ytm-range ytm-seek', { type: 'range', min: '0', max: '0', step: 'any', value: '0' });
    seekBar.setAttribute('aria-label', 'Seek');
    const durTime = el('span', 'ytm-time ytm-time-end', { textContent: '0:00' });
    progress.append(curTime, seekBar, durTime);

    const controls = el('div', 'ytm-controls');
    const prevBtn = iconButton('prev', 'Previous');
    const playBtn = iconButton('play', 'Play', 'ytm-play');
    const nextBtn = iconButton('next', 'Next');
    controls.append(prevBtn, playBtn, nextBtn);

    now.append(meta, blockedNote, progress, controls);

    const toolbar = el('div', 'ytm-toolbar');
    const muteBtn = iconButton('volume', 'Mute');
    const volBar = el('input', 'ytm-range ytm-volume', { type: 'range', min: '0', max: '100', step: '1', value: '100' });
    volBar.setAttribute('aria-label', 'Volume');
    const volGroup = el('div', 'ytm-volume-group');
    volGroup.append(muteBtn, volBar);
    const rateSelect = el('select', 'ytm-rate', { title: 'Playback speed' });
    rateSelect.setAttribute('aria-label', 'Playback speed');
    for (const r of RATES) rateSelect.appendChild(el('option', '', { value: String(r), textContent: `${r}×` }));
    const ccBtn = iconButton('cc', 'Captions', 'ytm-toggle');
    const searchBtn = iconButton('search', 'Search YouTube', 'ytm-toggle ytm-panel-btn');
    searchBtn.dataset.panel = 'search';
    const queueBtn = iconButton('queue', 'Queue', 'ytm-toggle ytm-panel-btn');
    queueBtn.dataset.panel = 'queue';
    const queueCount = el('span', 'ytm-count');
    queueBtn.appendChild(queueCount);
    toolbar.append(volGroup, rateSelect, ccBtn, searchBtn, queueBtn);

    card.append(empty, now, toolbar);

    // ----- Panel -----
    const panelEl = el('div', 'ytm-panel');
    const tabs = el('div', 'ytm-tabs');
    tabs.setAttribute('role', 'tablist');
    const searchTab = el('button', 'ytm-tab', { type: 'button', textContent: 'Search' });
    searchTab.dataset.panel = 'search';
    const queueTab = el('button', 'ytm-tab', { type: 'button' });
    queueTab.dataset.panel = 'queue';
    const queueTabLabel = el('span', '', { textContent: 'Queue' });
    const queueTabCount = el('span', 'ytm-tab-count');
    queueTab.append(queueTabLabel, queueTabCount);
    for (const t of [searchTab, queueTab]) t.setAttribute('role', 'tab');
    tabs.append(searchTab, queueTab);

    // Search view
    const searchView = el('div', 'ytm-view ytm-search-view');
    const searchForm = el('form', 'ytm-search-form');
    const searchIcon = el('span', 'ytm-search-icon');
    searchIcon.appendChild(icon('search'));
    const searchInput = el('input', 'ytm-search-input', {
      type: 'search',
      placeholder: 'Search YouTube',
      autocomplete: 'off',
      spellcheck: false,
    });
    searchInput.setAttribute('aria-label', 'Search YouTube');
    searchForm.append(searchIcon, searchInput);
    const searchStatus = el('div', 'ytm-status');
    searchStatus.setAttribute('aria-live', 'polite');
    const results = el('ol', 'ytm-list ytm-results');
    searchView.append(searchForm, searchStatus, results);

    // Queue view
    const queueView = el('div', 'ytm-view ytm-queue-view');
    const queueHeader = el('div', 'ytm-queue-header');
    const queueSummary = el('span', 'ytm-queue-summary');
    const clearBtn = el('button', 'ytm-link', { type: 'button', textContent: 'Clear' });
    queueHeader.append(queueSummary, clearBtn);
    const queueList = el('ol', 'ytm-list ytm-queue-list');
    const queueEmpty = el('div', 'ytm-status ytm-queue-empty');
    queueEmpty.append(
      el('span', '', { textContent: 'Your queue is empty. ' }),
      el('button', 'ytm-link', { type: 'button', textContent: 'Search for something to add' })
    );
    queueView.append(queueHeader, queueList, queueEmpty);

    panelEl.append(tabs, searchView, queueView);

    // ----- Footer -----
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

    if (o.card) container.append(card);
    container.append(panelEl);
    if (o.footer.length) container.appendChild(footer);
    root.appendChild(container);

    // =============== Messaging ===============
    function connect() {
      if (destroyed) return;
      try {
        port = browser.runtime.connect({ name: 'ui' });
      } catch (e) {
        port = null;
        return;
      }
      port.onMessage.addListener((msg) => {
        if (msg.type === 'state') {
          state = msg.state;
          receivedAt = performance.now();
          render();
          if (o.onState) o.onState(state);
        } else if (msg.type === 'queue') {
          queue = msg.queue;
          renderQueue();
          renderEmpty();
        } else if (msg.type === 'searchResults') {
          if (msg.reqId === searchReq) renderResults(msg);
        } else if (msg.type === 'env') {
          if (o.onEnv) o.onEnv(msg);
        }
      });
      port.onDisconnect.addListener(() => {
        port = null;
        if (!destroyed) setTimeout(connect, 1000);
      });
      post({ type: 'hello', zen: !!o.zen });
    }

    function post(msg) {
      if (!port) return;
      try {
        port.postMessage(msg);
      } catch (e) {
        port = null;
      }
    }

    const send = (cmd, extra) => post({ type: 'cmd', cmd, ...extra });
    const queueOp = (op, extra) => post({ type: 'queue', op, ...extra });

    // =============== Rendering: card ===============
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
      paintRange(seekBar);
    }

    function upcomingCount() {
      return Math.max(0, queue.items.length - queue.current - 1);
    }

    function renderEmpty() {
      const upcoming = upcomingCount();
      startQueueBtn.hidden = !upcoming;
      emptyText.textContent = upcoming ? `${upcoming} in your queue` : 'Nothing playing';
    }

    function render() {
      container.classList.toggle('ytm-has-state', !!state);
      renderEmpty();
      if (!state) return;

      titleText.textContent = state.title || 'Untitled';
      titleBtn.title = state.title || '';
      channel.textContent = state.channel || '';
      adBadge.hidden = !state.ad;
      blockedNote.hidden = !state.blocked;
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
      paintRange(volBar);

      const rate = String(state.rate || 1);
      if (![...rateSelect.options].some((op) => op.value === rate)) {
        rateSelect.appendChild(el('option', '', { value: rate, textContent: `${rate}×` }));
      }
      if (document.activeElement !== rateSelect) rateSelect.value = rate;

      ccBtn.hidden = !state.captionsAvailable;
      ccBtn.setAttribute('aria-pressed', String(!!state.captionsOn));

      // Highlight the queue row that's playing (it may change without a queue update).
      queueRenderKey = '';
      renderQueue();
    }

    function updateMarquee() {
      const overflow = titleText.scrollWidth - titleBtn.clientWidth;
      titleBtn.classList.toggle('ytm-marquee', overflow > 4);
      titleBtn.style.setProperty('--ytm-marquee-shift', `${-Math.max(0, overflow + 16)}px`);
    }

    // =============== Panel ===============
    function setPanel(next) {
      if (o.panelAlwaysOpen && !next) return;
      panel = next;
      container.classList.toggle('ytm-panel-open', !!panel);
      container.dataset.panel = panel || '';
      for (const b of [searchBtn, queueBtn]) b.setAttribute('aria-pressed', String(panel === b.dataset.panel));
      for (const t of [searchTab, queueTab]) t.setAttribute('aria-selected', String(panel === t.dataset.panel));
      if (panel === 'search') requestAnimationFrame(() => searchInput.focus());
      if (panel === 'queue') scrollCurrentIntoView();
      if (o.onPanelChange) o.onPanelChange(panel);
    }

    function togglePanel(name) {
      if (o.panelAlwaysOpen) setPanel(name);
      else setPanel(panel === name ? null : name);
    }

    // =============== Search ===============
    function runSearch(force = false) {
      const q = searchInput.value.trim();
      if (!q) {
        lastQuery = '';
        results.replaceChildren();
        searchStatus.textContent = '';
        return;
      }
      if (q === lastQuery && !force) return;
      lastQuery = q;
      searchReq++;
      searchStatus.textContent = 'Searching…';
      container.classList.add('ytm-searching');
      post({ type: 'search', query: q, reqId: searchReq });
    }

    function renderResults(msg) {
      container.classList.remove('ytm-searching');
      if (msg.error) {
        searchStatus.textContent = `Search failed: ${msg.error}`;
        results.replaceChildren();
        return;
      }
      const list = msg.results || [];
      searchStatus.textContent = list.length ? '' : 'No results';
      results.replaceChildren(...list.map(resultRow));
      results.scrollTop = 0;
    }

    function resultRow(item) {
      const li = el('li', 'ytm-row');
      const main = el('button', 'ytm-row-main', { type: 'button', title: `Play "${item.title}" now` });
      const text = el('span', 'ytm-row-text');
      text.append(
        el('span', 'ytm-row-title', { textContent: item.title }),
        el('span', 'ytm-row-sub', { textContent: [item.channel, item.duration].filter(Boolean).join(' · ') })
      );
      main.appendChild(text);
      main.addEventListener('click', () => {
        queueOp('playNow', { item });
        flash(`Playing "${item.title}"`);
      });

      const actions = el('span', 'ytm-row-actions');
      const nextB = iconButton('playNext', 'Play next', 'ytm-row-btn');
      nextB.addEventListener('click', () => {
        queueOp('playNext', { item });
        flash('Playing next');
      });
      const addB = iconButton('add', 'Add to queue', 'ytm-row-btn');
      addB.addEventListener('click', () => {
        queueOp('add', { item });
        flash('Added to queue');
      });
      actions.append(nextB, addB);
      li.append(main, actions);
      return li;
    }

    function flash(message) {
      searchStatus.textContent = message;
      searchStatus.classList.add('ytm-flash');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        searchStatus.classList.remove('ytm-flash');
        if (searchStatus.textContent === message) searchStatus.textContent = '';
      }, 1800);
    }

    // =============== Queue ===============
    function renderQueue() {
      const upcoming = upcomingCount();
      queueCount.textContent = upcoming ? String(upcoming) : '';
      queueCount.hidden = !upcoming;
      queueTabCount.textContent = upcoming ? String(upcoming) : '';

      const playingId = state && state.videoId;
      const key = `${queue.current}|${playingId}|${queue.items.map((i) => i.uid).join(',')}`;
      if (key === queueRenderKey) return;
      queueRenderKey = key;

      const hasItems = queue.items.length > 0;
      queueEmpty.hidden = hasItems;
      queueHeader.hidden = !hasItems;
      queueSummary.textContent = upcoming ? `${upcoming} up next` : 'End of queue';

      queueList.replaceChildren(...queue.items.map((item, index) => queueRow(item, index, playingId)));
      if (panel === 'queue') scrollCurrentIntoView();
    }

    function queueRow(item, index, playingId) {
      const isCurrent = index === queue.current;
      const played = index < queue.current;
      const li = el(
        'li',
        ['ytm-row', 'ytm-qrow', isCurrent && 'ytm-current', played && 'ytm-played'].filter(Boolean).join(' ')
      );
      li.draggable = true;
      li.dataset.index = String(index);

      const handle = el('span', 'ytm-handle', { title: 'Drag to reorder' });
      handle.appendChild(icon(isCurrent && playingId === item.videoId ? 'play' : 'drag'));

      const main = el('button', 'ytm-row-main', { type: 'button', title: `Play "${item.title}"` });
      const text = el('span', 'ytm-row-text');
      text.append(
        el('span', 'ytm-row-title', { textContent: item.title }),
        el('span', 'ytm-row-sub', { textContent: [item.channel, item.duration].filter(Boolean).join(' · ') })
      );
      main.appendChild(text);
      main.addEventListener('click', () => queueOp('play', { index }));

      const actions = el('span', 'ytm-row-actions');
      const removeB = iconButton('close', 'Remove from queue', 'ytm-row-btn');
      removeB.addEventListener('click', () => queueOp('remove', { index }));
      actions.append(removeB);

      li.append(handle, main, actions);
      return li;
    }

    function scrollCurrentIntoView() {
      const cur = queueList.querySelector('.ytm-current');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    }

    // Drag to reorder
    queueList.addEventListener('dragstart', (e) => {
      const li = e.target.closest && e.target.closest('.ytm-qrow');
      if (!li) return;
      dragFrom = Number(li.dataset.index);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragFrom)); // Firefox needs data to start a drag
      li.classList.add('ytm-dragging');
    });
    queueList.addEventListener('dragover', (e) => {
      if (dragFrom < 0) return;
      const li = e.target.closest && e.target.closest('.ytm-qrow');
      if (!li) return;
      e.preventDefault();
      clearDropMarks();
      const r = li.getBoundingClientRect();
      li.classList.add(e.clientY < r.top + r.height / 2 ? 'ytm-drop-before' : 'ytm-drop-after');
    });
    queueList.addEventListener('drop', (e) => {
      if (dragFrom < 0) return;
      e.preventDefault();
      const li = e.target.closest && e.target.closest('.ytm-qrow');
      if (li) {
        let to = Number(li.dataset.index);
        const r = li.getBoundingClientRect();
        if (e.clientY >= r.top + r.height / 2) to += 1;
        if (dragFrom < to) to -= 1;
        if (to !== dragFrom) queueOp('move', { from: dragFrom, to });
      }
      endDrag();
    });
    queueList.addEventListener('dragend', endDrag);

    function clearDropMarks() {
      for (const n of queueList.querySelectorAll('.ytm-drop-before, .ytm-drop-after')) {
        n.classList.remove('ytm-drop-before', 'ytm-drop-after');
      }
    }

    function endDrag() {
      dragFrom = -1;
      clearDropMarks();
      for (const n of queueList.querySelectorAll('.ytm-dragging')) n.classList.remove('ytm-dragging');
    }

    // =============== Settings ===============
    function applySettings(s) {
      if (footerButtons.window) footerButtons.window.hidden = !s.windowEnabled;
      if (footerButtons.sidebar) footerButtons.sidebar.hidden = !s.sidebarEnabled || !browser.sidebarAction;
    }

    // =============== Events ===============
    startQueueBtn.addEventListener('click', () => send('togglePlay'));
    emptySearchBtn.addEventListener('click', () => setPanel('search'));
    queueEmpty.querySelector('button').addEventListener('click', () => setPanel('search'));
    titleBtn.addEventListener('click', () => send('focusTab'));
    focusBtn.addEventListener('click', () => send('focusTab'));
    blockedNote.querySelector('button').addEventListener('click', () => send('focusTab'));
    playBtn.addEventListener('click', () => send('togglePlay'));
    prevBtn.addEventListener('click', () => send('prev'));
    nextBtn.addEventListener('click', () => send('next'));
    ccBtn.addEventListener('click', () => send('toggleCaptions'));
    muteBtn.addEventListener('click', () => send('toggleMute'));
    clearBtn.addEventListener('click', () => queueOp('clear'));

    for (const b of [searchBtn, queueBtn]) b.addEventListener('click', () => togglePanel(b.dataset.panel));
    for (const t of [searchTab, queueTab]) t.addEventListener('click', () => setPanel(t.dataset.panel));

    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      clearTimeout(searchTimer);
      runSearch(true);
    });
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runSearch(false), SEARCH_DEBOUNCE_MS);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !o.panelAlwaysOpen) setPanel(null);
      e.stopPropagation(); // don't let the host page's shortcuts react to typing
    });
    // Keep typing inside the overlay from triggering the host page's shortcuts.
    for (const type of ['keyup', 'keypress']) searchInput.addEventListener(type, (e) => e.stopPropagation());

    seekBar.addEventListener('input', () => {
      seeking = true;
      curTime.textContent = fmtTime(Number(seekBar.value));
      paintRange(seekBar);
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
      paintRange(volBar);
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
        paintRange(volBar);
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
      if (isTextInput(e.target)) return;
      const tag = (e.target && e.target.tagName) || '';
      if (/^(BUTTON|SELECT)$/.test(tag) && (e.key === ' ' || e.key === 'Enter')) return;
      const actions = {
        ' ': () => send('togglePlay'),
        k: () => send('togglePlay'),
        n: () => send('next'),
        p: () => send('prev'),
        m: () => send('toggleMute'),
        c: () => send('toggleCaptions'),
        '/': () => setPanel('search'),
        q: () => togglePanel('queue'),
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
    YTMiniSettings.get().then(applySettings);

    render();
    renderQueue();
    setPanel(panel);
    connect();

    return {
      element: container,
      get state() {
        return state;
      },
      get queue() {
        return queue;
      },
      setPanel,
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
