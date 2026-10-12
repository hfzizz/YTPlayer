'use strict';

/* global YTMini, YTMiniSettings */

// Floating mini player injected into non-YouTube pages (only when the overlay
// mode is enabled). Lives in a closed Shadow DOM so page CSS can't touch it.
(() => {
  if (globalThis.__ytMiniOverlay || window.top !== window) return;
  globalThis.__ytMiniOverlay = true;

  const MARGIN = 16;
  const POS_KEY = 'overlayPos';
  const COLLAPSED_KEY = 'overlayCollapsed';

  let settings = null;
  let host = null;
  let wrap = null;
  let player = null;
  let hasState = false;
  let dismissedVideoId = null;
  let currentVideoId = null;
  let placed = false;
  let cssLink = null;

  function build() {
    host = document.createElement('ytmini-overlay');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:0;top:0;display:none;';
    const shadow = host.attachShadow({ mode: 'closed' });

    const link = (cssLink = document.createElement('link'));
    link.rel = 'stylesheet';
    link.href = browser.runtime.getURL('src/shared/player.css');
    shadow.appendChild(link);

    wrap = document.createElement('div');
    wrap.className = 'ytm-overlay';

    const bar = document.createElement('div');
    bar.className = 'ytm-overlay-bar';
    const label = document.createElement('span');
    label.className = 'ytm-overlay-label';
    label.textContent = 'YT Mini';
    const collapseBtn = barButton('collapse', 'Collapse');
    const closeBtn = barButton('close', 'Hide until the next video');
    bar.append(label, collapseBtn, closeBtn);

    const body = document.createElement('div');
    wrap.append(bar, body);
    shadow.appendChild(wrap);
    (document.body || document.documentElement).appendChild(host);

    player = YTMini.mountPlayer(body, { compact: true, footer: ['window', 'settings'], onState });

    collapseBtn.addEventListener('click', () => setCollapsed(!wrap.classList.contains('ytm-collapsed'), true));
    closeBtn.addEventListener('click', () => {
      dismissedVideoId = currentVideoId;
      updateVisibility();
    });
    setupDrag(bar);

    // Avoid a flash of unstyled content: only reveal once the stylesheet has loaded.
    link.addEventListener('load', () => {
      link.dataset.loaded = '1';
      updateVisibility();
    });

    browser.storage.local.get(COLLAPSED_KEY).then((r) => {
      const collapsed = typeof r[COLLAPSED_KEY] === 'boolean' ? r[COLLAPSED_KEY] : settings.overlayStartCollapsed;
      setCollapsed(collapsed, false);
    });

    function barButton(iconName, title) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ytm-btn';
      b.title = title;
      b.setAttribute('aria-label', title);
      b.appendChild(YTMini.icon(iconName));
      return b;
    }

    function setCollapsed(collapsed, persist) {
      wrap.classList.toggle('ytm-collapsed', collapsed);
      collapseBtn.replaceChildren(YTMini.icon(collapsed ? 'expand' : 'collapse'));
      collapseBtn.title = collapsed ? 'Expand' : 'Collapse';
      collapseBtn.setAttribute('aria-label', collapseBtn.title);
      if (persist) browser.storage.local.set({ [COLLAPSED_KEY]: collapsed });
      requestAnimationFrame(() => clampAndApply(currentPos()));
    }

  }

  function teardown() {
    if (player) player.destroy();
    if (host) host.remove();
    host = wrap = player = cssLink = null;
    placed = false;
  }

  function onState(state) {
    hasState = !!state;
    currentVideoId = state ? state.videoId : null;
    if (dismissedVideoId && dismissedVideoId !== currentVideoId) dismissedVideoId = null;
    updateVisibility();
  }

  function updateVisibility() {
    if (!host) return;
    const visible = hasState && !dismissedVideoId && cssLink.dataset.loaded === '1';
    host.style.display = visible ? 'block' : 'none';
    if (visible && !placed) {
      placed = true;
      browser.storage.local.get(POS_KEY).then((r) => {
        clampAndApply(r[POS_KEY] || cornerPos());
      });
    }
  }

  // ----- Positioning -----

  function size() {
    const r = host.getBoundingClientRect();
    return { w: r.width || 320, h: r.height || 200 };
  }

  function cornerPos() {
    const { w, h } = size();
    const corner = (settings && settings.overlayCorner) || 'bottom-right';
    return {
      x: corner.endsWith('left') ? MARGIN : window.innerWidth - w - MARGIN,
      y: corner.startsWith('top') ? MARGIN : window.innerHeight - h - MARGIN,
    };
  }

  function currentPos() {
    return { x: parseFloat(host.style.left) || 0, y: parseFloat(host.style.top) || 0 };
  }

  function clampAndApply(pos) {
    if (!host) return;
    const { w, h } = size();
    const x = Math.max(0, Math.min(pos.x, window.innerWidth - w));
    const y = Math.max(0, Math.min(pos.y, window.innerHeight - h));
    host.style.left = `${x}px`;
    host.style.top = `${y}px`;
  }

  function setupDrag(handle) {
    let start = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const pos = currentPos();
      start = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
      handle.setPointerCapture(e.pointerId);
      wrap.classList.add('ytm-dragging');
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!start) return;
      clampAndApply({ x: start.x + e.clientX - start.px, y: start.y + e.clientY - start.py });
    });
    const end = () => {
      if (!start) return;
      start = null;
      wrap.classList.remove('ytm-dragging');
      browser.storage.local.set({ [POS_KEY]: currentPos() });
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  window.addEventListener('resize', () => {
    if (host && placed) clampAndApply(currentPos());
  });

  // Keep every tab's overlay in the same spot when it is moved in another tab.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !host) return;
    if (changes[POS_KEY] && changes[POS_KEY].newValue && placed) clampAndApply(changes[POS_KEY].newValue);
  });

  // ----- Settings -----

  function apply(s) {
    const cornerChanged = settings && s.overlayCorner !== settings.overlayCorner;
    settings = s;
    if (!s.overlayEnabled) {
      teardown();
      return;
    }
    if (!host) build();
    else if (cornerChanged && placed) clampAndApply(cornerPos());
  }

  YTMiniSettings.get().then(apply);
  YTMiniSettings.onChange(apply);
})();
