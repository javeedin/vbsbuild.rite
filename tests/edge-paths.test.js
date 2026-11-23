#!/usr/bin/env node
'use strict';
/*
 * Edge paths from a Process Flow (webApps/buildrite/resources/js/edgePaths.js): the recording is the happy path; this
 * proposes, per step, the edge cases that can go differently (trigger, expected behaviour, what they stress, severity).
 * Covers pages-as-items, the prompt, parsing the ```edges block (incl. a truncated answer and a "*" flow-wide group),
 * the model (steps → their edges, unknown/"*" keys gathered as `general`), the deterministic autoDraft (no AI), and the
 * rows / checklist / summary / document.
 * Run: node tests/edge-paths.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
let E = null;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'webApps', 'buildrite', 'resources', 'js', 'edgePaths.js'), 'utf8'), { define: (deps, f) => { E = f(); } });

// a recorded happy path: pages walked, each with its calls (assets mixed in)
const flow = { id: 'PF-7', name: 'Place an order', pages: [
  { id: 'p1', page: 'shop/catalogue', name: 'Catalogue', calls: [
    { method: 'GET', url: 'https://app/ic/resources/version_3/catalogue.json' }, // asset: dropped
    { method: 'GET', url: 'https://host/ords/wms/v1/items', path: '/ords/wms/v1/items' } ] },
  { id: 'p2', page: 'shop/order', name: 'New order', calls: [
    { method: 'POST', url: 'https://host/ords/shop/v1/orders', path: '/ords/shop/v1/orders' },
    { method: 'GET', url: 'https://acme.fa.oraclecloud.com/fscmRestApi/resources/11/customers/{id}', path: '/fscmRestApi/resources/11/customers/{id}' } ] },
  { id: 'p3', page: 'shop/thanks', name: 'Thanks', calls: [{ method: 'GET', url: 'https://host/favicon.ico' }] } // only an asset → no calls
] };

T.section('pages as items');
const items = E.pages(flow);
T.check('one item per page, keyed P1…, assets dropped, business calls kept', items.length === 3 && items[0].key === 'P1' && items[0].calls.length === 1
  && items[1].calls.length === 2 && items[2].calls.length === 0, JSON.stringify(items.map((p) => p.calls.length)));

T.section('prompt');
const p = E.prompt(flow);
T.check('the prompt lists every step with its calls and asks for an edges JSON block', /P1 \[Catalogue\]/.test(p.user) && /POST \/ords\/shop\/v1\/orders/.test(p.user) && /P3 \[Thanks\] — no API calls/.test(p.user) && /```edges/.test(p.system) && /severity/i.test(p.system));

T.section('parse the AI answer');
const ai = 'Sure:\n```edges\n[{"pageKey":"p1","edges":[{"name":"No matching items","trigger":"The search returns nothing","expected":"Show an empty state","stresses":"GET /items","severity":"low"},{"name":"No matching items","trigger":"dup","expected":"x","severity":"LOW"}]},{"pageKey":"*","edges":[{"name":"Session expires","trigger":"The session times out","expected":"Prompt to sign in again","severity":"high"}]}]\n```';
const drafted = E.parse(ai);
T.check('the block parses: a page group and the "*" flow-wide group, keys upper-cased', drafted.length === 2 && drafted[0].pageKey === 'P1' && drafted[1].pageKey === '*', JSON.stringify(drafted.map((g) => g.pageKey)));
T.check('edges parse, de-duplicated by name (case-insensitive), severity normalised', drafted[0].edges.length === 1 && drafted[0].edges[0].name === 'No matching items' && drafted[0].edges[0].severity === 'low' && drafted[1].edges[0].severity === 'high', JSON.stringify(drafted[0].edges));
T.check('a truncated answer is salvaged (whole groups kept, the cut-off one dropped)', E.parse('```edges\n[{"pageKey":"P1","edges":[{"name":"A"}]},{"pageKey":"P2","edges":[{"name":"B"}]},{"pageKey":"P3","edges":[{"name":"C').length === 2);
const sevParse = E.parse('```edges\n[{"pageKey":"P1","edges":[{"name":"X","severity":"critical"}]}]');
T.check('an unknown severity falls back to medium', sevParse.length === 1 && sevParse[0].edges[0].severity === 'medium');
T.check('no block / not JSON → empty, nothing thrown', E.parse('nope').length === 0 && E.parse('').length === 0 && E.parse(null).length === 0);

T.section('build the model');
const m = E.build(flow, drafted);
T.check('every page is a step (even one with no edges); edges placed by key', m.steps.length === 3 && m.steps[0].edges.length === 1 && m.steps[0].edges[0].name === 'No matching items' && m.steps[1].edges.length === 0 && m.total === 3);
T.check('the "*" group becomes the flow-wide general edges', m.general.length === 1 && m.general[0].name === 'Session expires');
T.check('an unknown page key is gathered into general, not dropped', E.build(flow, [{ pageKey: 'P9', edges: [{ name: 'Orphan' }] }]).general.map((e) => e.name).join() === 'Orphan');
T.check('counts: edges total and by severity', m.counts.edges === 2 && m.counts.high === 1 && m.counts.low === 1 && m.counts.steps === 3 && m.counts.stepsWithEdges === 2, JSON.stringify(m.counts));
T.check('hasEdges true here, false for an empty model', E.hasEdges(m) === true && E.hasEdges(E.build(flow, [])) === false);

T.section('autoDraft without AI (edges derived from the calls)');
const auto = E.build(flow, E.autoDraft(flow));
T.check('each page gets edges, a write page gets a validation edge, a GET gets an empty-results edge',
  auto.steps[0].edges.some((e) => /No matching records/.test(e.name))
  && auto.steps[1].edges.some((e) => /Invalid or missing input/.test(e.name) && e.severity === 'high'), JSON.stringify(auto.steps[1].edges.map((e) => e.name)));
T.check('a path with an {id} gets an identifier edge', auto.steps[1].edges.some((e) => /identifier/i.test(e.name)));
T.check('an external system (Fusion) gets an unavailable edge', auto.steps[1].edges.some((e) => /Oracle Fusion is unavailable/.test(e.name)));
T.check('a flow-wide group is added (session / connection), and a concurrency edge because the flow writes', auto.general.some((e) => /Session expires/.test(e.name)) && auto.general.some((e) => /Concurrent edit/.test(e.name)));
T.check('a read-only flow gets no concurrency edge', !E.build({ pages: [{ name: 'A', calls: [{ method: 'GET', url: 'https://h/ords/x/v1/a', path: '/ords/x/v1/a' }] }] }, E.autoDraft({ pages: [{ name: 'A', calls: [{ method: 'GET', url: 'https://h/ords/x/v1/a', path: '/ords/x/v1/a' }] }] })).general.some((e) => /Concurrent/.test(e.name)));

T.section('rows + checklist + summary');
const r = E.rows(m);
T.check('rows: one per edge under its step, the flow-wide group last', r.length === 2 && r[0].step === 'Catalogue' && r[0].name === 'No matching items' && r[1].step === 'Across the whole flow' && r[1].severity === 'high');
const cr = E.checkRows(m, { '0:0': true });
T.check('checkRows number each edge and show Covered from the ticks (s:e true, g:e)', cr.length === 2 && cr[0].num === 1 && cr[0].covered === 'Yes' && cr[1].step === 'Across the whole flow' && cr[1].covered === 'No');
const sm = E.summary(m);
T.check('summary overview + severity counts + top risks, highest severity first', /2 edge paths across 2 steps — 1 high, 0 medium, 1 low/.test(sm.overview) && sm.bySeverity[0].sev === 'high' && sm.top[0].severity === 'high' && sm.top[0].name === 'Session expires', JSON.stringify(sm.bySeverity));
const sr = E.summaryRows(m);
T.check('summary rows carry the overview, the severity counts and the top risks', sr[0].section === 'Overview' && sr.some((x) => x.section === 'Severity' && x.item === 'High') && sr.some((x) => x.section === 'Top risk'));

T.section('document');
const doc = E.documentHtml(m, { flow: 'Place an order', by: 'rite.user', date: '2026-11-23', title: 'Edge paths' });
T.check('the document names the steps, the edges with severity, and is valid HTML', /<!doctype html>/i.test(doc) && /No matching items/.test(doc) && /Session expires/.test(doc) && /Across the whole flow/.test(doc) && /Process Place an order/.test(doc) && /Risk summary/.test(doc));

T.report();
