// Unit tests for the queue engine (src/background.js) and search parser
// (src/search.js), run in Node with a mocked `browser` API: npm test
import fs from 'node:fs';
import vm from 'node:vm';
const REPO = new URL('../', import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL:', m); } };
const tick = () => new Promise(r => setTimeout(r, 20));
const ev = () => { const l = []; return { addListener: f => l.push(f), removeListener() {}, fire: (...a) => l.map(f => f(...a)) }; };

// ---------- search parser ----------
{
  const ctx = vm.createContext({ globalThis: undefined, fetch: null, navigator: { language: 'en' }, decodeURIComponent, encodeURIComponent, JSON, console });
  ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(REPO + 'src/search.js', 'utf8'), ctx);
  const sample = { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [
    { itemSectionRenderer: { contents: [
      { adSlotRenderer: { videoRenderer: { videoId: 'AD', title: { runs: [{ text: 'ad' }] } } } },
      { videoRenderer: { videoId: 'v1', title: { runs: [{ text: 'Song ' }, { text: 'One' }] }, ownerText: { runs: [{ text: 'Artist A' }] }, lengthText: { simpleText: '3:45' } } },
      { reelShelfRenderer: { items: [{ videoRenderer: { videoId: 'short', title: { runs: [{ text: 's' }] } } }] } },
      { lockupViewModel: { contentId: 'v2', contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
          contentImage: { thumbnailViewModel: { overlays: [{ thumbnailOverlayBadgeViewModel: { thumbnailBadges: [{ thumbnailBadgeViewModel: { text: '1:02:03' } }] } }] } },
          metadata: { lockupMetadataViewModel: { title: { content: 'Song Two' }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: 'Artist B' } }] }] } } } } } },
      { lockupViewModel: { contentId: 'PL', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', metadata: { lockupMetadataViewModel: { title: { content: 'A playlist' } } } } },
      { videoRenderer: { videoId: 'v1', title: { runs: [{ text: 'dup' }] } } },
      { videoRenderer: { videoId: 'v3', title: { simpleText: 'Live thing' }, longBylineText: { runs: [{ text: 'Artist C' }] }, badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW', label: 'LIVE' } }] } },
    ] } } ] } } } } };
  const r = ctx.YTMiniSearch.parse(sample);
  ok(JSON.stringify(r) === JSON.stringify([
    { videoId: 'v1', title: 'Song One', channel: 'Artist A', duration: '3:45' },
    { videoId: 'v2', title: 'Song Two', channel: 'Artist B', duration: '1:02:03' },
    { videoId: 'v3', title: 'Live thing', channel: 'Artist C', duration: 'LIVE' },
  ]), 'search parse: ' + JSON.stringify(r));
}

// ---------- background queue engine ----------
function makeBrowser(presetLocal = {}) {
  const local = structuredClone(presetLocal), sync = {};
  const area = (store) => ({
    get: async (k) => { if (typeof k === 'string') return k in store ? { [k]: structuredClone(store[k]) } : {}; if (k && typeof k === 'object') { const o = { ...k }; for (const x in k) if (x in store) o[x] = store[x]; return o; } return { ...store }; },
    set: async (p) => { Object.assign(store, structuredClone(p)); },
  });
  const created = [], updated = [];
  let nextTab = 100;
  const b = {
    _local: local, _created: created, _updated: updated,
    runtime: { getURL: p => 'moz-extension://x/' + p, onConnect: ev(), onInstalled: ev(), openOptionsPage() {} },
    storage: { local: area(local), sync: area(sync), onChanged: ev() },
    tabs: { query: async () => [{ id: 1, windowId: 9 }], create: async (o) => { const t = { id: nextTab++, ...o }; created.push(t); return t; }, update: async (id, o) => { updated.push([id, o]); return { id, windowId: 9 }; }, onRemoved: ev() },
    windows: { update: async () => {}, create: async () => {} },
    action: { setPopup() {}, setBadgeText() {}, setBadgeBackgroundColor() {}, setBadgeTextColor() {}, setTitle() {}, onClicked: ev() },
    commands: { onCommand: ev() },
    permissions: { contains: async () => false, onAdded: ev(), onRemoved: ev() },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {} },
  };
  return b;
}
function port(name, tabId) {
  const p = { name, sender: tabId ? { tab: { id: tabId } } : {}, sent: [], onMessage: ev(), onDisconnect: ev(), postMessage(m) { this.sent.push(structuredClone(m)); } };
  return p;
}
async function boot(presetLocal) {
  const browser = makeBrowser(presetLocal);
  const ctx = vm.createContext({ browser, console, setTimeout, clearTimeout, AbortController, navigator: { language: 'en' }, structuredClone });
  ctx.globalThis = ctx;
  for (const f of ['src/shared/settings.js', 'src/search.js', 'src/background.js']) vm.runInContext(fs.readFileSync(REPO + f, 'utf8'), ctx, { filename: f });
  await tick();
  const ui = port('ui'); browser.runtime.onConnect.fire(ui); await tick();
  const q = (op, extra) => { ui.onMessage.fire({ type: 'queue', op, ...extra }); return tick(); };
  const cmd = (c) => { ui.onMessage.fire({ type: 'cmd', cmd: c }); return tick(); };
  const lastQueue = () => ui.sent.filter(m => m.type === 'queue').at(-1).queue;
  return { browser, ui, q, cmd, lastQueue, ctx };
}
const item = (id) => ({ videoId: id, title: 'T' + id, channel: 'C', duration: '1:00' });
const ids = (list) => list.map(i => i.videoId).join(',');
const upNext = (t) => ids(t.lastQueue().upNext);
const nowId = (t) => t.lastQueue().nowPlaying && t.lastQueue().nowPlaying.videoId;
const ytState = (yt, s) => { yt.onMessage.fire({ type: 'state', state: { title: 'T' + s.videoId, playing: true, currentTime: 10, ended: false, lastPlayed: Date.now(), ...s } }); return tick(); };
const loads = (yt) => yt.sent.filter(m => m.cmd === 'load').map(m => m.videoId).join(',');

{
  // Nothing playing (no YouTube tab): + plays right away in a new pinned tab, not queued
  const t = await boot();
  await t.q('add', { item: item('aaa') });
  ok(t.browser._created.length === 1 && t.browser._created[0].url.endsWith('v=aaa') && t.browser._created[0].pinned === true, 'idle add opens pinned tab and plays');
  ok(nowId(t) === 'aaa' && upNext(t) === '', 'idle add becomes now playing, Up Next empty');

  const yt = port('yt', 100); t.browser.runtime.onConnect.fire(yt); await tick();
  await ytState(yt, { videoId: 'aaa' });
  ok(t.browser._updated.some(([id, o]) => id === 1 && o.active), 'focus returned to original tab');

  // Playing: + queues at the end, play-next at the front
  await t.q('add', { item: item('ccc') });
  await t.q('playNext', { item: item('bbb') });
  await t.q('add', { item: item('ddd') });
  ok(upNext(t) === 'bbb,ccc,ddd' && nowId(t) === 'aaa', 'playing: add/playNext queue up: ' + upNext(t));
  const cfg = yt.sent.filter(m => m.type === 'config').at(-1);
  ok(cfg.queueActive === true && cfg.upNextAvailable === true && cfg.crossfadeSeconds === 4 && cfg.skipSilence === false, 'tab config: ' + JSON.stringify(cfg));

  // Paused still counts as playing
  await ytState(yt, { videoId: 'aaa', playing: false });
  await t.q('add', { item: item('eee') });
  ok(upNext(t) === 'bbb,ccc,ddd,eee' && !loads(yt).includes('eee'), 'paused: add queues instead of playing');
  await t.q('remove', { index: 3 });

  // Song ends -> removed from list, next one plays
  yt.onMessage.fire({ type: 'ended' }); await tick();
  ok(nowId(t) === 'bbb' && upNext(t) === 'ccc,ddd' && loads(yt).endsWith('bbb'), 'ended: finished song dropped, next plays');
  await ytState(yt, { videoId: 'bbb' });

  // next / prev with hidden history
  await t.cmd('next');
  ok(nowId(t) === 'ccc' && upNext(t) === 'ddd', 'next advances');
  await ytState(yt, { videoId: 'ccc', currentTime: 30 });
  await t.cmd('prev');
  ok(yt.sent.at(-1).cmd === 'seek' && yt.sent.at(-1).time === 0, 'prev after 3s restarts');
  await ytState(yt, { videoId: 'ccc', currentTime: 1 });
  await t.cmd('prev');
  ok(nowId(t) === 'bbb' && upNext(t) === 'ccc,ddd' && loads(yt).endsWith('bbb'), 'prev goes back to history, current returns to Up Next');
  ok(t.lastQueue().historyCount === 1 && !('history' in t.lastQueue()), 'history hidden from UI (count only)');
  await ytState(yt, { videoId: 'bbb' });

  // Media keys / Zen next
  yt.onMessage.fire({ type: 'action', action: 'next' }); await tick();
  ok(nowId(t) === 'ccc' && upNext(t) === 'ddd', 'media key next follows queue');
  await ytState(yt, { videoId: 'ccc' });

  // play(i), move
  await t.q('add', { item: item('fff') });
  await t.q('add', { item: item('ggg') });          // ddd,fff,ggg
  await t.q('move', { from: 2, to: 0 });            // ggg,ddd,fff
  ok(upNext(t) === 'ggg,ddd,fff', 'move reorders: ' + upNext(t));
  await t.q('play', { index: 1 });                  // play ddd, leaves ggg,fff
  ok(nowId(t) === 'ddd' && upNext(t) === 'ggg,fff', 'play(i) plays that one, rest stay');
  await ytState(yt, { videoId: 'ddd' });

  // User plays some other video in the tab during a session
  await ytState(yt, { videoId: 'zzz', title: 'Other' });
  ok(nowId(t) === 'zzz' && upNext(t) === 'ggg,fff', 'manual video becomes now playing, Up Next kept');

  // Clear, then the last song ends -> stop
  await t.q('clear');
  ok(upNext(t) === '', 'clear empties Up Next');
  const before = yt.sent.length;
  yt.onMessage.fire({ type: 'ended' }); await tick();
  const after = yt.sent.slice(before);
  ok(after.some(m => m.cmd === 'stopAutoplay') && !after.some(m => m.cmd === 'load') && nowId(t) === null, 'end of queue stops');
  ok(yt.sent.filter(m => m.type === 'config').at(-1).queueActive === false, 'queue session over: YouTube behaves normally again');

  // Ended video = nothing playing: + plays right away in the existing tab
  await ytState(yt, { videoId: 'zzz', playing: false, ended: true });
  await t.q('add', { item: item('hhh') });
  ok(nowId(t) === 'hhh' && upNext(t) === '' && loads(yt).endsWith('hhh') && t.browser._created.length === 1, 'after the end, + plays right away');

  // No queue at all: next uses YouTube's own next
  await t.q('clear');
  yt.onMessage.fire({ type: 'ended' }); await tick();
  await t.cmd('next');
  ok(yt.sent.at(-1).cmd === 'next', 'no queue -> YouTube next');

  // Plain YouTube browsing outside a session doesn't create queue entries
  const histBefore = t.lastQueue().historyCount;
  await ytState(yt, { videoId: 'yt1' });
  await ytState(yt, { videoId: 'yt2' });
  ok(nowId(t) === null && t.lastQueue().historyCount === histBefore, 'browsing YouTube normally leaves the queue alone');
  ok(t.browser._local.queue && Array.isArray(t.browser._local.queue.upNext), 'queue persisted in new shape');
}
{
  // Migration from the old { items, current } shape
  const t = await boot({ queue: { items: [item('a1'), item('a2'), item('a3'), item('a4')], current: 1 } });
  ok(nowId(t) === 'a2' && upNext(t) === 'a3,a4' && t.lastQueue().historyCount === 1, 'old queue migrated: ' + JSON.stringify(t.lastQueue()).slice(0, 80));
}
{
  // Floating player toggle (popup button / shortcut)
  const t = await boot();
  await t.cmd('toggleFloating'); await tick();
  ok(t.browser._local.overlayClosed === true, 'toggleFloating hides');
  t.browser.commands.onCommand.fire('toggle-floating-player'); await tick(); await tick();
  ok(t.browser._local.overlayClosed === false, 'shortcut shows again');
}
{
  // Search routed through background
  const t = await boot();
  t.ctx.YTMiniSearch.search = async (q) => [{ videoId: 'r1', title: 'Result for ' + q }];
  t.ui.onMessage.fire({ type: 'search', query: 'abc', reqId: 7 }); await tick();
  const m = t.ui.sent.find(x => x.type === 'searchResults');
  ok(m && m.reqId === 7 && m.results[0].title === 'Result for abc', 'search results returned to UI');
}
{
  // Zen mod presence: a UI port that says hello with zen:true turns env.zenMod on
  const t = await boot();
  const lastEnv = (p) => p.sent.filter(m => m.type === 'env').at(-1);
  ok(lastEnv(t.ui) && lastEnv(t.ui).zenMod === false, 'env.zenMod false by default');
  const zen = port('ui'); t.browser.runtime.onConnect.fire(zen); await tick();
  zen.onMessage.fire({ type: 'hello', zen: true }); await tick();
  ok(lastEnv(t.ui).zenMod === true, 'zen hello turns env.zenMod on for other UIs');
  const zen2 = port('ui'); t.browser.runtime.onConnect.fire(zen2); await tick();
  zen2.onMessage.fire({ type: 'hello', zen: true }); await tick();
  zen.onDisconnect.fire(); await tick();
  ok(lastEnv(t.ui).zenMod === true, 'still on while another zen port is connected');
  zen2.onDisconnect.fire(); await tick();
  ok(lastEnv(t.ui).zenMod === false, 'off when the last zen port disconnects');
  const late = port('ui'); t.browser.runtime.onConnect.fire(late); await tick();
  ok(lastEnv(late).zenMod === false, 'new UI gets current env on connect');
}
console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
