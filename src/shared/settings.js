'use strict';

// Shared settings helper. Loaded as a classic script in the background,
// extension pages and content scripts, so it exposes a global.
(() => {
  const DEFAULTS = {
    popupEnabled: true,
    overlayEnabled: true, // still needs the optional "all websites" permission
    sidebarEnabled: true,
    windowEnabled: true,
    clickAction: 'popup', // 'popup' | 'window'
    overlayStartCollapsed: false,
    overlayCorner: 'bottom-right', // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    badgeEnabled: true,
    pinPlayerTab: true, // pin the YouTube tab the extension opens for playback
  };

  const api = {
    DEFAULTS,

    async get() {
      const stored = await browser.storage.sync.get(DEFAULTS);
      return { ...DEFAULTS, ...stored };
    },

    set(patch) {
      return browser.storage.sync.set(patch);
    },

    // Calls cb(settings) whenever any setting changes. Returns an unsubscribe fn.
    onChange(cb) {
      const listener = (changes, area) => {
        if (area !== 'sync') return;
        if (!Object.keys(changes).some((k) => k in DEFAULTS)) return;
        api.get().then(cb);
      };
      browser.storage.onChanged.addListener(listener);
      return () => browser.storage.onChanged.removeListener(listener);
    },
  };

  globalThis.YTMiniSettings = api;
})();
