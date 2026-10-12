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
function makeBrowser() {
  const local = {}, sync = {};
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
async function boot() {
  const browser = makeBrowser();
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
const ids = (qq) => qq.items.map(i => i.videoId).join(',');

{
  // No YouTube tab: play now opens a pinned background tab
  const t = await boot();
  await t.q('playNow', { item: item('aaa') });
  ok(t.browser._created.length === 1 && t.browser._created[0].url.endsWith('v=aaa') && t.browser._created[0].pinned === true, 'playNow opens pinned tab');
  ok(t.lastQueue().current === 0 && ids(t.lastQueue()) === 'aaa', 'queue has playing item');

  // The new tab connects and starts playing -> focus returns to the original tab
  const yt = port('yt', 100); t.browser.runtime.onConnect.fire(yt); await tick();
  ok(yt.sent.some(m => m.type === 'config' && m.queueActive === true), 'yt tab told queue is active');
  yt.onMessage.fire({ type: 'state', state: { videoId: 'aaa', title: 'Taaa', playing: true, currentTime: 1, lastPlayed: 5 } }); await tick();
  ok(t.browser._updated.some(([id, o]) => id === 1 && o.active), 'focus returned to original tab');

  // add + playNext ordering
  await t.q('add', { item: item('ccc') });
  await t.q('playNext', { item: item('bbb') });
  ok(ids(t.lastQueue()) === 'aaa,bbb,ccc', 'playNext inserts after current: ' + ids(t.lastQueue()));

  // next -> loads bbb via the tab (no new tab)
  await t.cmd('next');
  ok(yt.sent.at(-2)?.cmd === 'load' || yt.sent.some(m => m.cmd === 'load' && m.videoId === 'bbb'), 'next loads bbb in existing tab');
  ok(t.lastQueue().current === 1 && t.browser._created.length === 1, 'current=1, no extra tab');

  // video ends -> ccc
  yt.onMessage.fire({ type: 'state', state: { videoId: 'bbb', title: 'Tbbb', playing: true, currentTime: 1, lastPlayed: 6 } }); await tick();
  yt.onMessage.fire({ type: 'ended' }); await tick();
  ok(yt.sent.some(m => m.cmd === 'load' && m.videoId === 'ccc') && t.lastQueue().current === 2, 'ended advances to ccc');

  // end of queue -> stop (stopAutoplay), no load
  yt.onMessage.fire({ type: 'state', state: { videoId: 'ccc', title: 'Tccc', playing: true, currentTime: 1, lastPlayed: 7 } }); await tick();
  const before = yt.sent.length;
  yt.onMessage.fire({ type: 'ended' }); await tick();
  const after = yt.sent.slice(before);
  ok(after.some(m => m.cmd === 'stopAutoplay') && !after.some(m => m.cmd === 'load'), 'end of queue stops');

  // prev: >3s restarts, otherwise previous item
  yt.onMessage.fire({ type: 'state', state: { videoId: 'ccc', title: 'Tccc', playing: true, currentTime: 30, lastPlayed: 7 } }); await tick();
  await t.cmd('prev');
  ok(yt.sent.at(-1).cmd === 'seek' && yt.sent.at(-1).time === 0, 'prev after 3s restarts');
  yt.onMessage.fire({ type: 'state', state: { videoId: 'ccc', title: 'Tccc', playing: true, currentTime: 1, lastPlayed: 7 } }); await tick();
  await t.cmd('prev');
  ok(yt.sent.some(m => m.cmd === 'load' && m.videoId === 'bbb') && t.lastQueue().current === 1, 'prev goes to bbb');

  // media session action (Zen / media keys) -> next
  yt.onMessage.fire({ type: 'action', action: 'next' }); await tick();
  ok(t.lastQueue().current === 2, 'media key next follows queue');

  // move & remove keep current pointing at the same item
  await t.q('add', { item: item('ddd') });           // aaa,bbb,ccc*,ddd
  await t.q('move', { from: 3, to: 0 });               // ddd,aaa,bbb,ccc*
  ok(ids(t.lastQueue()) === 'ddd,aaa,bbb,ccc' && t.lastQueue().current === 3, 'move adjusts current');
  await t.q('remove', { index: 0 });                   // aaa,bbb,ccc*
  ok(ids(t.lastQueue()) === 'aaa,bbb,ccc' && t.lastQueue().current === 2, 'remove adjusts current');

  // user picks a queued video themselves -> current follows
  yt.onMessage.fire({ type: 'state', state: { videoId: 'aaa', title: 'Taaa', playing: true, currentTime: 1, lastPlayed: 8 } }); await tick();
  ok(t.lastQueue().current === 0, 'current syncs to video playing in tab');

  // persisted
  ok(t.browser._local.queue && ids(t.browser._local.queue) === 'aaa,bbb,ccc', 'queue persisted to storage');

  await t.q('clear');
  ok(t.lastQueue().items.length === 0 && t.lastQueue().current === -1, 'clear');
  // empty queue -> next uses YouTube's own next
  await t.cmd('next');
  ok(yt.sent.at(-1).cmd === 'next', 'no queue -> YouTube next');
}
{
  // Add to an empty queue with nothing playing starts playback
  const t = await boot();
  await t.q('add', { item: item('zzz') });
  ok(t.browser._created.length === 1 && t.lastQueue().current === 0, 'add to empty idle queue starts playing');
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
