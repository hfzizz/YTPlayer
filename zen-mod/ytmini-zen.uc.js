// ==UserScript==
// @name           YT Mini Player for Zen
// @description    Adds Search and Queue from the YT Mini Player extension to Zen's media card.
// @author         hfzizz
// @version        0.1.0
// @include        main
// ==/UserScript==

// Zen mod (userChrome script, loaded by Sine or fx-autoconfig).
//
// Zen's media card (#zen-media-controls-toolbar, cloned from
// #zen-media-card-template) is part of the browser UI, which extensions can't
// touch. This script adds two buttons to each card. Clicking one grows the card
// upwards and shows the YT Mini Player extension's Search / Queue panel inside
// it. The panel is an extension page (src/zen/panel.html) in an embedded
// <browser>, so all the logic stays in the extension; this file only does UI
// plumbing. Next/previous on the card already follow the extension's queue via
// the Media Session API.

(function () {
  'use strict';

  if (window.__ytMiniZen) return;
  window.__ytMiniZen = true;

  const EXTENSION_ID = 'yt-mini-player@hfzizz';
  const PANEL_PATH = 'src/zen/panel.html';
  const FALLBACK_PATH = 'src/window/window.html';
  const OPEN_ATTR = 'ytmini-open';
  const POLICY_POLL_MS = 3000;

  const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');

  let toolbar = null;
  let policy = null;
  let presence = null; // hidden extension page: tells the extension the mod is active
  let embedFailed = false;

  // ---------- Extension pages inside chrome ----------

  // Same setup Firefox uses for extension popups / sidebar panels: a remote
  // browser in the extension process, registered with the WebExtension API
  // manager so the page gets the `browser.*` APIs.
  function createExtensionBrowser(parent, url) {
    const b = document.createXULElement('browser');
    const remote = WebExtensionPolicy.useRemoteWebExtensions;
    b.setAttribute('type', 'content');
    b.setAttribute('disableglobalhistory', 'true');
    b.setAttribute('messagemanagergroup', 'webext-browsers');
    b.setAttribute('webextension-view-type', 'sidebar');
    b.setAttribute('transparent', 'true');
    b.setAttribute('flex', '1');
    if (remote) {
      b.setAttribute('remote', 'true');
      b.setAttribute('remoteType', typeof E10SUtils !== 'undefined' ? E10SUtils.EXTENSION_REMOTE_TYPE : 'extension');
      b.setAttribute('maychangeremoteness', 'true');
    }
    b.setAttribute('initialBrowsingContextGroupId', String(policy.browsingContextGroupId));
    parent.appendChild(b);
    ExtensionParent.apiManager.emit('extension-browser-inserted', b);
    b.fixupAndLoadURIString(url, { triggeringPrincipal: policy.extension.principal });
    return b;
  }

  function currentPolicy() {
    const p = WebExtensionPolicy.getByID(EXTENSION_ID);
    return p && p.active && p.extension ? p : null;
  }

  // Track the extension being installed, enabled, disabled or reloaded.
  function refreshPolicy() {
    const p = currentPolicy();
    if (p === policy) return;
    policy = p;
    toolbar.toggleAttribute('ytmini-missing', !policy);
    if (presence) {
      presence.remove();
      presence = null;
    }
    // Panels from a previous extension instance are dead; drop them.
    for (const card of toolbar.querySelectorAll(`.zen-media-card[${OPEN_ATTR}]`)) closeCard(card);
    for (const slot of toolbar.querySelectorAll('.ytmini-zen-slot')) slot.replaceChildren();
    if (!policy) return;
    try {
      const holder = document.createXULElement('vbox');
      holder.className = 'ytmini-zen-presence';
      document.documentElement.appendChild(holder);
      presence = holder;
      createExtensionBrowser(holder, `${policy.getURL(PANEL_PATH)}?presence=1`);
      embedFailed = false;
    } catch (e) {
      console.error('YT Mini (Zen mod): could not embed the extension page', e);
      embedFailed = true;
    }
  }

  // ---------- Card patching ----------

  function makeButton(view, label) {
    const b = document.createXULElement('toolbarbutton');
    b.className = `ytmini-zen-${view} toolbarbutton-1`;
    b.setAttribute('tooltiptext', label);
    b.setAttribute('aria-label', label);
    b.dataset.ytminiView = view;
    return b;
  }

  // Adds our buttons + panel slot to a card (or to the card template).
  function patch(root) {
    const controls = root.querySelector('.zen-media-controls-hbox');
    const main = root.querySelector('.zen-media-main-vbox');
    if (!controls || !main || controls.querySelector('.ytmini-zen-search')) return;
    const group = document.createXULElement('hbox');
    group.className = 'ytmini-zen-buttons';
    group.append(makeButton('search', 'Search YouTube'), makeButton('queue', 'Queue'));
    const mute = controls.querySelector('.zen-media-mute-button');
    controls.insertBefore(group, mute ? mute.nextSibling : null);
    const slot = document.createXULElement('vbox');
    slot.className = 'ytmini-zen-slot';
    main.insertBefore(slot, main.firstChild);
  }

  function panelUrl(card, view) {
    const cs = getComputedStyle(card);
    const params = new URLSearchParams({ fg: cs.color, accent: accentColor(), bg: backgroundOf(card) });
    return `${policy.getURL(PANEL_PATH)}?${params}#${view}`;
  }

  function accentColor() {
    const probe = document.createXULElement('box');
    probe.style.color = 'var(--zen-primary-color, #ff0033)';
    document.documentElement.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }

  function backgroundOf(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(bg)) return bg;
    }
    return 'transparent';
  }

  function openCard(card, view) {
    for (const other of toolbar.querySelectorAll(`.zen-media-card[${OPEN_ATTR}]`)) {
      if (other !== card) closeCard(other);
    }
    const slot = card.querySelector('.ytmini-zen-slot');
    let b = slot.querySelector('browser');
    if (!b) b = createExtensionBrowser(slot, panelUrl(card, view));
    else b.fixupAndLoadURIString(`${b.currentURI.spec.split('#')[0]}#${view}`, {
      triggeringPrincipal: policy.extension.principal,
    }); // same-document hash change: switches the panel view
    card.setAttribute(OPEN_ATTR, view);
    syncButtons(card);
  }

  function closeCard(card) {
    card.removeAttribute(OPEN_ATTR);
    syncButtons(card);
  }

  function syncButtons(card) {
    const open = card.getAttribute(OPEN_ATTR);
    for (const b of card.querySelectorAll('[data-ytmini-view]')) {
      b.toggleAttribute('checked', b.dataset.ytminiView === open);
    }
  }

  function onCommand(event) {
    const button = event.target.closest && event.target.closest('[data-ytmini-view]');
    if (!button) return;
    event.stopPropagation();
    refreshPolicy();
    if (!policy) return;
    if (embedFailed) {
      // Embedding isn't possible in this build: open the full player in a tab instead.
      gBrowser.selectedTab = gBrowser.addTab(policy.getURL(FALLBACK_PATH), {
        triggeringPrincipal: policy.extension.principal,
      });
      return;
    }
    const card = button.closest('.zen-media-card');
    const view = button.dataset.ytminiView;
    if (card.getAttribute(OPEN_ATTR) === view) closeCard(card);
    else openCard(card, view);
  }

  // ---------- Startup ----------

  function init() {
    toolbar = document.getElementById('zen-media-controls-toolbar');
    const template = document.getElementById('zen-media-card-template');
    if (!toolbar || !template) return false;

    patch(template.content);
    for (const card of toolbar.querySelectorAll('.zen-media-card')) patch(card);
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.classList.contains('zen-media-card')) patch(n);
        }
      }
    }).observe(toolbar, { childList: true, subtree: true });

    // Capture phase: handle our buttons before Zen's card handler sees the event.
    toolbar.addEventListener('command', onCommand, true);

    refreshPolicy();
    setInterval(refreshPolicy, POLICY_POLL_MS);
    return true;
  }

  function start() {
    if (init()) return;
    // Zen's media controls may be created a little after the window loads.
    let tries = 0;
    const timer = setInterval(() => {
      if (init() || ++tries > 20) clearInterval(timer);
    }, 500);
  }

  if (typeof gBrowserInit !== 'undefined' && gBrowserInit.delayedStartupFinished) start();
  else {
    const observer = (subject, topic) => {
      if (topic === 'browser-delayed-startup-finished' && subject === window) {
        Services.obs.removeObserver(observer, topic);
        start();
      }
    };
    Services.obs.addObserver(observer, 'browser-delayed-startup-finished');
  }
})();
