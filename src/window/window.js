'use strict';

/* global YTMiniMountPage */

YTMiniMountPage({
  settingKey: 'windowEnabled',
  modeName: 'mini window',
  playerOptions: {
    panelPosition: 'above',
    panelAlwaysOpen: true,
    panel: 'queue',
    footer: ['settings'],
    keyboard: true,
    onState(state) {
      document.title = state ? `${state.playing ? '\u25b6' : '\u275a\u275a'} ${state.title}` : 'YT Mini Player';
    },
  },
});

// Remember the window's size and position for next time. There is no "move"
// event, so position changes are picked up by polling.
let lastBounds = '';
function saveBounds() {
  const bounds = { width: window.outerWidth, height: window.outerHeight, left: window.screenX, top: window.screenY };
  const key = JSON.stringify(bounds);
  if (key === lastBounds) return;
  lastBounds = key;
  browser.storage.local.set({ windowBounds: bounds });
}
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(saveBounds, 300);
});
setInterval(saveBounds, 2000);
