#!/usr/bin/env node
'use strict';
/**
 * A saved flow's steps run for real (webApps/buildrite/resources/js/flowRun.js): which steps can run (a REST call of the
 * app's services, a BI Publisher report, not one added by hand); the values a step starts from (yours, last used, its
 * default, a value seen in an earlier answer) and what is still missing; the request handed to the API tester; the answer
 * kept short (a chip, a table preview); a run of an action / the flow planned in order and summed up. On the sample app's
 * page flow and on the API tester's own descriptions of its calls (desktop/lib/apiTest.js).
 */
const fs = require('fs');
const path = require('path');
const H = require('./_harness');
const I = require('../desktop/lib/integrations');
const A = require('../desktop/lib/apiTest');

const T = H.makeAsserter();
const JS = path.join(__dirname, '..', 'webApps', 'buildrite', 'resources', 'js');
const load = (f, deps) => { let out = null; new Function('define', fs.readFileSync(path.join(JS, f), 'utf8'))((d, fn) => { out = fn.apply(null, deps || []); }); return out; };
const D = load('integrationDiagram.js');
const M = load('flowModel.js', [D]);
const R = load('flowRun.js');
const ROOT = path.join(__dirname, 'fixtures', 'vb-sample');
const m = I.scan(ROOT);
const flow = M.fromPage(m, 'shop/orders/order-create', { name: 'Order intake' });
const steps = flow.actions.reduce((a, x) => a.concat(x.steps), []);

T.section('which steps can run');
const w = steps.map(R.what);
T.eq('the page\'s calls: a REST read, BI Publisher\'s service (with the report it runs), a REST write', w.map((x) => x.ok + ':' + x.kind + ':' + x.endpoint + ':' + x.report).join(' | '),
  'true:rest:shopApi/getCustomers: | true:rest:bipService/runBIPReport:CUSTOMERS_RP | true:rest:shopApi/createOrder:');
T.eq('a report through a module of its own ("report NAME")', JSON.stringify(R.what({ endpoint: 'report ORDERS_RP', method: 'SOAP', path: 'ORDERS_RP', direction: 'Report' })), JSON.stringify({ ok: true, kind: 'report', endpoint: '', report: 'ORDERS_RP' }));
T.check('a step added by hand, or a call not in the app\'s services, cannot run — and says why',
  /Added by hand/.test(R.what({ manual: true }).why) && /not one of the app's services/.test(R.what({ endpoint: 'https://x.example.com/do', method: 'GET', path: '/do' }).why) && !R.what(null).ok);
T.eq('the report name from an object or an endpoint', [R.reportName({ object: 'Customers report (CUSTOMERS_RP)' }), R.reportName({ endpoint: 'report A_B_RP' }), R.reportName({ object: 'Customers' })].join(','), 'CUSTOMERS_RP,A_B_RP,');

T.section('the values a step starts from');
const api = A.open({ root: ROOT });
const env = { backend: (n) => ({ url: 'https://' + n + '.example.com', login: 'None needed' }), send: async () => ({ status: 200, headers: {}, body: Buffer.from('{}'), ms: 1 }) };
const list = api.op('shopApi/getCustomers', env);
const create = api.op('shopApi/createOrder', env);
T.check('the API tester describes the calls (a read, a write with a body)', list.ok && list.op.reads && create.ok && !create.op.reads && !!create.op.body, JSON.stringify([list.ok, create.ok]));
const desc = { op: { endpoint: 'x/getOne', method: 'GET', path: '/things/{id}', reads: true,
  params: [{ name: 'id', in: 'path', required: true, def: '' }, { name: 'limit', in: 'query', required: false, def: '25' }, { name: 'q', in: 'query', required: false, def: '' }, { name: 'org', in: 'query', required: false, def: '' }] },
  saved: { params: { q: 'blue' } }, suggest: { id: [{ value: '42', from: 'getThings · id' }], org: [] } };
const s0 = R.start(desc);
T.eq('last used, its default, a value an earlier answer gave, else empty — and where each came from', JSON.stringify([s0.params, s0.from]),
  JSON.stringify([{ id: '42', limit: '25', q: 'blue', org: '' }, { id: 'from getThings', limit: 'its default', q: 'last used' }]));
T.eq('…the values you typed win', R.start(desc, { params: { id: '7', q: '' } }).params.id + '/' + R.start(desc, { params: { id: '7', q: '' } }).params.q, '7/blue');
T.eq('nothing missing once the id is known; a required path parameter is', [R.missing(desc, s0).join(), R.missing(desc, { params: { id: ' ' } }).join()].join(' | '), ' | id');
const cs = R.start(create);
T.check('a write starts from its body template; a required body is missing when emptied', cs.body === create.op.body.template && (create.op.body.required ? R.missing(create, { params: {}, body: '' }).indexOf('the body') !== -1 : true));

T.section('the request');
T.eq('a REST call: its endpoint, values; confirm only when asked', JSON.stringify(R.request(desc, s0, false)), JSON.stringify({ params: s0.params, extra: '', body: '', confirm: false, endpoint: 'x/getOne' }));
const rep = { op: { report: true, reportPath: '/Custom/Shop/CUSTOMERS_RP.xdo', reportName: 'CUSTOMERS_RP', rowTag: 'G_1', params: [{ name: 'P_CUSTOMER_ID' }] } };
T.eq('a report: its path, name, parameters and row element (no body)', JSON.stringify(R.request(rep, { params: { P_CUSTOMER_ID: '7' }, body: 'x' }, false)),
  JSON.stringify({ params: { P_CUSTOMER_ID: '7' }, extra: '', body: '', confirm: false, report: { path: '/Custom/Shop/CUSTOMERS_RP.xdo', name: 'CUSTOMERS_RP', params: ['P_CUSTOMER_ID'], rowTag: 'G_1' } }));

T.section('the answer, kept short');
const big = { ok: true, status: 200, statusText: 'OK', ms: 34, sizeText: '2.1 KB', method: 'GET', url: 'https://shop.example.com/shop/v1/customers', pretty: 'x'.repeat(20000),
  table: { from: 'items', columns: 'abcdefghij'.split(''), rows: Array.from({ length: 12 }, (_, i) => 'abcdefghij'.split('').map((c) => c + i)), total: 30 }, shape: { status: 'same' } };
const k = R.keep(big, '2026-01-01T00:00:00Z');
T.check('its rows (8 shown of 30, 8 of 10 columns, what is not shown said), its text cut', k.rows === 30 && k.table.rows.length === 8 && k.table.columns.length === 8 && k.table.more === '22 more rows and 2 more columns' && k.pretty.length === 12000 && k.cut, k.table.more);
T.eq('its facts', R.facts(k), '34 ms · 2.1 KB · 30 rows');
const chips = [R.chip({ res: k }), R.chip({ res: R.keep({ ok: false, status: 500, statusText: 'Internal Server Error', ms: 9, error: 'boom' }) }), R.chip({ res: R.keep(Object.assign({}, big, { shape: { status: 'differs', counts: { missing: 2, changed: 0 } } })) }),
  R.chip({ state: 'held' }), R.chip({ state: 'missing', need: ['id'] }), R.chip({ busy: true }), R.chip(null)];
T.eq('as a chip: ok, failed (why on hover), its answer differs, held, needs a value, running, none',
  chips.map((c) => (c ? c.cls + ':' + c.text : '-')).join(' | '), 'ok:200 · 30 rows · 34 ms | fail:500 · 9 ms | warn:200 · 30 rows · 34 ms | held:Changes data — not sent | held:Needs id | busy:Running… | -');
T.eq('its newest try wins: held this time, though an earlier answer is kept', R.chip({ res: k, state: 'held' }).cls + ' / ' + R.chip({ res: k, state: 'done' }).cls, 'held / ok');
T.check('…the failure\'s reason and the shape on hover', /500 Internal Server Error — boom/.test(chips[1].title) && /2 fields gone/.test(chips[2].title));

T.section('a run of an action, of the flow');
const p1 = R.plan(flow, flow.actions[0].id);
const pAll = R.plan(flow);
T.eq('one action\'s steps, then every step in order, numbered as on the screen', p1.map((x) => x.n).join() + ' / ' + pAll.map((x) => x.n + ':' + x.step.method).join(), '1.1,1.2 / 1.1:GET,1.2:POST,2.1:POST');
T.eq('summed up', R.tally(['ok', 'warn', 'fail', 'held', 'skip']).text, '2 ok, 1 failed, 1 held (change data or need a value — send them from their own panel), 1 not run (no call to send)');

T.report();
