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
  prevButton: '.ytp-prev-button',

  // Playlist panel (watch page with &list=...). It can exist twice; we use the one with items.
  playlistPanel: 'ytd-playlist-panel-renderer',
  playlistItem: 'ytd-playlist-panel-video-renderer',
  playlistTitle: ['#header-description h3 a', '#header-description .title', '.header .title', 'h3 yt-formatted-string'],
  playlistItemTitle: ['#video-title'],
  playlistItemChannel: ['#byline', '#channel-name'],
  playlistItemLink: 'a#wc-endpoint, a[href*="/watch"]',

  // "Up next" recommendations in the watch-page sidebar (new lockup + legacy compact renderer).
  upNextContainer: 'ytd-watch-next-secondary-results-renderer',
  upNextItem: 'yt-lockup-view-model, ytd-compact-video-renderer',
  upNextTitle: ['.yt-lockup-metadata-view-model__title', '#video-title', 'h3'],
  upNextChannel: [
    '.yt-content-metadata-view-model__metadata-row span',
    'ytd-channel-name #text',
    '#channel-name',
  ],
  upNextLink: 'a[href*="/watch?v="]',
};
