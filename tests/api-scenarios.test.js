#!/usr/bin/env node
'use strict';
/**
 * API Scenarios (desktop/lib/apiScenarios.js): a page's calls in order, run purely through the APIs (lib/apiTest.js's
 * engine) against a stand-in backend, with the sample app's service connections (tests/fixtures/vb-sample):
 *   - saved and listed per page; a run: each step's checks (status, rows, time, fields), the value one answer hands on
 *     ({{id}} from "auto:id") used by the next step; a missing value stops the steps that need it
 *   - a step that changes data: not run unless the scenario and the run both allow writes; never on a production host
 *   - data rows: the scenario once per row, {{column}} filled from it; an expected 404 (an edge case) passes
 *   - drafted from a page's facts: its entry chains first, a value a later call needs handed on, writes last
 *   - every run kept, newest first; readPath and fill on their own
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const S = require('../desktop/lib/apiScenarios');
const AT = require('../desktop/lib/apiTest');

const T = H.makeAsserter();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'br-scen-'));
const ROOT = path.join(__dirname, 'fixtures', 'vb-sample');
(async () => {
  try {
    const sent = [];
    let host = 'https://shop.example.com/api';
    const env = {
      backend: (name) => ({ url: name === 'shop' ? host : 'https://fusion-dev.example.com', login: 'none', loginOk: true }),
      send: async (name, rel, init) => {
        sent.push(init.method + ' ' + rel);
        const json = (status, v) => ({ status, statusText: '', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(v)), ms: 12 });
        if (/^\/shop\/v1\/orders\?/.test(rel) || rel === '/shop/v1/orders') return init.method === 'POST' ? json(201, { id: 900 }) : json(200, { items: [{ id: 41, status: 'OPEN' }, { id: 42, status: 'CLOSED' }] });
        const m = /^\/shop\/v1\/orders\/(\w+)/.exec(rel);
        if (m) return m[1] === '41' ? json(200, { id: 41, status: 'OPEN' }) : json(404, { error: 'no such order' });
        return json(404, {});
      },
    };
    const api = AT.open({ root: ROOT, file: path.join(tmp, 'api-tests.json') });
    const store = S.open({ api, dir: path.join(tmp, 'scen') });
    const page = 'shop/orders/order-list';

    T.section('a scenario: values handed on, each answer checked');
    const saved = store.save({ page, name: 'Open an order', kind: 'happy', steps: [
      { name: 'List orders', endpoint: 'shopApi/getOrders', extract: [{ var: 'id', from: 'auto:id' }], expect: { status: '2xx', minRows: 1, maxMs: 5000 } },
      { name: 'Its detail', endpoint: 'shopApi/getOrderById', params: { id: '{{id}}' }, expect: { status: '200', fields: [{ path: 'status', equals: 'OPEN' }, { path: 'id' }] } },
      { name: 'Create one', endpoint: 'shopApi/createOrder', body: '{"customer":"{{id}}"}', writes: true, expect: { status: '201' } },
    ] }, 'jane.doe');
    T.check('saved for its page, by whom', saved.ok && saved.scenario.page === page && saved.scenario.by === 'jane.doe' && saved.scenario.steps.length === 3);
    let r = await store.run(saved.scenario.id, env, { by: 'jane.doe' });
    const st = r.run.rows[0].steps;
    T.check('step 1: rows, time, status checked; it hands on id = 41', st[0].state === 'ok' && st[0].extracted.id === '41' && st[0].checks.length === 3, JSON.stringify(st[0]));
    T.check('step 2: called with that id (/orders/41); its fields checked', st[1].state === 'ok' && sent.indexOf('GET /shop/v1/orders/41') !== -1 && st[1].checks.every((c) => c.ok), JSON.stringify(st[1].checks));
    T.check('step 3 changes data: not run (writes not allowed), nothing posted', st[2].state === 'skip' && /changes data/.test(st[2].note) && !sent.some((x) => /^POST/.test(x)), st[2].note);
    T.check('…the run passed (a step not run is not a failure); kept with who ran it', r.run.ok && r.run.passed === 2 && r.run.skipped === 1 && r.run.by === 'jane.doe');

    T.section('writes: only when allowed, never on production');
    store.save(Object.assign({}, saved.scenario, { allowWrites: true }), 'jane.doe');
    r = await store.run(saved.scenario.id, env, { allowWrites: true, by: 'jane.doe' });
    T.check('allowed on the scenario and the run, a test host: posted, 201 checked', r.run.rows[0].steps[2].state === 'ok' && sent.some((x) => x === 'POST /shop/v1/orders'), JSON.stringify(r.run.rows[0].steps[2]));
    host = 'https://shop.mycompany.com/api';
    const posts = sent.filter((x) => /^POST/.test(x)).length;
    r = await store.run(saved.scenario.id, env, { allowWrites: true });
    T.check('a host that looks like production: never posted, said', r.run.rows[0].steps[2].state === 'skip' && /production/.test(r.run.rows[0].steps[2].note) && sent.filter((x) => /^POST/.test(x)).length === posts);
    host = 'https://shop.example.com/api';

    T.section('data rows and edge cases; a missing value');
    const dataSc = store.save({ page, name: 'Each order', kind: 'data', data: [{ oid: '41', want: '200' }, { oid: '77', want: '404' }],
      steps: [{ name: 'Detail', endpoint: 'shopApi/getOrderById', params: { id: '{{oid}}' }, expect: { status: '200,404' } }] }).scenario;
    r = await store.run(dataSc.id, env, {});
    T.check('once per row ({{oid}} from it); an expected 404 passes', r.run.rows.length === 2 && r.run.ok && r.run.rows[1].steps[0].status === 404, JSON.stringify(r.run.rows.map((x) => x.steps[0].status)));
    const gap = store.save({ page, name: 'Gap', steps: [{ name: 'Detail', endpoint: 'shopApi/getOrderById', params: { id: '{{nothing}}' } }, { name: 'List', endpoint: 'shopApi/getOrders' }] }).scenario;
    r = await store.run(gap.id, env, {});
    T.check('a value nobody handed on: the step fails saying which, the next not run', !r.run.ok && /no value for nothing/.test(r.run.rows[0].steps[0].note) && r.run.rows[0].steps[1].state === 'skip');

    T.section('drafted from a page\'s facts');
    const facts = { label: 'Order list',
      integrations: { rest: [{ endpoint: 'shopApi/createOrder', method: 'POST', path: '/shop/v1/orders' }, { endpoint: 'shopApi/getOrderById', method: 'GET' }, { endpoint: 'shopApi/getOrders', method: 'GET' }], reports: ['/Custom/Shop/USER_ROLES.xdo'] },
      logic: { chains: [{ name: 'RowClickChain', calls: ['shopApi/getOrderById'] }, { name: 'LoadOrdersChain', calls: ['shopApi/getOrders'] }, { name: 'SubmitChain', calls: ['shopApi/createOrder'] }] },
      features: { lifecycle: [{ when: 'on entry', chains: ['LoadOrdersChain'] }] } };
    const d = store.draft(page, facts, 'jane.doe');
    const names = d.scenario.steps.map((x) => x.endpoint || 'report');
    T.check('its entry chain first (LoadOrders → getOrders), then the row click, its report (a read), writes last', d.ok && names.join() === 'shopApi/getOrders,shopApi/getOrderById,report,shopApi/createOrder', names.join());
    T.check('…the create step held as a write; a report step for its BI Publisher report', d.scenario.steps[3].writes && d.scenario.steps[2].report.path === '/Custom/Shop/USER_ROLES.xdo');
    // BI Publisher's own SOAP call (/xmlpserver/…) is the page's report, run where the page calls it, not a call of its own
    const bipFacts = { label: 'New order',
      integrations: { rest: [{ endpoint: 'shopApi/getOrders', method: 'GET' }, { endpoint: 'bipService/runBIPReport', method: 'POST', path: '/xmlpserver/services/ExternalReportWSSService' }, { endpoint: 'shopApi/createOrder', method: 'POST' }], reports: ['/Custom/Shop/USER_ROLES.xdo'] },
      logic: { chains: [{ name: 'LoadChain', calls: ['shopApi/getOrders', 'bipService/runBIPReport'] }, { name: 'SubmitChain', calls: ['shopApi/createOrder'] }] } };
    const db = store.draft(page, bipFacts, 'jane.doe');
    T.check('BI Publisher\'s SOAP call becomes the report step, in its place (once)', db.scenario.steps.map((x) => x.endpoint || 'report').join() === 'shopApi/getOrders,report,shopApi/createOrder', db.scenario.steps.map((x) => x.endpoint || 'report').join());
    // a value the page gets from the screen before it (no earlier step hands it on): asked for under Data
    const ds = store.draft(page, { label: 'Order', integrations: { rest: [{ endpoint: 'shopApi/getOrderById', method: 'GET' }], reports: [] } }, 'jane.doe');
    T.check('a value to start with: a data row asks for it, the notes say so', JSON.stringify(ds.scenario.data) === '[{"id":""}]' && ds.scenario.steps[0].params.id === '{{id}}' && /Give id under Data/.test(ds.scenario.notes), JSON.stringify(ds.scenario.data));
    r = await store.run(ds.scenario.id, env, {});
    T.check('…run without it: the step says to give it under Data', !r.run.ok && /no value for id — give it under Data/.test(r.run.rows[0].steps[0].note), r.run.rows[0].steps[0].note);

    T.section('kept, listed');
    const list = store.list(page);
    T.check('the page\'s scenarios, each with its last run', list.ok && list.scenarios.length === 6 && list.scenarios.filter((x) => x.name === 'Open an order')[0].last !== null);
    const runs = store.runs(page);
    T.check('its runs, newest first; one opened again in full', runs.ok && runs.runs.length >= 5 && runs.runs[0].at >= runs.runs[1].at && store.runOf(page, runs.runs[0].id).run.rows.length >= 1);
    T.check('no workspace (no folder): said', S.open({ api, dir: () => '' }).list(page).ok === false);

    T.section('reading answers, filling values');
    const ans = { status: 200, json: { items: [{ OrderId: 5, lines: [{ qty: 2 }] }] }, rows: [{ PROJECT_ID: 'P1' }] };
    T.check('readPath: a path, a table row, auto: (any case), $status, $count; a field named status is the field', S.readPath(ans, 'items[0].lines[0].qty') === 2 && S.readPath(ans, 'rows[0].PROJECT_ID') === 'P1'
      && S.readPath(ans, 'auto:project_id') === 'P1' && S.readPath(ans, '$status') === 200 && S.readPath(ans, '$count') === 1 && S.readPath({ status: 200, json: { status: 'OPEN' } }, 'status') === 'OPEN');
    const miss = [];
    T.check('fill: {{var}} from the values, the missing ones listed', S.fill('a={{x}}&b={{y}}', { x: 1 }, miss) === 'a=1&b=' && miss.join() === 'y');
    T.check('statusOk: 2xx, a list, a class', S.statusOk(204, '2xx') && S.statusOk(404, '200,404') && !S.statusOk(500, '4xx'));
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  T.report();
})();
