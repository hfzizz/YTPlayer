# YT Mini Player (Firefox)

A mini player for **regular YouTube**, in the spirit of "YTM Mini", which does the same for YouTube Music.

The extension doesn't play any audio or video itself. It works as a **remote control** for a normal youtube.com tab. The video keeps playing in that tab (it can be in the background), and the mini player shows what's on and lets you control it from anywhere.

## Features

- **Four player modes.** Turn each one on or off in the settings:
  - **Toolbar popup**: click the extension icon.
  - **Sidebar**: Firefox's sidebar (View → Sidebar → YT Mini Player).
  - **Detached mini window**: a small window you can place anywhere. It remembers its size and position.
  - **Floating overlay**: a draggable, collapsible player on every non-YouTube site while something is playing. It's off by default because it needs access to all websites.
- **What it shows:** title and channel (no video or thumbnail), seek bar, play/pause, previous/next, volume and mute, playback speed (0.25×–2×) and a captions toggle.
- **Queue:** the current playlist, or YouTube's "Up next" list. Click an item to play it.
- **Which tab it controls:** a tab that's playing right now, otherwise the one that played most recently.
- **Toolbar badge:** shows ▶ / ❚❚ on the icon, and the tooltip shows the current title.
- **Global keyboard shortcuts** (you can rebind them in `about:addons` → ⚙ → *Manage Extension Shortcuts*):
  - `Alt+Shift+P`: play / pause
  - `Alt+Shift+→` / `Alt+Shift+←`: next / previous
  - `Alt+Shift+M`: open the mini window
- **Keys inside the popup, sidebar and window:** `Space`/`K` play/pause, `N` next, `P` previous, `M` mute, `C` captions, `←`/`→` seek 5 seconds.

## Install (development)

1. In Firefox, open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select `manifest.json` in this folder.
3. Play something on youtube.com, then click the toolbar icon.

Or, with Node.js installed:

```sh
npm install
npm start        # launches Firefox with the extension loaded (web-ext run)
npm run lint     # web-ext lint
npm run build    # zip into web-ext-artifacts/
```

Requires Firefox 128 or later.

## How it works

```
youtube.com tab                     background.js                     UIs
┌──────────────────────┐  port "yt"  ┌──────────────────┐  port "ui"  ┌─────────────────────┐
│ content/youtube.js   │ ──state──▶  │ picks active tab │ ──state──▶  │ popup / sidebar /   │
│ reads <video> +      │             │ relays + badge + │             │ window / overlay    │
│ YouTube player API   │ ◀──cmds───  │ shortcuts        │ ◀──cmds───  │ (shared/player-ui)  │
└──────────────────────┘             └──────────────────┘             └─────────────────────┘
```

- `src/content/youtube.js` watches the main `<video>` element's events and YouTube's own player API (`movie_player`) to build a state object. It runs commands (play, seek, volume, next, and so on) through the same API, falling back to the `<video>` element or YouTube's buttons.
- `src/content/selectors.js` holds **every** YouTube DOM selector. YouTube changes its markup often, so if titles or the queue stop showing up, look here first.
- `src/shared/player-ui.js` and `player.css` are the single UI shared by all four modes. The overlay mounts it inside a closed Shadow DOM so page styles can't affect it.
- The overlay content script is registered dynamically (`scripting.registerContentScripts`) only when the overlay is enabled and the "all websites" permission is granted.

## Permissions

| Permission | Why |
| --- | --- |
| `*://*.youtube.com/*` | Read and control the YouTube player |
| `tabs` | Find and focus the YouTube tab and the mini window |
| `storage` | Settings, overlay and window position |
| `scripting` | Register the overlay on other sites |
| `<all_urls>` (optional) | Only requested when you turn on the floating overlay |
