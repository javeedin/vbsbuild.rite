/*
 * Saved AI analyses: the store the desktop app keeps on this PC (desktop/lib/analyses.js) and the page's client
 * (webApps/buildrite/resources/js/analysisStore.js), which uses the desktop app's /__ai/* or, where there is none
 * (VBCS), the browser's storage — so an analysis opens on its last run, and the Jira lists can mark the analysed stories.
 *
 * Run:  node tests/ai-analyses.test.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');
const A = require('../desktop/lib/analyses');

const T = H.makeAsserter();

(async () => {
  T.section('the store on this PC');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-ai-'));
  const file = path.join(dir, 'ai-analyses.json');
  let clock = Date.parse('2026-11-12T10:00:00Z');
  const S = A.open({ file, now: () => new Date(clock += 60000), max: 3 });
  T.check('empty at first', Object.keys(S.index().items).length === 0 && !S.get('ABC-12').ok);
  const r1 = S.save({ key: 'abc-12', text: '## Requirement\n- grid', provider: 'Claude', fddId: 'fdd-v1-7', fddLabel: 'Shop FDD · v1.7',
    picked: [{ n: '7.2', t: 'Order master list', why: 'named by the story', chars: 120 }], chat: [{ role: 'user', text: 'first?' }], by: 'sam', storyUpdated: '2026-11-10' });
  T.check('saved under the story key (upper case), with when', r1.ok && r1.item.key === 'ABC-12' && r1.item.kind === 'story' && r1.item.at === '2026-11-12T10:01:00.000Z');
  T.check('read back whole: text, FDD, sections read, chat, by', S.get('ABC-12').item.text === '## Requirement\n- grid' && S.get('ABC-12').item.picked[0].n === '7.2' && S.get('ABC-12').item.chat.length === 1 && S.get('ABC-12').item.by === 'sam');
  T.check('the index has no text, just what the lists show', !('text' in S.index().items['ABC-12']) && S.index().items['ABC-12'].fddLabel === 'Shop FDD · v1.7' && S.index().items['ABC-12'].chat === 1);
  const set = S.save({ key: 'set:ABC-36, ABC-23', text: 'x' });
  T.check('a set is saved under its keys, sorted', set.ok && set.item.key === 'SET:ABC-23,ABC-36' && set.item.kind === 'set' && set.item.keys.join() === 'ABC-23,ABC-36' && S.get('SET:ABC-36,ABC-23').ok);
  T.check('refused: no key, a one-story "set", no text', !S.save({ key: '', text: 'x' }).ok && !S.save({ key: 'SET:ABC-1', text: 'x' }).ok && !S.save({ key: 'ABC-1', text: '  ' }).ok);
  T.check('the chat is kept with it', S.chat('ABC-12', [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }]).ok && S.get('ABC-12').item.chat.length === 2 && !S.chat('ABC-99', []).ok);
  const r2 = S.save({ key: 'ABC-12', text: 'newer' });
  T.check('a re-run replaces the last', r2.ok && S.get('ABC-12').item.text === 'newer' && r2.item.at > r1.item.at);
  T.check('on disk: a fresh open reads it', A.open({ file }).get('ABC-12').item.text === 'newer');
  S.save({ key: 'ABC-1', text: 'a' }); S.save({ key: 'ABC-2', text: 'b' });
  T.check('only the newest kept (max 3 here)', Object.keys(A.open({ file }).index().items).sort().join() === 'ABC-1,ABC-12,ABC-2');
  T.check('removed', S.remove('ABC-1').ok && !S.get('ABC-1').ok);

  T.section('the page\'s client: through the desktop app');
  function client(fetchImpl, storage) {
    let AS;
    const store = storage || {};
    const window = { fetch: fetchImpl, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } } };
    const sb = { console, Promise, Date, window, JSON, define: (d, f) => { AS = f(); } };
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'webApps', 'buildrite', 'resources', 'js', 'analysisStore.js'), 'utf8'), sb, { filename: 'analysisStore.js' });
    return { AS, store };
  }
  const srv = A.open({ file: path.join(dir, 'srv.json') });
  const calls = [];
  const viaServer = async (url, opts) => {
    calls.push((opts.method || 'GET') + ' ' + url + ' ' + (opts.headers['X-Build-Rite-AI'] || ''));
    const u = new URL('http://x' + url);
    const b = opts.body ? JSON.parse(opts.body) : {};
    let out = { error: 'Not found' };
    if (u.pathname === '/__ai/index') out = srv.index();
    if (u.pathname === '/__ai/get') out = srv.get(u.searchParams.get('key'));
    if (u.pathname === '/__ai/save') out = srv.save(Object.assign({}, b, { by: 'sam.lee' }));
    if (u.pathname === '/__ai/chat') out = srv.chat(b.key, b.chat);
    return { ok: true, status: 200, text: async () => JSON.stringify(out) };
  };
  const c1 = client(viaServer).AS;
  const heard = [];
  c1.on('list', (idx) => heard.push(Object.keys(idx).join()));
  T.eq('an empty index', JSON.stringify(await c1.index()), '{}');
  const sv = await c1.save({ key: 'ABC-12', text: '## Requirement', provider: 'ChatGPT' });
  T.check('saved through /__ai/save (who ran it set by the desktop app), with its header', sv && sv.by === 'sam.lee' && calls.some((c) => /^POST \/__ai\/save 1$/.test(c)) && srv.get('ABC-12').ok);
  T.check('the lists hear of it at once (the AI icon)', heard[heard.length - 1] === 'ABC-12' && c1.cached()['ABC-12'].provider === 'ChatGPT');
  T.check('read back', (await c1.get('abc-12')).text === '## Requirement' && (await c1.get('ABC-99')) === null);
  T.check('the chat kept', (await c1.saveChat('ABC-12', [{ role: 'user', text: 'q', html: '<p>q</p>' }])) && srv.get('ABC-12').item.chat[0].text === 'q' && !srv.get('ABC-12').item.chat[0].html);
  T.eq('a set key', c1.setKey(['abc-36', 'ABC-23', 'ABC-23']), 'SET:ABC-23,ABC-36');

  T.section('the page\'s client: no desktop app (VBCS) — this browser keeps them');
  const none = async () => ({ ok: false, status: 404, text: async () => 'Not found' });
  const { AS: c2, store } = client(none);
  T.eq('an empty index', JSON.stringify(await c2.index()), '{}');
  const lv = await c2.save({ key: 'ABC-7', text: 'local', provider: 'Gemini' });
  T.check('saved in the browser\'s storage', lv && lv.key === 'ABC-7' && JSON.parse(store['eqr-ai-analyses'])['ABC-7'].text === 'local' && c2.cached()['ABC-7'].provider === 'Gemini');
  T.check('read back, and a fresh page reads it too', (await c2.get('ABC-7')).text === 'local' && (await client(none, store).AS.get('ABC-7')).text === 'local');
  T.check('the chat kept', (await c2.saveChat('ABC-7', [{ role: 'assistant', text: 'a' }])) && JSON.parse(store['eqr-ai-analyses'])['ABC-7'].chat.length === 1);
  T.check('when and how long ago', /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d\d:\d\d$/.test(c2.when('2026-11-12T10:05:00Z')) && c2.ago(new Date().toISOString()) === 'just now');

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  T.report();
})().catch((e) => { console.error(e); process.exit(1); });
