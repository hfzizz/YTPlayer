'use strict';

// YouTube search from the background page, without visiting YouTube.
// Uses YouTube's internal web API (the same one youtube.com calls), falling back
// to parsing the results page. Both return the same "ytInitialData"-shaped JSON.
(() => {
  const API_URL = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';
  const RESULTS_URL = 'https://www.youtube.com/results?search_query=';
  const VIDEOS_ONLY = 'EgIQAQ%3D%3D'; // search filter: type = video
  const CLIENT = { clientName: 'WEB', clientVersion: '2.20250925.01.00' };
  const LIMIT = 25;

  const text = (t) => {
    if (!t) return '';
    if (typeof t === 'string') return t;
    if (t.simpleText) return t.simpleText;
    if (t.content) return t.content;
    if (Array.isArray(t.runs)) return t.runs.map((r) => r.text).join('');
    return '';
  };

  const DURATION_RE = /^\d{1,2}(:\d{2}){1,2}$/;

  // Finds the first string anywhere under `node` that looks like a duration (e.g. "3:45").
  function findDuration(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 12) return '';
    for (const value of Object.values(node)) {
      if (typeof value === 'string') {
        if (DURATION_RE.test(value.trim())) return value.trim();
      } else {
        const found = findDuration(value, depth + 1);
        if (found) return found;
      }
    }
    return '';
  }

  function fromVideoRenderer(r) {
    if (!r.videoId) return null;
    const live = (r.badges || []).some((b) => /LIVE/.test(JSON.stringify(b)));
    return {
      videoId: r.videoId,
      title: text(r.title),
      channel: text(r.ownerText) || text(r.longBylineText) || text(r.shortBylineText),
      duration: text(r.lengthText) || (live ? 'LIVE' : ''),
    };
  }

  function fromLockup(l) {
    if (!l.contentId || (l.contentType && l.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO')) return null;
    const meta = (l.metadata && l.metadata.lockupMetadataViewModel) || {};
    const rows =
      (meta.metadata && meta.metadata.contentMetadataViewModel && meta.metadata.contentMetadataViewModel.metadataRows) || [];
    const firstPart = rows[0] && rows[0].metadataParts && rows[0].metadataParts[0];
    return {
      videoId: l.contentId,
      title: text(meta.title),
      channel: firstPart ? text(firstPart.text) : '',
      duration: findDuration(l.contentImage),
    };
  }

  // Walks the response and collects video results in page order.
  function parse(data) {
    const out = [];
    const seen = new Set();
    const stack = [data];
    // Iterative DFS that preserves document order.
    while (stack.length && out.length < LIMIT) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      let item = null;
      if (node.videoRenderer) item = fromVideoRenderer(node.videoRenderer);
      else if (node.lockupViewModel) item = fromLockup(node.lockupViewModel);
      if (item) {
        if (item.title && !seen.has(item.videoId)) {
          seen.add(item.videoId);
          out.push(item);
        }
        continue;
      }
      // Skip ads and shelves of Shorts.
      if (node.adSlotRenderer || node.reelShelfRenderer || node.shortsLockupViewModel) continue;
      const children = Array.isArray(node) ? node : Object.values(node);
      for (let i = children.length - 1; i >= 0; i--) {
        if (children[i] && typeof children[i] === 'object') stack.push(children[i]);
      }
    }
    return out;
  }

  async function searchApi(query, signal) {
    const res = await fetch(API_URL, {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { ...CLIENT, hl: navigator.language || 'en' } },
        query,
        params: decodeURIComponent(VIDEOS_ONLY),
      }),
    });
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    return parse(await res.json());
  }

  async function searchPage(query, signal) {
    const res = await fetch(`${RESULTS_URL}${encodeURIComponent(query)}&sp=${VIDEOS_ONLY}`, {
      credentials: 'include',
      signal,
    });
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    const html = await res.text();
    const m = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
    if (!m) throw new Error('Could not read YouTube search results');
    return parse(JSON.parse(m[1]));
  }

  async function search(query, { signal } = {}) {
    try {
      const results = await searchApi(query, signal);
      if (results.length) return results;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
    }
    return searchPage(query, signal);
  }

  globalThis.YTMiniSearch = { search, parse };
})();
