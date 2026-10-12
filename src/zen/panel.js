'use strict';

/* global YTMini */

// Search / Queue panel shown inside Zen's own media card by the Zen mod
// (zen-mod/ytmini-zen.uc.js). Zen's card is the player, so no card here.
//
// The mod passes Zen's colours in the query string (?bg=&fg=&accent=) so the
// panel blends into the card, and picks the view with the hash (#search, #queue).

const params = new URLSearchParams(location.search);

// ?presence=1: hidden page the mod keeps loaded so the extension knows the mod is
// active (it then hides the floating card). No UI, just the connection.
if (params.get('presence') === '1') {
  const connect = () => {
    const port = browser.runtime.connect({ name: 'ui' });
    port.postMessage({ type: 'hello', zen: true });
    port.onDisconnect.addListener(() => setTimeout(connect, 1000));
  };
  connect();
} else {
  mountPanel();
}

function mountPanel() {
  const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/i;
  for (const [param, cssVar] of [
    ['bg', '--ytm-zen-bg'],
    ['fg', '--ytm-zen-fg'],
    ['accent', '--ytm-zen-accent'],
  ]) {
    const value = params.get(param);
    if (value && COLOR_RE.test(value.trim())) document.documentElement.style.setProperty(cssVar, value.trim());
  }

  const panelFromHash = () => (location.hash === '#queue' ? 'queue' : 'search');

  const player = YTMini.mountPlayer(document.getElementById('root'), {
    card: false,
    zen: true,
    panelAlwaysOpen: true,
    panel: panelFromHash(),
    keyboard: true,
  });

  window.addEventListener('hashchange', () => player.setPanel(panelFromHash()));
}
