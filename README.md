# YT Mini Player (Firefox / Zen)

A PiP-style **music player for regular YouTube**. It's a floating card that stays on top of the website you're reading. You can search YouTube, build your own queue and control playback without going back to the YouTube tab.

<p>
  <img src="docs/floating-card.png" width="49%" alt="Floating player card on a website">
  <img src="docs/floating-card-search.png" width="49%" alt="Searching YouTube from the floating card">
</p>
<p>
  <img src="docs/popup-queue.png" width="32%" alt="Toolbar popup with the queue">
  <img src="docs/sidebar.png" width="25%" alt="Zen-style sidebar player">
</p>

## Features

- **Floating player card on every website.** Drag it anywhere, collapse it to one slim row, or hide it until the next song. It shows the title and channel only, with no video.
- **Search YouTube from the player.** Each result can be:
  - played now (click the row)
  - played next
  - added to the end of the queue (+)
- **Your own queue:**
  - drag to reorder, × to remove
  - saved between sessions
  - stops when it runs out
  - played songs stay visible, dimmed
- **Plays in the background.** If no YouTube tab is open, one is opened (pinned by default) to do the actual playing. It's shown for a moment, because Firefox won't start audio in a tab that was never visited, and then you're switched back.
- **Zen Browser and media keys.** Next/previous in Zen's built-in media player, and your keyboard's media keys, skip through **your queue**.
- **Controls:** seek, play/pause, previous/next, volume and mute, speed from 0.25× to 2×, captions.
- **Other places to use it:**
  - toolbar popup
  - Firefox/Zen sidebar (queue on top, player at the bottom)
  - detached window

  Each one can be turned on or off in the settings.
- **Toolbar badge:** shows ▶ / ❚❚ on the extension icon.
- **Global shortcuts** (rebind them in `about:addons` → ⚙ → *Manage Extension Shortcuts*):
  - `Alt+Shift+P`: play / pause
  - `Alt+Shift+→` / `Alt+Shift+←`: next / previous
  - `Alt+Shift+M`: open the mini window
- **Keys inside the popup, sidebar and window:**
  - `Space`/`K`: play/pause
  - `N` / `P`: next / previous
  - `M`: mute
  - `C`: captions
  - `←`/`→`: seek 5 seconds
  - `/`: search
  - `Q`: queue

## Install (development)

1. In Firefox or Zen, open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select `manifest.json` in this folder.
3. The settings page opens. Click **Grant access** so the floating player can appear on websites.
4. Click the toolbar icon, search for something, and press a result to play it.

Or, with Node.js installed:

```sh
npm install
npm start        # launches Firefox with the extension loaded (web-ext run)
npm test         # queue engine + search parser unit tests
npm run lint     # web-ext lint
npm run build    # zip into web-ext-artifacts/
```

Requires Firefox 128 or later, or a Zen version based on it.

## How it works

```
YouTube tab (plays the audio)        background.js                         UIs
┌──────────────────────┐  port "yt"  ┌──────────────────────┐  port "ui"  ┌───────────────────────┐
│ content/youtube.js   │ ──state──▶  │ queue engine         │ ──state──▶  │ floating card /       │
│ player API, <video>, │ ──ended──▶  │ (storage.local)      │ ──queue──▶  │ popup / sidebar /     │
│ Media Session        │ ◀──load───  │ search (search.js)   │ ◀─search──  │ window                │
│                      │ ◀──cmds───  │ opens player tab     │ ◀──cmds───  │ (shared/player-ui.js) │
└──────────────────────┘             └──────────────────────┘             └───────────────────────┘
```

- **Search** (`src/search.js`) calls YouTube's own web search API from the background page, falling back to parsing the results page. Results are video-only.
- **Queue** (`src/background.js`): when a song ends, the YouTube tab reports it, the extension cancels YouTube's autoplay countdown and loads the next queued video. It uses YouTube's in-page navigation, so there's no reload. With nothing left in the queue, playback stops.
- **Zen / media keys:** the YouTube-tab script takes over the page's Media Session next/previous handlers while your queue is active.
- `src/content/selectors.js` holds every YouTube DOM selector. If something stops working after a YouTube update, look there first.

## Permissions

| Permission | Why |
| --- | --- |
| `*://*.youtube.com/*` | Control the YouTube player and search YouTube |
| `tabs` | Open, find and focus the player tab and the mini window |
| `storage` | Settings, queue, card and window position |
| `scripting` | Register the floating player on websites |
| `<all_urls>` (optional) | Only for the floating player on other websites |

## Known limits

- Firefox doesn't let extensions create a real always-on-top window, so the floating card stays on top inside the browser, not over other apps.
- The extension can't add a search box or queue to Zen's own media player. That's Zen's interface. It can only make Zen's next/previous buttons follow your queue.
- If Firefox still blocks audio in the player tab, the card shows a notice. Open the tab once, or allow autoplay for youtube.com using the permissions icon in the address bar.
