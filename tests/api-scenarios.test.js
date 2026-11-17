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

    T.section('a list of values: its values kept with the run, the value picked handed on');
    const lov = { field: 'Order', target: 'orderId', key: 'id', text: 'status', itemsPath: 'items' };
    const lovSc = store.save({ page: 'shop/orders/order-detail', name: 'Pick an order', steps: [
      { name: 'Orders (a dropdown)', endpoint: 'shopApi/getOrders', lov, extract: [{ var: 'orderId', from: 'items[0].id' }] },
      { name: 'The one picked', endpoint: 'shopApi/getOrderById', params: { id: '{{orderId}}' }, expect: { status: '200,404' } }] }).scenario;
    T.check('kept with its list (field, value set, key, text, items path); each step shows what its call accepts', Object.keys(lov).every((k) => lovSc.steps[0].lov[k] === lov[k])
      && lovSc.steps[1].accepts.some((a) => a.name === 'id' && a.required), JSON.stringify(lovSc.steps[1].accepts));
    r = await store.run(lovSc.id, env, {});
    let s0 = r.run.rows[0].steps[0];
    T.check('run: its values as the page shows them (key, text), how many; "the list has values" checked; the first handed on', JSON.stringify(s0.values) === '[{"key":"41","text":"OPEN","sub":""},{"key":"42","text":"CLOSED","sub":""}]'
      && s0.lov.total === 2 && s0.checks.some((c) => /the list has values/.test(c.name) && c.ok) && s0.extracted.orderId === '41' && sent.indexOf('GET /shop/v1/orders/41') !== -1, JSON.stringify(s0));
    const picked = store.save(Object.assign({}, lovSc, { steps: [Object.assign({}, lovSc.steps[0], { extract: [{ var: 'orderId', from: 'items[id=42].id' }] }), lovSc.steps[1]] })).scenario;
    r = await store.run(picked.id, env, {});
    T.check('another value picked (42): handed on, sent', r.run.rows[0].steps[0].extracted.orderId === '42' && sent.indexOf('GET /shop/v1/orders/42') !== -1, JSON.stringify(r.run.rows[0].steps[0].extracted));
    const gone = store.save(Object.assign({}, picked, { steps: [Object.assign({}, picked.steps[0], { extract: [{ var: 'orderId', from: 'items[id=77].id' }] }), picked.steps[1]] })).scenario;
    r = await store.run(gone.id, env, {});
    s0 = r.run.rows[0].steps[0];
    T.check('a value picked that is no longer in the list: said so, the next step not run', s0.state === 'fail' && s0.checks.some((c) => /the value picked \(77\) is no longer in the list/.test(c.detail))
      && r.run.rows[0].steps[1].state === 'skip', JSON.stringify(s0.checks));

    T.section('one step run on its own (▶ Run): from the scenario on the screen, with the values handed on so far');
    const unsaved = Object.assign({}, gone, { steps: [gone.steps[0], Object.assign({}, gone.steps[1], { params: { id: '{{orderId}}' } })] });
    let tr = await store.tryStep(unsaved, gone.steps[1].id, env, { vars: { orderId: '41' } });
    T.check('sent with the value handed on (orderId = 41): its answer, its checks, the URL it went to; not kept as a run', tr.ok && tr.result.state === 'ok' && tr.result.status === 200
      && /\/shop\/v1\/orders\/41$/.test(tr.result.request.url), JSON.stringify(tr.result).slice(0, 300));
    const runsBefore = store.runs('shop/orders/order-detail').runs.length;
    tr = await store.tryStep(unsaved, gone.steps[1].id, env, { vars: {} });
    T.check('…a value not handed on yet: said, with where to get it', !tr.result.status && /no value for orderId — run the steps before it/.test(tr.result.note) && store.runs('shop/orders/order-detail').runs.length === runsBefore, tr.result.note);
    tr = await store.tryStep(unsaved, gone.steps[0].id, env, {});
    T.check('…a list of values tried: its values come back to pick from', tr.result.values.length === 2 && tr.result.values[1].key === '42', JSON.stringify(tr.result.values));

    T.section('the page an address of the app shows (its window)');
    const pgs = [{ id: 'app/orders/order-create', label: 'New Order', route: { url: '/vp/shell/orders/order-create' } }, { id: 'app/orders/order-create-quick', label: 'New Order', route: { url: '/vp/shell/orders/order-create-quick' } },
      { id: 'app/main/home', label: 'Home', route: { url: '/vp/shell/main/home' } }];
    T.check('its route ends the address\'s path (query and trailing slash aside); the longest wins; none: null', S.pageOfUrl(pgs, 'http://localhost:9/vp/shell/orders/order-create?x=1').id === 'app/orders/order-create'
      && S.pageOfUrl(pgs, 'http://localhost:9/vp/shell/orders/order-create-quick/').id === 'app/orders/order-create-quick' && S.pageOfUrl(pgs, 'http://localhost:9/other/main/home').id === 'app/main/home'
      && S.pageOfUrl(pgs, 'http://localhost:9/vp/shell/nowhere') === null && S.pageOfUrl(pgs, '') === null);

    T.section('a journey: the next page\'s steps after these, values handed on');
    const p1 = { label: 'Orders', integrations: { rest: [{ endpoint: 'shopApi/getOrders', method: 'GET' }], reports: [], lovs: [] },
      logic: { chains: [{ name: 'LoadOrdersChain', calls: ['shopApi/getOrders'] }] }, features: { lifecycle: [{ when: 'when the page opens', chains: ['LoadOrdersChain'] }], actions: [] } };
    const p2 = { label: 'Order', integrations: { rest: [{ endpoint: 'shopApi/getOrderById', method: 'GET' }, { endpoint: 'shopApi/createOrder', method: 'POST', path: '/shop/v1/orders' }], reports: [], lovs: [] },
      logic: { chains: [{ name: 'LoadOrderChain', calls: ['shopApi/getOrderById'] }, { name: 'SubmitChain', calls: ['shopApi/createOrder'] }, { name: 'RemoveChain', calls: [] }] },
      features: { lifecycle: [{ when: 'when the page opens', chains: ['LoadOrderChain'] }], actions: [{ label: 'Submit', chains: ['SubmitChain'] }, { label: 'Cancel', chains: ['RemoveChain'] }] } };
    const j1 = store.draft('shop/orders/order-list', p1, 'jane.doe');
    const j2 = store.extend(j1.scenario, 'shop/orders/order-detail', p2, 'jane.doe');
    const js = j2.scenario.steps;
    T.check('the next page\'s steps after the first\'s, each marked with its page; the journey named', j2.ok && js.length === 3 && js[0].page === 'shop/orders/order-list' && js[1].page === 'shop/orders/order-detail'
      && js[2].endpoint === 'shopApi/createOrder' && js[2].writes && j2.scenario.journey.map((x) => x.label).join(' → ') === 'Orders → Order' && /^Journey — Orders → Order$/.test(j2.scenario.name), JSON.stringify(js.map((x) => [x.page, x.endpoint])));
    T.check('…a value the next page needs (the order\'s id) handed on from the first page\'s answer (a row of the list opened)', js[1].params.id === '{{id}}' && js[0].extract.some((e) => e.var === 'id' && e.from === 'auto:id')
      && JSON.stringify(j2.scenario.data) === '[]', JSON.stringify([js[0].extract, j2.scenario.data]));
    r = await store.run(j2.scenario.id, env, {});
    T.check('run as one: the list, then the order it opened (41), the create held', r.run.rows[0].steps[0].extracted.id === '41' && r.run.rows[0].steps[1].state === 'ok' && r.run.rows[0].steps[2].state === 'skip', JSON.stringify(r.run.rows[0].steps.map((x) => x.state)));
    T.check('…the linked page remembers when it was linked, what it added and where its notes start', !!j2.scenario.journey[1].linkedAt && j2.scenario.journey[1].linkedBy === 'jane.doe'
      && Array.isArray(j2.scenario.journey[1].vars) && j2.scenario.journey[1].notesAt === j1.scenario.notes.length, JSON.stringify(j2.scenario.journey[1]));

    T.section('a link removed, then made again');
    const p3 = { label: 'Cart', integrations: { rest: [{ endpoint: 'shopApi/getCart', method: 'GET' }], reports: [], lovs: [] },
      logic: { chains: [{ name: 'LoadCartChain', calls: ['shopApi/getCart'] }] }, features: { lifecycle: [{ when: 'when the page opens', chains: ['LoadCartChain'] }], actions: [] } };
    const j3 = store.extend(j2.scenario, 'shop/cart/cart', p3, 'jane.doe');
    T.check('three pages: Orders → Order → Cart', j3.ok && j3.scenario.journey.length === 3 && j3.scenario.steps.length === 4 && /Orders → Order → Cart$/.test(j3.scenario.name), j3.scenario.name);
    let u = store.unlink(j3.scenario, 'shop/orders/order-list', 'jane.doe');
    T.check('the first page has no link to remove: said', !u.ok && /starts on/.test(u.error));
    u = store.unlink(j3.scenario, 'shop/nowhere', 'jane.doe');
    T.check('…a page not in the journey: said', !u.ok && /not linked/.test(u.error));
    u = store.unlink(j3.scenario, 'shop/cart/cart', 'jane.doe');
    T.check('the last link removed: Cart\'s step gone, the journey and the name back to Orders → Order, the notes as before, saved', u.ok && u.scenario.journey.length === 2 && u.scenario.steps.length === 3
      && u.scenario.steps.every((x) => x.page !== 'shop/cart/cart') && u.scenario.name === 'Journey — Orders → Order' && u.scenario.notes === j2.scenario.notes
      && u.removed.steps === 1 && u.removed.pages[0].label === 'Cart' && store.get(j3.scenario.id).scenario.steps.length === 3, JSON.stringify(u.removed));
    u = store.unlink(j3.scenario, 'shop/orders/order-detail', 'jane.doe');
    T.check('a link in the middle removed: that page and the pages after it go (they came through it); a happy path again', u.ok && u.scenario.journey.length === 1 && u.scenario.steps.length === 1
      && u.removed.pages.map((x) => x.label).join() === 'Order,Cart' && u.removed.steps === 3 && /^Happy path — Orders$/.test(u.scenario.name), JSON.stringify(u.removed));
    const back = store.extend(u.scenario, 'shop/orders/order-detail', p2, 'jane.doe');
    T.check('…and linked again (Continue the journey): its steps back, the value handed on again', back.ok && back.scenario.steps.length === 3 && back.scenario.steps[1].params.id === '{{id}}');
    const before = back.scenario.steps.map((x) => x.id).join();
    const edited = JSON.parse(JSON.stringify(back.scenario));
    edited.steps[1].params.id = 'BROKEN';
    const rl = store.relink(edited, 'shop/orders/order-detail', p2, 'jane.doe');
    T.check('Reconnect: the link removed and made again, the page\'s steps read fresh (a broken value fixed), the first page\'s kept', rl.ok && rl.scenario.steps.length === 3
      && rl.scenario.steps[1].params.id === '{{id}}' && rl.scenario.steps[0].id === back.scenario.steps[0].id && rl.removed.steps === 2 && rl.scenario.journey.length === 2, before + ' | ' + JSON.stringify(rl.scenario.steps.map((x) => [x.id, x.params])));
    const withVar = store.extend(Object.assign({}, j1.scenario, { data: [{ customer: 'C1' }] }), 'shop/orders/order-detail', Object.assign({}, p2, { integrations: Object.assign({}, p2.integrations, { rest: [{ endpoint: 'shopApi/getOrderById', method: 'GET', params: { id: '{{orderRef}}' } }] }) }), 'jane.doe');
    const wv = withVar.scenario.journey[1].vars || [];
    const un2 = store.unlink(withVar.scenario, 'shop/orders/order-detail', 'jane.doe');
    T.check('a data column only that page added is taken out with it; one that was there before stays', withVar.ok && un2.ok && Object.keys(un2.scenario.data[0] || {}).indexOf('customer') !== -1
      && wv.every((k) => Object.keys(un2.scenario.data[0] || {}).indexOf(k) === -1), JSON.stringify([wv, withVar.scenario.data, un2.scenario.data]));
    const onlyGo = store.draft('shop/orders/order-detail', p2, 'jane.doe').scenario.steps.map((x) => x.endpoint).join();
    T.check('a page\'s journey: what runs as it opens and what its actions that go on call (Submit), not the rest (Cancel)', onlyGo === 'shopApi/getOrderById,shopApi/createOrder', onlyGo);

    T.section('a page\'s flow: every page it leads to, and how far the scenarios tested each');
    const fstore = S.open({ api, dir: path.join(tmp, 'scen-flow') });
    const FL = 'shop/flow/list', FD = 'shop/flow/detail', FC = 'shop/flow/cart', FK = 'shop/flow/checkout', FH = 'shop/flow/help';
    const fx = {};
    fx[FL] = Object.assign({}, p1, { label: 'Orders', next: [{ id: FD, label: 'Order', via: ['Open'] }, { id: FH, label: 'Help', via: ['Help'] }] });
    fx[FD] = Object.assign({}, p2, { label: 'Order', next: [{ id: FC, label: 'Cart', via: ['Add to cart'] }, { id: FL, label: 'Orders', via: ['Back'] }] });
    fx[FC] = Object.assign({}, p1, { label: 'Cart', next: [{ id: FK, label: 'Checkout', via: ['Checkout'] }] });
    fx[FK] = { label: 'Checkout', integrations: { rest: [{ endpoint: 'shopApi/createOrder', method: 'POST', path: '/shop/v1/orders' }], reports: [], lovs: [] },
      logic: { chains: [{ name: 'PayChain', calls: ['shopApi/createOrder'] }] }, features: { lifecycle: [], actions: [{ label: 'Pay', chains: ['PayChain'] }] } };
    const fo = (id) => fx[id] || null;
    let fl = fstore.flow(FL, fo);
    const byP = (f) => f.nodes.reduce((a, n) => { a[n.page] = n; return a; }, {});
    let nb = byP(fl);
    T.check('walked from the page: where it goes, and where those go (breadth first), each with its depth and how it is reached',
      fl.ok && fl.nodes.map((n) => n.label + ':' + n.depth).join() === 'Orders:0,Order:1,Help:1,Cart:2,Checkout:3' && nb[FD].via === 'Open' && nb[FC].via === 'Add to cart', JSON.stringify(fl.nodes.map((n) => [n.label, n.depth, n.via])));
    T.check('…the path to each page (to build a journey along it); a page reached again is not walked twice (Order goes back to Orders)',
      nb[FK].path.join(' > ') === [FL, FD, FC, FK].join(' > ') && nb[FD].also.join() === FL && fl.nodes.filter((n) => n.page === FL).length === 1, nb[FK].path.join(' > ') + ' / ' + nb[FD].also.join());
    T.check('…its APIs counted per page (writes too); a page with no technical sheet said so',
      nb[FL].apis === 1 && nb[FD].apis === 2 && nb[FD].writes === 1 && nb[FK].apis === 1 && nb[FH].noSheet && nb[FH].state === 'nosheet', JSON.stringify([nb[FD].keys, nb[FH].stateText]));
    T.check('nothing tested yet: every page "not tested yet", 0 of 5 APIs passed, the flow not complete; its paths counted',
      fl.summary.pages === 5 && fl.summary.tested === 0 && fl.summary.untested === 4 && fl.summary.apis === 5 && fl.summary.passed === 0 && !fl.summary.complete && fl.summary.paths === 2
      && nb[FL].stateText === 'not tested yet', JSON.stringify(fl.summary));
    T.check('…as deep as asked (depth 1: the page and where it goes)', fstore.flow(FL, fo, { depth: 1 }).nodes.map((n) => n.label).join() === 'Orders,Order,Help');
    T.check('…a page with no sheet: said', !fstore.flow(FH, fo).ok && /no technical sheet/.test(fstore.flow(FH, fo).error));
    // a journey along the path to the cart, in one go
    let tp = fstore.throughPath(null, [FL, FD, FC], fo, 'jane.doe');
    T.check('a journey along a path: drafted on the first page, every later page linked in turn, saved',
      tp.ok && tp.scenario.journey.map((j) => j.label).join(' → ') === 'Orders → Order → Cart' && tp.added.map((a) => a.label).join() === 'Order,Cart' && !tp.continued
      && fstore.get(tp.scenario.id).ok && /^Journey — Orders → Order → Cart$/.test(tp.scenario.name), JSON.stringify([tp.scenario && tp.scenario.name, tp.added, tp.skipped]));
    fl = fstore.flow(FL, fo); nb = byP(fl);
    T.check('…in a scenario but not run yet: those pages say so', nb[FL].state === 'notrun' && nb[FC].state === 'notrun' && nb[FK].state === 'none' && nb[FL].scenarios[0].name === tp.scenario.name, JSON.stringify(nb[FL].scenarios));
    // the stand-in backend answers fewer fields than the app's examples: the shape check off for these runs
    const noShape = (sc) => fstore.save(Object.assign({}, sc, { steps: sc.steps.map((st) => Object.assign({}, st, { expect: Object.assign({}, st.expect, { sameShape: false }) })) }), 'jane.doe').scenario;
    tp.scenario = noShape(tp.scenario);
    r = await fstore.run(tp.scenario.id, env, { by: 'jane.doe' });
    fl = fstore.flow(FL, fo); nb = byP(fl);
    T.check('run: Orders and Cart tested (every API passed); Order passed with its create not run (writes held), so not complete',
      r.run.ok && nb[FL].state === 'ok' && nb[FC].state === 'ok' && nb[FD].state === 'part' && nb[FD].passed === 1 && /1 of its 2 APIs not run yet/.test(nb[FD].stateText)
      && fl.summary.tested === 2 && fl.summary.passed === 3 && !fl.summary.complete, JSON.stringify([nb[FD].state, nb[FD].stateText, fl.summary]));
    tp = fstore.throughPath(tp.scenario, [FL, FD, FC, FK], fo, 'jane.doe');
    T.check('a longer path from that journey: continued from it (Checkout linked), not drafted again', tp.ok && tp.continued && tp.added.map((a) => a.label).join() === 'Checkout'
      && tp.scenario.journey.length === 4 && fstore.list(FL).scenarios.length === 1, JSON.stringify(tp.added));
    const thr = fstore.throughPath(null, [FL, FH], fo, 'jane.doe');
    T.check('…a page on the path with no sheet: passed through, said why', thr.ok && thr.skipped.length === 1 && thr.skipped[0].page === FH && /no technical sheet/.test(thr.skipped[0].why) && thr.scenario.journey.length === 1);
    const sendWas = env.send;
    env.send = ((orig) => async (name, rel, init) => (/^\/shop\/v1\/orders(\?|$)/.test(rel) && init.method === 'GET' ? { status: 500, statusText: '', headers: { 'content-type': 'application/json' }, body: Buffer.from('{}'), ms: 5 } : orig(name, rel, init)))(env.send);
    thr.scenario = noShape(thr.scenario);
    r = await fstore.run(thr.scenario.id, env, { by: 'jane.doe' });
    env.send = sendWas;
    fl = fstore.flow(FL, fo); nb = byP(fl);
    T.check('a scenario failing on a page: still tested where another passed (the best of them shows), its failure listed with it',
      !r.run.ok && nb[FL].state === 'ok' && nb[FL].scenarios.some((x) => x.state === 'bad'), JSON.stringify(nb[FL].scenarios.map((x) => [x.name, x.state])));

    const one = fstore.draft(FL, fx[FL], 'jane.doe').scenario;
    const c1 = fstore.throughPath(one, [FL, FD], fo, 'jane.doe');
    T.check('a one-page happy path continued along a path (same scenario, Order linked)', c1.ok && c1.continued && c1.scenario.id === one.id && c1.added.length === 1 && c1.scenario.journey.length === 2, JSON.stringify([c1.continued, c1.added]));

    T.section('the page as on your screen: its choices, the parts shown in one case only');
    T.check('shown or not, for the values chosen; null when it hangs on something not chosen (taken as shown)', S.evalWhen("requestTypeSel === 'EXTERNAL'", { requestTypeSel: 'INTERNAL' }) === false
      && S.evalWhen("requestTypeSel !== 'EXTERNAL' || $application.functions.flag($application.variables.f, 'A')", { requestTypeSel: 'INTERNAL' }) === true
      && S.evalWhen("requestTypeSel !== 'EXTERNAL' || $application.functions.flag($application.variables.f, 'A')", { requestTypeSel: 'EXTERNAL' }) === null
      && S.evalWhen("(x === 'a') && (locationType === 'INV_ORG')", { locationType: 'PROJECT_SITE' }) === false && S.evalWhen('', {}) === true);
    const bf = { label: 'New request', integrations: { rest: [{ endpoint: 'shopApi/getOrders', method: 'GET' }, { endpoint: 'shopApi/getOrderById', method: 'GET' }], reports: [], lovs: [
      { field: 'Customer Type', source: 'static', target: 'requestTypeSel', values: [{ key: 'INTERNAL', text: 'Internal' }, { key: 'EXTERNAL', text: 'External' }], when: '' },
      { field: 'Order (external)', source: 'chain', endpoint: 'shopApi/getOrders', target: 'extOrder', key: 'id', itemsPath: 'items', when: "requestTypeSel === 'EXTERNAL'" }] },
      logic: { chains: [{ name: 'InitChain', calls: ['shopApi/getOrders'] }] }, features: { lifecycle: [{ when: 'when the page opens', chains: ['InitChain'] }], actions: [] } };
    T.check('its choices: the lists written in the code its parts are shown by, the first value to start', JSON.stringify(S.choicesOf(bf)) === '[{"target":"requestTypeSel","field":"Customer Type","values":[{"key":"INTERNAL","text":"Internal"},{"key":"EXTERNAL","text":"External"}],"value":"INTERNAL","start":"INTERNAL","startFrom":""}]');
    const bd = store.draft('shop/orders/order-new', bf, 'jane.doe').scenario;
    r = await store.run(bd.id, env, {});
    T.check('run as Internal: the External-only list not run, said why', r.run.rows[0].steps[0].state === 'skip' && /not on the page when Customer Type is Internal/.test(r.run.rows[0].steps[0].note), r.run.rows[0].steps[0].note);
    const be = store.save(Object.assign({}, bd, { choices: bd.choices.map((c) => Object.assign({}, c, { value: 'EXTERNAL' })) })).scenario;
    r = await store.run(be.id, env, {});
    T.check('…as External: it runs; the value chosen is there for the calls ({{requestTypeSel}})', r.run.rows[0].steps[0].status === 200 && be.choices[0].value === 'EXTERNAL', JSON.stringify(r.run.rows[0].steps[0].checks));

    const tryOff = await store.tryStep(bd, bd.steps[0].id, env, {});
    T.check('▶ Run on a step not on the page as chosen: sent all the same, said', tryOff.result.status === 200 && /not on the page as chosen \(Customer Type is Internal\): run because you asked/.test(tryOff.result.note), tryOff.result.note);

    T.section('kept, listed');
    const list = store.list(page);
    T.check('the page\'s scenarios, each with its last run', list.ok && list.scenarios.length === 7 && list.scenarios.filter((x) => x.name === 'Open an order')[0].last !== null);
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
