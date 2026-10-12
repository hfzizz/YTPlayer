'use strict';

/* global YTMini, YTMiniSettings */

// Mounts the player in an extension page (sidebar / mini window) when its mode
// is enabled in settings, or shows a notice pointing to the settings otherwise.
// Re-evaluates live when settings change.
globalThis.YTMiniMountPage = function mountPage({ settingKey, modeName, playerOptions }) {
  const root = document.getElementById('root');
  let player = null;
  let notice = null;

  function showNotice() {
    if (notice) return;
    notice = document.createElement('div');
    notice.className = 'ytm-notice';
    const p = document.createElement('p');
    p.textContent = `The ${modeName} is turned off in the settings.`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ytm-pill';
    btn.textContent = 'Open settings';
    btn.addEventListener('click', () => browser.runtime.openOptionsPage());
    notice.append(p, btn);
    root.appendChild(notice);
  }

  function apply(settings) {
    if (settings[settingKey]) {
      if (notice) {
        notice.remove();
        notice = null;
      }
      if (!player) player = YTMini.mountPlayer(root, playerOptions);
    } else {
      if (player) {
        player.destroy();
        player = null;
      }
      showNotice();
    }
  }

  YTMiniSettings.get().then(apply);
  YTMiniSettings.onChange(apply);
};
