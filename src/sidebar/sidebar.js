'use strict';

/* global YTMiniMountPage */

// Zen-style: search / queue fill the sidebar, the player card sits at the bottom.
YTMiniMountPage({
  settingKey: 'sidebarEnabled',
  modeName: 'sidebar',
  playerOptions: {
    panelPosition: 'above',
    panelAlwaysOpen: true,
    panel: 'queue',
    footer: ['window', 'settings'],
    keyboard: true,
  },
});
