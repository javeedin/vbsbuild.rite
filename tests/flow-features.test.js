#!/usr/bin/env node
'use strict';
/*
 * Features from a Process Flow (webApps/buildrite/resources/js/flowFeatures.js): from the pages a user walked and the API
 * calls each made, draft the product feature list — pages as items, the prompt, parsing the AI's ```features block
 * (incl. a truncated answer), the model (features → their pages + calls, unknown keys dropped, ungrouped), the deterministic
 * autoDraft (no AI), and the rows / document.
 * Run: node tests/flow-features.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
let F = null;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'webApps', 'buildrite', 'resources', 'js', 'flowFeatures.js'), 'utf8'), { define: (deps, f) => { F = f(); } });

// a recorded Process Flow: pages walked, each with its calls (assets mixed in)
const flow = { id: 'PF-9', name: 'Take an order', pages: [
  { id: 'p1', page: 'shop/catalogue', name: 'Catalogue', calls: [
    { method: 'GET', url: 'https://app/ic/resources/version_3/catalogue.json' }, // asset: dropped
    { method: 'GET', url: 'https://host/ords/wms/v1/catalogue', path: '/ords/wms/v1/catalogue' },
    { method: 'GET', url: 'https://app/api/v1/items', path: '/api/v1/items' } ] },
  { id: 'p2', page: 'shop/order', name: 'New order', calls: [
    { method: 'POST', url: 'https://host/ords/shop/v1/orders', path: '/ords/shop/v1/orders' } ] },
  { id: 'p3', page: 'shop/thanks', name: 'Thanks', calls: [{ method: 'GET', url: 'https://host/favicon.ico' }] } // only an asset → no calls
] };

T.section('pages as items');
const items = F.pages(flow);
T.check('one item per page, keyed P1…, assets dropped, business calls kept with their object', items.length === 3 && items[0].key === 'P1' && items[0].calls.length === 2
  && items[0].calls[0].path === '/ords/wms/v1/catalogue' && items[0].calls[0].object === 'catalogue' && items[2].calls.length === 0, JSON.stringify(items[0]));

T.section('prompt');
const p = F.prompt(flow);
T.check('the prompt lists every page key with its calls and asks for a features JSON block', /P1 \[Catalogue\]/.test(p.user) && /POST \/ords\/shop\/v1\/orders/.test(p.user) && /P3 \[Thanks\] — no API calls/.test(p.user) && /```features/.test(p.system) && /group/i.test(p.system));

T.section('parse the AI answer');
const ai = 'Sure:\n```features\n[{"name":"Browse & Order","description":"Find items and place an order","pageKeys":["P1","p2"],"capabilities":["The application lets a user browse the catalogue","The application lets a user browse the catalogue","Place an order for the chosen item"]},{"name":"Confirmation","description":"Order placed","pageKeys":["P3"],"capabilities":["Shows an order confirmation"]}]\n```';
const drafted = F.parse(ai);
T.check('the block parses, keys upper-cased and de-duplicated', drafted.length === 2 && drafted[0].name === 'Browse & Order' && drafted[0].pageKeys.join() === 'P1,P2' && drafted[1].pageKeys.join() === 'P3', JSON.stringify(drafted));
T.check('capabilities parse, trimmed and de-duplicated (case-insensitive)', drafted[0].capabilities.length === 2 && drafted[0].capabilities[0] === 'The application lets a user browse the catalogue' && drafted[0].capabilities[1] === 'Place an order for the chosen item', JSON.stringify(drafted[0].capabilities));
T.check('a truncated answer is salvaged (whole features kept, the cut-off one dropped)', F.parse('```features\n[{"name":"A","pageKeys":["P1"]},{"name":"B","pageKeys":["P2"]},{"name":"C","pageK').length === 2);
T.check('no block / not JSON → empty, nothing thrown', F.parse('nope').length === 0 && F.parse('').length === 0 && F.parse(null).length === 0);

T.section('build the model');
const m = F.build(flow, drafted);
T.check('features carry their real pages and calls; order kept', m.features.length === 2 && m.features[0].name === 'Browse & Order' && m.features[0].pages.length === 2 && m.features[0].calls.length === 3 && m.features[0].calls[0].page === 'Catalogue', JSON.stringify(m.counts));
T.check('an unknown key is dropped and an empty feature removed', F.build(flow, [{ name: 'Ghost', pageKeys: ['P9'] }, { name: 'Real', pageKeys: ['P1'] }]).features.map((f) => f.name).join() === 'Real');
T.check('a page in no feature is gathered under ungrouped', F.build(flow, [{ name: 'Only first', pageKeys: ['P1'] }]).ungrouped.map((p) => p.key).join() === 'P2,P3');
T.check('features carry their capability statements', m.features[0].capabilities.length === 2 && m.features[0].capabilities[0] === 'The application lets a user browse the catalogue' && m.counts.capabilities === 3);

T.section('distinct capabilities (the Capabilities tab)');
T.check('capList gives distinct statements under their feature (cross-feature dedup, case-insensitive)', JSON.stringify(F.capList(m)) === JSON.stringify([
  { feature: 'Browse & Order', items: ['The application lets a user browse the catalogue', 'Place an order for the chosen item'] },
  { feature: 'Confirmation', items: ['Shows an order confirmation'] }]));
const cr = F.capRows(m, { '0:1': false });
T.check('capRows numbers each statement, carries its feature and whether it is kept', cr.length === 3 && cr[0].num === 1 && cr[0].feature === 'Browse & Order' && cr[0].kept === 'Yes' && cr[1].kept === 'No' && cr[2].feature === 'Confirmation');

T.section('autoDraft without AI');
const auto = F.build(flow, F.autoDraft(flow));
T.check('autoDraft makes one feature per page and leaves nothing ungrouped', auto.features.length === 3 && auto.ungrouped.length === 0 && auto.features[0].name === 'Catalogue');
T.check('with no AI capabilities, the one-line description stands in', auto.features[0].capabilities.length === 1 && /Catalogue screen/.test(auto.features[0].capabilities[0]));

T.section('summary (functional + technical features from the APIs)');
const sm = F.summary(m);
T.check('an overview sentence, functional one-liner per feature', /2 features across 3 pages and 3 API calls to \d system/.test(sm.overview) && sm.functional.length === 2 && sm.functional[0].name === 'Browse & Order');
T.check('technical features are derived from the calls, grouped by system, in plain English',
  sm.technicalFeatures.some((g) => /ORDS/.test(g.system) && g.items.some((s) => /fetches catalogue from/.test(s)))
  && sm.technicalFeatures.some((g) => g.items.some((s) => /submits orders to/.test(s))), JSON.stringify(sm.technicalFeatures));
T.check('a technical "at a glance": systems, reads vs writes, data objects', sm.technical.some((t) => t.label === 'Systems') && sm.technical.some((t) => /read/.test(t.detail) && /write/.test(t.detail)) && sm.technical.some((t) => t.label === 'Data objects'));
const sr = F.summaryRows(m);
T.check('summary rows carry the overview, functional and technical features', sr[0].section === 'Overview' && sr.some((r) => r.section === 'Functional feature') && sr.some((r) => r.section === 'Technical feature' && /submits orders to/.test(r.detail)));

T.section('rows + document');
const r = F.rows(m);
T.check('rows: one per call under its feature\'s page, a page with no calls gives one row', r.length === 4 && r[0].feature === 'Browse & Order' && r[0].page === 'Catalogue' && r[0].method === 'GET' && r.some((x) => x.page === 'Thanks' && x.method === ''));
const doc = F.documentHtml(m, { flow: 'Take an order', by: 'rite.user', date: '2026-11-23', title: 'Feature list' });
T.check('the document names the features, their capabilities, pages and calls, and is valid HTML', /<!doctype html>/i.test(doc) && /Browse &amp; Order/.test(doc) && /The application lets a user browse the catalogue/.test(doc) && /\/ords\/shop\/v1\/orders/.test(doc) && /Process Take an order/.test(doc));

T.report();
