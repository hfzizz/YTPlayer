'use strict';

/* global YTMini */

YTMini.mountPlayer(document.getElementById('root'), {
  footer: ['window', 'sidebar', 'settings'],
  keyboard: true,
  // Opening another view from the popup makes the popup redundant.
  onFooterAction: () => window.close(),
});
