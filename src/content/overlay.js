'use strict';

/* global YTMini, YTMiniSettings */

// Floating "PiP-style" music player card injected into non-YouTube pages (only
// when enabled). Lives in a closed Shadow DOM so page CSS can't touch it.
//
// - Closing it (✕) hides it in every tab until it's reopened from the toolbar
//   popup, the keyboard shortcut or the settings page (storage.local.overlayClosed).
// - It can be resized freely from any edge or corner. Its layout follows its
//   size: tiny (play button + title), slim (one row) or the full card, and when
//   it's tall the search / queue panel fills the extra space.
// - Position and size are shared by all tabs.
(() => {
  if (globalThis.__ytMiniOverlay || window.top !== window) return;
  globalThis.__ytMiniOverlay = true;

  const MARGIN = 16;
  const POS_KEY = 'overlayPos';
  const SIZE_KEY = 'overlaySize'; // { w, h } or null for the natural size
  const FULL_SIZE_KEY = 'overlayFullSize'; // size to restore when expanding from slim
  const CLOSED_KEY = 'overlayClosed';
  const MIN_W = 48; // just enough to stay visible and grabbable
  const MIN_H = 40;
  const TINY_W = 170; // narrower than this: just a play button + title
  const TINY_H = 52; // shorter than this: same
  const SLIM_H = 150;
  const SLIM_SNAP_H = 64; // height the collapse button snaps to
  const WIDE_W = 420; // slim bar wide enough for an inline progress bar
  const PANEL_ROOM = 200; // free height that makes the panel open by itself
  const RESIZE_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

  let settings = null;
  let host = null;
  let wrap = null;
  let player = null;
  let cssLink = null;
  let collapseBtn = null;
  let resizeObserver = null;
  let closed = false;
  let size = null;
  let placed = false;
  let lastRect = null;
  let zenMod = false; // Zen's media card has our search/queue (Zen mod active)
  let autoPanel = false; // the panel was opened because the card got tall
  let panelDismissedAt = null; // size at which the user closed the panel (don't auto-reopen)
  let mode = 'full';

  function build() {
    host = document.createElement('ytmini-overlay');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:0;top:0;display:none;';
    const shadow = host.attachShadow({ mode: 'closed' });

    cssLink = document.createElement('link');
    cssLink.rel = 'stylesheet';
    cssLink.href = browser.runtime.getURL('src/shared/player.css');
    shadow.appendChild(cssLink);

    wrap = document.createElement('div');
    wrap.className = 'ytm-overlay';

    const bar = document.createElement('div');
    bar.className = 'ytm-overlay-bar';
    bar.title = 'Drag to move';
    const grip = document.createElement('span');
    grip.className = 'ytm-grip';
    collapseBtn = barButton('collapse', 'Collapse');
    const closeBtn = barButton('close', 'Close (reopen from the toolbar button or Alt+Shift+F)');
    bar.append(grip, collapseBtn, closeBtn);

    const body = document.createElement('div');
    body.className = 'ytm-overlay-body';
    wrap.append(bar, body);
    for (const dir of RESIZE_DIRS) {
      const handle = document.createElement('div');
      handle.className = `ytm-resize ytm-resize-${dir}`;
      handle.dataset.dir = dir;
      wrap.appendChild(handle);
    }
    shadow.appendChild(wrap);
    (document.body || document.documentElement).appendChild(host);

    player = YTMini.mountPlayer(body, {
      compact: true,
      panelPosition: 'above',
      footer: [],
      onState: updateVisibility,
      onEnv: (env) => {
        zenMod = !!env.zenMod;
        updateVisibility();
      },
      onPanelChange: (panel) => {
        if (!panel) {
          if (!autoPanel) return;
          autoPanel = false;
          panelDismissedAt = sizeKey();
        }
      },
    });
    // The queue arrives separately from the player state.
    const poll = setInterval(() => {
      if (!player) return clearInterval(poll);
      updateVisibility();
    }, 1000);

    collapseBtn.addEventListener('click', toggleCollapse);
    closeBtn.addEventListener('click', () => browser.storage.local.set({ [CLOSED_KEY]: true }));
    setupDrag(bar);
    setupResize();

    // Mode follows size; also keep the edge nearest the screen edge fixed when the
    // card grows or shrinks (e.g. opening Search at the bottom grows it upwards).
    resizeObserver = new ResizeObserver(() => {
      updateMode();
      if (!placed || host.style.display === 'none') return;
      const rect = host.getBoundingClientRect();
      if (lastRect && rect.height !== lastRect.height && !wrap.classList.contains('ytm-resizing')) {
        const anchoredBottom = lastRect.top + lastRect.height / 2 > window.innerHeight / 2;
        if (anchoredBottom) clampAndApply({ x: rect.left, y: lastRect.bottom - rect.height });
        else clampAndApply({ x: rect.left, y: rect.top });
      }
      lastRect = host.getBoundingClientRect();
    });
    resizeObserver.observe(wrap);

    // Avoid a flash of unstyled content: only reveal once the stylesheet has loaded.
    cssLink.addEventListener('load', () => {
      cssLink.dataset.loaded = '1';
      updateVisibility();
    });

    browser.storage.local.get([SIZE_KEY, CLOSED_KEY, 'overlayCollapsed']).then((r) => {
      closed = !!r[CLOSED_KEY];
      let saved = r[SIZE_KEY] || null;
      // First run with "start collapsed": begin as the slim bar.
      if (!saved && settings.overlayStartCollapsed && r.overlayCollapsed === undefined) {
        saved = { w: 300, h: SLIM_SNAP_H };
      }
      setSize(saved, false);
      updateVisibility();
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
  }

  function teardown() {
    if (resizeObserver) resizeObserver.disconnect();
    if (player) player.destroy();
    if (host) host.remove();
    host = wrap = player = cssLink = resizeObserver = lastRect = collapseBtn = null;
    placed = false;
  }

  // Shown while something is loaded in a YouTube tab or queued, unless the user
  // closed it (in any tab) or Zen's own media card has taken over.
  function updateVisibility() {
    if (!host || !player) return;
    const q = player.queue;
    const hasContent = !!player.state || (q && q.upNext && q.upNext.length > 0);
    const replacedByZen = zenMod && settings.hideCardWithZenMod;
    const visible = hasContent && !closed && !replacedByZen && cssLink.dataset.loaded === '1';
    host.style.display = visible ? 'block' : 'none';
    if (visible && !placed) {
      placed = true;
      browser.storage.local.get(POS_KEY).then((r) => {
        clampAndApply(r[POS_KEY] || cornerPos());
        lastRect = host.getBoundingClientRect();
      });
    }
  }

  // ----- Size & responsive mode -----

  function setSize(next, persist) {
    size = next && next.w && next.h ? { w: Math.round(next.w), h: Math.round(next.h) } : null;
    if (!wrap) return;
    wrap.classList.toggle('ytm-sized', !!size);
    wrap.style.width = size ? `${size.w}px` : '';
    wrap.style.height = size ? `${size.h}px` : '';
    if (persist) browser.storage.local.set({ [SIZE_KEY]: size });
    updateMode();
  }

  function updateMode() {
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const w = size ? size.w : r.width;
    const h = size ? size.h : r.height;
    if (!w || !h) return; // hidden: nothing to measure yet
    const next = w < TINY_W || h < TINY_H ? 'tiny' : h < SLIM_H ? 'slim' : 'full';
    if (next !== mode) {
      mode = next;
      if (mode !== 'full' && player) player.setPanel(null);
    }
    wrap.classList.toggle('ytm-mode-tiny', mode === 'tiny');
    wrap.classList.toggle('ytm-mode-slim', mode === 'slim');
    wrap.classList.toggle('ytm-mode-full', mode === 'full');
    wrap.classList.toggle('ytm-wide', w >= WIDE_W);
    if (collapseBtn) {
      const collapsed = mode !== 'full';
      collapseBtn.replaceChildren(YTMini.icon(collapsed ? 'expand' : 'collapse'));
      collapseBtn.title = collapsed ? 'Expand' : 'Collapse to a slim bar';
      collapseBtn.setAttribute('aria-label', collapseBtn.title);
    }
    autoOpenPanel();
  }

  // A tall full card has room for the queue / search: open it to fill the space.
  function autoOpenPanel() {
    if (!player || mode !== 'full' || !size) return;
    const card = player.element.querySelector('.ytm-card');
    const bar = wrap.querySelector('.ytm-overlay-bar');
    const room = size.h - (card ? card.offsetHeight : 0) - (bar ? bar.offsetHeight : 0) - 24;
    const open = player.element.dataset.panel;
    if (room >= PANEL_ROOM && !open && panelDismissedAt !== sizeKey()) {
      player.setPanel('queue');
      autoPanel = true;
    } else if (room < PANEL_ROOM / 2 && open && autoPanel) {
      autoPanel = false;
      player.setPanel(null);
    }
  }

  function sizeKey() {
    return size ? `${size.w}x${size.h}` : 'auto';
  }

  async function toggleCollapse() {
    if (mode === 'full') {
      const r = wrap.getBoundingClientRect();
      await browser.storage.local.set({ [FULL_SIZE_KEY]: size, overlayCollapsed: true });
      setSize({ w: Math.max(TINY_W, r.width), h: SLIM_SNAP_H }, true);
    } else {
      const { [FULL_SIZE_KEY]: full } = await browser.storage.local.get(FULL_SIZE_KEY);
      await browser.storage.local.set({ overlayCollapsed: false });
      setSize(full && full.h >= SLIM_H ? full : null, true);
    }
  }

  // ----- Positioning -----

  function rectSize() {
    const r = host.getBoundingClientRect();
    return { w: r.width || 340, h: r.height || 200 };
  }

  function cornerPos() {
    const { w, h } = rectSize();
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
    const { w, h } = rectSize();
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
      lastRect = host.getBoundingClientRect();
      browser.storage.local.set({ [POS_KEY]: currentPos() });
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  // Resize from any edge or corner. Dragging the top/left edges moves the card too.
  function setupResize() {
    let start = null;
    wrap.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest && e.target.closest('.ytm-resize');
      if (!handle || e.button !== 0) return;
      const r = wrap.getBoundingClientRect();
      start = { dir: handle.dataset.dir, px: e.clientX, py: e.clientY, x: r.left, y: r.top, w: r.width, h: r.height };
      handle.setPointerCapture(e.pointerId);
      wrap.classList.add('ytm-resizing');
      e.preventDefault();
      e.stopPropagation();
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.px;
      const dy = e.clientY - start.py;
      let { x, y, w, h } = start;
      if (start.dir.includes('e')) w = Math.min(start.w + dx, window.innerWidth - start.x);
      if (start.dir.includes('s')) h = Math.min(start.h + dy, window.innerHeight - start.y);
      if (start.dir.includes('w')) {
        w = Math.min(start.w - dx, start.x + start.w);
        x = start.x + start.w - Math.max(w, MIN_W);
      }
      if (start.dir.includes('n')) {
        h = Math.min(start.h - dy, start.y + start.h);
        y = start.y + start.h - Math.max(h, MIN_H);
      }
      setSize({ w: Math.max(MIN_W, w), h: Math.max(MIN_H, h) }, false);
      host.style.left = `${Math.max(0, x)}px`;
      host.style.top = `${Math.max(0, y)}px`;
    });
    const end = () => {
      if (!start) return;
      start = null;
      wrap.classList.remove('ytm-resizing');
      lastRect = host.getBoundingClientRect();
      browser.storage.local.set({ [SIZE_KEY]: size, [POS_KEY]: currentPos() });
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
  }

  window.addEventListener('resize', () => {
    if (host && placed) clampAndApply(currentPos());
  });

  // Keep every tab's card in sync: position, size and closed state.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[CLOSED_KEY]) {
      closed = !!changes[CLOSED_KEY].newValue;
      updateVisibility();
    }
    if (!host) return;
    if (changes[SIZE_KEY] && !wrap.classList.contains('ytm-resizing')) setSize(changes[SIZE_KEY].newValue, false);
    if (changes[POS_KEY] && changes[POS_KEY].newValue && placed) {
      clampAndApply(changes[POS_KEY].newValue);
      lastRect = host.getBoundingClientRect();
    }
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
    updateVisibility();
  }

  YTMiniSettings.get().then(apply);
  YTMiniSettings.onChange(apply);
})();
