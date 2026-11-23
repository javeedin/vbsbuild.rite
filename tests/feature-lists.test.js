/*
 * Saved feature lists: the store the desktop app keeps on this PC (desktop/lib/featureLists.js) and the page's client
 * (webApps/buildrite/resources/js/featuresClient.js), which uses the desktop app's /__features/* or, where there is none
 * (VBCS), the browser's storage — so the Features tab opens on the project's last draft (the grouping), rebuilt live.
 *
 * Run:  node tests/feature-lists.test.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');
const F = require('../desktop/lib/featureLists');

const T = H.makeAsserter();

(async () => {
  T.section('the store on this PC');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-feat-'));
  const file = path.join(dir, 'feature-lists.json');
  let clock = Date.parse('2026-11-23T10:00:00Z');
  const S = F.open({ file, now: () => new Date(clock += 60000), max: 3 });
  T.check('empty at first', Object.keys(S.index().items).length === 0 && !S.get('EQR').ok);
  const r1 = S.save({ project: 'eqr', source: 'All stories', by: 'sam',
    features: [{ name: 'Catalogue', description: 'Browse & filter', storyKeys: ['EQR-1', 'eqr-2', 'EQR-2'] }, { name: 'Fusion Sync', storyKeys: ['EQR-3'] }] });
  T.check('saved under the project (upper case), with when', r1.ok && r1.item.project === 'EQR' && r1.item.at === '2026-11-23T10:01:00.000Z' && r1.item.by === 'sam');
  T.check('story keys upper-cased and de-duplicated', r1.item.features[0].storyKeys.join() === 'EQR-1,EQR-2' && r1.item.features.length === 2);
  T.check('read back whole', S.get('EQR').item.features[0].name === 'Catalogue' && S.get('eqr').item.features[1].storyKeys.join() === 'EQR-3');
  T.check('the index has a count, not the keys', S.index().items.EQR.features === 2 && !('storyKeys' in S.index().items.EQR) && S.index().items.EQR.source === 'All stories');
  const all = S.save({ project: '', features: [{ name: 'Everything', storyKeys: ['AB-1'] }] });
  T.check('every project is kept as _ALL', all.ok && all.item.project === '' && S.get('').item.features[0].name === 'Everything' && !!S.index().items._ALL);
  T.check('refused: a bad project key', !S.save({ project: '12 34', features: [] }).ok);
  T.check('an empty feature (no name, no stories) is dropped', S.save({ project: 'ZZ', features: [{ name: '', storyKeys: [] }, { name: 'Real', storyKeys: ['ZZ-1'] }] }).item.features.map((f) => f.name).join() === 'Real');
  const r2 = S.save({ project: 'EQR', features: [{ name: 'Only one now', storyKeys: ['EQR-9'] }] });
  T.check('a re-draft replaces the project\'s list', r2.ok && S.get('EQR').item.features.length === 1 && r2.item.at > r1.item.at);
  T.check('on disk: a fresh open reads it', F.open({ file }).get('EQR').item.features[0].name === 'Only one now');
  S.save({ project: 'AA', features: [{ name: 'a', storyKeys: ['AA-1'] }] }); S.save({ project: 'BB', features: [{ name: 'b', storyKeys: ['BB-1'] }] });
  T.check('only the newest kept (max 3 here)', Object.keys(F.open({ file }).index().items).length === 3);
  T.check('removed', S.remove('AA').ok && !S.get('AA').ok);

  T.section('the page\'s client: through the desktop app');
  function client(fetchImpl, storage) {
    let FE;
    const store = storage || {};
    const window = { fetch: fetchImpl, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } } };
    const sb = { console, Promise, Date, window, JSON, encodeURIComponent, define: (d, f) => { FE = f(); } };
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'webApps', 'buildrite', 'resources', 'js', 'featuresClient.js'), 'utf8'), sb, { filename: 'featuresClient.js' });
    return { FE, store };
  }
  const srv = F.open({ file: path.join(dir, 'srv.json') });
  const calls = [];
  const viaServer = async (url, opts) => {
    calls.push((opts.method || 'GET') + ' ' + url + ' ' + (opts.headers['X-Build-Rite-Features'] || ''));
    const u = new URL('http://x' + url);
    const b = opts.body ? JSON.parse(opts.body) : {};
    let out = { error: 'Not found' };
    if (u.pathname === '/__features/index') out = srv.index();
    if (u.pathname === '/__features/get') out = srv.get(u.searchParams.get('project'));
    if (u.pathname === '/__features/save') out = srv.save(Object.assign({}, b, { by: 'sam.lee' }));
    if (u.pathname === '/__features/remove') out = srv.remove(b.project);
    return { ok: true, status: 200, text: async () => JSON.stringify(out) };
  };
  const c1 = client(viaServer).FE;
  T.check('nothing saved yet', (await c1.get('EQR')) === null);
  const sv = await c1.save({ project: 'eqr', source: 'All stories', features: [{ name: 'Catalogue', storyKeys: ['EQR-1', 'eqr-1', 'EQR-2'] }] });
  T.check('saved through /__features/save (who ran it set by the desktop app), with its header', sv && sv.by === 'sam.lee' && sv.project === 'EQR' && calls.some((c) => /^POST \/__features\/save 1$/.test(c)) && srv.get('EQR').ok);
  T.check('story keys cleaned on the client too', sv.features[0].storyKeys.join() === 'EQR-1,EQR-2');
  T.check('read back', (await c1.get('eqr')).features[0].name === 'Catalogue' && (await c1.get('ZZ')) === null);
  T.check('every project (blank) round-trips', (await c1.save({ project: '', features: [{ name: 'All', storyKeys: ['X-1'] }] })).project === '' && (await c1.get('')).features[0].name === 'All');
  T.check('removed', (await c1.remove('EQR')).ok && !srv.get('EQR').ok);

  T.section('the page\'s client: no desktop app (VBCS) — this browser keeps them');
  const none = async () => ({ ok: false, status: 404, text: async () => 'Not found' });
  const { FE: c2, store } = client(none);
  T.check('nothing saved yet', (await c2.get('EQR')) === null);
  const lv = await c2.save({ project: 'EQR', features: [{ name: 'Catalogue', storyKeys: ['EQR-1'] }] });
  T.check('saved in the browser\'s storage', lv && lv.project === 'EQR' && JSON.parse(store['eqr-feature-lists']).EQR.features[0].name === 'Catalogue');
  T.check('read back, and a fresh page reads it too', (await c2.get('EQR')).features[0].name === 'Catalogue' && (await client(none, store).FE.get('EQR')).features[0].name === 'Catalogue');
  T.check('removed', (await c2.remove('EQR')).ok && (await c2.get('EQR')) === null);

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  T.report();
})().catch((e) => { console.error(e); process.exit(1); });
