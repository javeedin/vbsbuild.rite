#!/usr/bin/env node
'use strict';
/*
 * Application → Process Flows → "Edge paths (AI)", in a browser. A recorded flow (two real app pages, each with a captured
 * call) carries a saved edge list. Open it → the By-step tab shows the edges; API-level edges have a Run button, the
 * flow-wide one does not. Run the read edge → the mutated request is sent and the response is graded (✓, 2xx) and the edge
 * is auto-ticked covered. Run the write edge → it asks first ("Run anyway"); the backend wrongly accepts the empty body, so
 * it is graded a FAIL (✗ accepted) and left unticked — exactly the bug an edge test should catch. The dialog does NOT jump
 * when a result expands it (it is top-anchored, not re-centred). Needs `npm run build`. Run: node tests/e2e/edge-paths.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const P = require('../../desktop/lib/processFlows');
const A = require('../../desktop/lib/apiTest');
const S = require('../../desktop/lib/apiScenarios');

const T = H.makeAsserter();
const settle = (page, ms) => page.waitForTimeout(ms || 250);

(async () => {
  const pg = await E.pagesSandbox({});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-edge-e2e-'));
  const store = P.open({ dir });
  const apiStore = A.open({ root: pg.root, file: path.join(dir, 'api-tests.json') });
  const scenarioStore = S.open({ api: apiStore, dir: path.join(dir, 'scenarios') });
  const apiProject = () => ({ catalogFile: path.join(pg.root, 'services', 'catalog.json'), getIdentity: () => ({ username: 'rite.user', roles: [], fusion: null }) });
  const aiStore = { settings: () => ({ active: 'anthropic', providers: { anthropic: { ready: true } }, catalog: [], features: [], uses: {} }), chat: async () => ({ ok: true, text: '[]' }) };

  // a recorded flow: a read page (GET) and a write page (POST), each matched to a real catalog page, each with a captured
  // call — and a SAVED edge list (so the dialog loads it without AI): a no-results edge (GET→2xx), a bad-input edge
  // (POST→4xx) and a flow-wide session edge (not API-runnable).
  store.save({
    name: 'Place an order',
    pages: [
      { id: 'p1', page: 'shop/orders/order-list', name: 'Order list', calls: [{ method: 'GET', url: 'http://app/shop/v1/orders?status=open', path: '/shop/v1/orders', query: 'status=open', status: 200, response: '{"items":[]}' }] },
      { id: 'p2', page: 'shop/orders/order-create', name: 'New order', calls: [{ method: 'POST', url: 'http://app/shop/v1/orders', path: '/shop/v1/orders', body: '{"note":"x","customer":"C1"}', status: 201 }] },
    ],
    edges: {
      source: 'ai', generatedAt: '2026-11-20T10:00:00.000Z', savedAt: '2026-11-20T10:01:00.000Z',
      draft: [
        // several read edges on the first step, so the By-step list is long enough to scroll (to prove Run keeps the scroll)
        { pageKey: 'P1', edges: ['No matching records', 'Empty result set', 'Nothing for this filter', 'No data in the range', 'No records for today', 'No match on the code', 'Empty when archived', 'Empty order list']
          .map((name) => ({ name, trigger: 'The order query returns nothing', expected: 'Show an empty state, not an error', stresses: 'GET /shop/v1/orders', severity: 'low' })) },
        { pageKey: 'P2', edges: [{ name: 'Invalid or missing input', trigger: 'Required fields are blank when submitting the order', expected: 'Block the submit with field errors (a 4xx)', stresses: 'POST /shop/v1/orders', severity: 'high' }] },
        { pageKey: '*', edges: [{ name: 'Session expires mid-flow', trigger: 'The sign-in times out partway through', expected: 'Prompt to sign in again and resume', stresses: 'auth / session', severity: 'high' }] },
      ],
      checks: {},
    },
  }, 'rite.user');

  // the backend: the list GET returns an empty 2xx; the create POST WRONGLY accepts the empty body (200) — the bug.
  const handle = (req, res) => {
    if (/\/shop\/v1\/orders$/.test(req.path) && req.method === 'GET') return res.json({ items: [] }, 200);
    if (/\/shop\/v1\/orders$/.test(req.path) && req.method === 'POST') return res.json({ id: 1 }, 200);
    return false;
  };

  const env = await E.start({ port: 19993, processFlowStore: store, pagesStore: pg.store, apiStore, scenarioStore, apiProject, aiStore, handle });
  const page = env.page;
  page.on('dialog', (d) => d.accept());
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const text = (sel) => env.text(sel).catch(() => '');
  const edge = (k) => '.nx-pf-edge:has([data-op="edgeCheck"][data-key="' + k + '"])'; // one edge, by its s:e key
  try {
    T.section('open the flow and the Edge paths dialog');
    await env.open('/');
    await page.click('.nx-nav-item[data-nav-id="process-flows"]');
    await page.waitForSelector('#pfList .nx-pf-card', { timeout: 30000 });
    await page.click('#pfList .nx-pf-open');
    await page.waitForSelector('#pfMakeEdges', { timeout: 10000 });
    await page.click('#pfMakeEdges');
    await page.waitForSelector('.nx-pf-edgestep--flow', { timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('.nx-pf-edgestep').length === 3, null, { timeout: 10000 });
    await settle(page, 200);
    const flowEdgeName = await page.inputValue('.nx-pf-edgestep--flow .nx-pf-edgename').catch(() => '');
    T.check('the saved edges load into the By-step tab (two steps + the flow-wide group)', (await page.$$('.nx-pf-edgestep')).length === 3 && /Session expires/.test(flowEdgeName), flowEdgeName);

    T.section('only API-level edges get a Run button');
    const runButtons = await page.$$('[data-op="edgeRun"]');
    T.check('every API edge gets a Run button (8 read + 1 write), none on the flow-wide session edge', runButtons.length === 9 && !(await page.$('.nx-pf-edgestep--flow [data-op="edgeRun"]')), 'run buttons: ' + runButtons.length);

    T.section('run the read edge → graded a pass, auto-ticked covered');
    const boxBefore = await page.locator('.nx-pf-edgedlg').boundingBox();
    const urlBefore = page.url();
    await page.click(edge('0:0') + ' [data-op="edgeRun"]');
    await page.waitForSelector(edge('0:0') + ' .nx-pf-edgeres--ok', { timeout: 15000 });
    T.check('the read edge passes (a bold PASS badge, a 2xx)', /PASS/.test(await text(edge('0:0') + ' .nx-pf-edgepill')) && /2xx|row/.test(await text(edge('0:0') + ' .nx-pf-edgeverdicttext')), await text(edge('0:0') + ' .nx-pf-edgeres'));
    T.check('a pass auto-ticks the edge as covered', await page.isChecked(edge('0:0') + ' [data-op="edgeCheck"]'));

    T.section('the dialog does NOT jump when the result expands it');
    const boxAfter = await page.locator('.nx-pf-edgedlg').boundingBox();
    T.check('the dialog top stays put (top-anchored, not re-centred) and the URL is unchanged', Math.abs(boxAfter.y - boxBefore.y) < 3 && page.url() === urlBefore, 'top ' + (boxBefore && boxBefore.y) + ' → ' + (boxAfter && boxAfter.y));

    T.section('the dialog body keeps its scroll when an edge is Run (the real jump)');
    await page.setViewportSize({ width: 1200, height: 560 }); // short, so the long edge list scrolls inside the dialog body
    await settle(page, 200);
    const body = page.locator('.nx-pf-edgedlg .nx-pf-featbody');
    await page.locator(edge('0:5')).scrollIntoViewIfNeeded();      // a lower read edge, now scrolled into view
    await settle(page, 150);
    const scrollBefore = await body.evaluate((el) => el.scrollTop);
    await page.click(edge('0:5') + ' [data-op="edgeRun"]');
    await page.waitForSelector(edge('0:5') + ' .nx-pf-edgeres', { timeout: 15000 });
    await settle(page, 350);                                       // after all the restore frames
    const scrollAfter = await body.evaluate((el) => el.scrollTop);
    T.check('the body was actually scrolled and stays put after Run (does not snap to the top)', scrollBefore > 30 && Math.abs(scrollAfter - scrollBefore) < 40, 'scrollTop ' + scrollBefore + ' → ' + scrollAfter);

    T.section('run the write edge → asks first, then catches the accepted bad input (a FAIL)');
    await page.click(edge('1:0') + ' [data-op="edgeRun"]');
    await page.waitForSelector(edge('1:0') + ' .nx-pf-edgeres--warn', { timeout: 15000 });
    T.check('a write edge asks first ("Run anyway")', !!(await page.$(edge('1:0') + ' [data-op="edgeRunGo"]')) && /changes data|Run anyway/i.test(await text(edge('1:0') + ' .nx-pf-edgeres')));
    const beforeWrites = env.writes.length;
    await page.click(edge('1:0') + ' [data-op="edgeRunGo"]');
    await page.waitForSelector(edge('1:0') + ' .nx-pf-edgeres--bad', { timeout: 15000 });
    const wrote = env.writes[env.writes.length - 1];
    T.check('Run anyway sends the mutated POST (empty body) to the backend', env.writes.length === beforeWrites + 1 && wrote && wrote.method === 'POST' && /\/shop\/v1\/orders$/.test(wrote.path) && JSON.stringify(wrote.body) === '{}', JSON.stringify(wrote && { m: wrote.method, p: wrote.path, b: wrote.body }));
    T.check('the edge catches that the bad input was accepted (a bold FAIL badge), and does NOT tick it covered', /FAIL/.test(await text(edge('1:0') + ' .nx-pf-edgepill')) && /accepted|not rejected/i.test(await text(edge('1:0') + ' .nx-pf-edgeverdicttext')) && !(await page.isChecked(edge('1:0') + ' [data-op="edgeCheck"]')), await text(edge('1:0') + ' .nx-pf-edgeverdicttext'));

    T.section('Run all runs every runnable edge and tallies the result');
    await page.click('#pfEdgeRunAll'); // the confirm dialog is auto-accepted by page.on('dialog')
    await page.waitForFunction(() => /Ran \d+ edge/.test((document.getElementById('pfEdgeNote') || {}).textContent || ''), null, { timeout: 30000 });
    const note = await text('#pfEdgeNote');
    T.check('Run all reports a pass / fail tally', /Ran \d+ edge path/.test(note) && /passed/.test(note) && /failed/.test(note), note);

    T.section('the Checklist tab reflects what is covered');
    await page.click('[data-op="edgeTab"][data-key="checklist"]');
    await page.waitForSelector('.nx-pf-chk', { timeout: 10000 });
    T.check('the read edge shows covered, the write edge not', await page.isChecked('.nx-pf-chk:has([data-key="0:0"]) [data-op="edgeCheck"]') && !(await page.isChecked('.nx-pf-chk:has([data-key="1:0"]) [data-op="edgeCheck"]')));

    await env.shot('edge-paths.png');
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    await env.close();
    fs.rmSync(dir, { recursive: true, force: true });
    if (pg.restore) pg.restore();
  }
  T.report();
})();
