'use strict';

/* global YTMini, YTMiniSettings */

const ALL_SITES = { origins: ['<all_urls>'] };

YTMini.mountPlayer(document.getElementById('root'), {
  panel: 'search',
  footer: ['floating', 'window', 'sidebar', 'settings'],
  keyboard: true,
  // Opening another view from the popup makes the popup redundant.
  onFooterAction: (action) => {
    if (action !== 'floating') window.close();
  },
});

// The floating card needs the optional "all websites" permission. Offer it here,
// since permissions can only be requested from a click.
(async () => {
  const settings = await YTMiniSettings.get();
  if (!settings.overlayEnabled || (await browser.permissions.contains(ALL_SITES))) return;
  const banner = document.createElement('div');
  banner.className = 'ytm-banner';
  const text = document.createElement('span');
  text.textContent = 'Allow the floating player to appear on other websites.';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ytm-pill';
  btn.textContent = 'Allow';
  btn.addEventListener('click', () => {
    browser.permissions.request(ALL_SITES).then((granted) => {
      if (granted) banner.remove();
    });
  });
  banner.append(text, btn);
  document.body.prepend(banner);
})();
