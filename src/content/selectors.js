'use strict';

// Every YouTube DOM selector lives here. YouTube changes its markup often;
// when something stops working, this is the first file to update.
// Lists are tried in order and the first match with text wins.
globalThis.YTMiniSelectors = {
  player: '#movie_player',
  video: '#movie_player video.html5-main-video, video.html5-main-video',
  adShowing: '#movie_player.ad-showing',

  title: ['ytd-watch-metadata h1 yt-formatted-string', 'ytd-watch-metadata h1', '#title h1'],
  channel: [
    'ytd-watch-metadata ytd-channel-name a',
    '#owner ytd-channel-name a',
    '#upload-info #channel-name a',
  ],

  captionsButton: '.ytp-subtitles-button',
  nextButton: '.ytp-next-button',

  // "Cancel" on the end-of-video autoplay countdown.
  autonavCancel: '.ytp-autonav-endscreen-upnext-cancel-button',
};
