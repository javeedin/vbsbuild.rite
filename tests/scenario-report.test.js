/*
 * The test results report of an API scenario (resources/js/scenarioReport.js) and the workbook of several sheets it is
 * saved as (resources/js/exportKit.js xlsxBook): the model from a scenario and one of its runs (steps, checks, evidence),
 * the Excel sheets and their preview, the printable document (the PDF), the file name.
 *
 * Run:  node tests/scenario-report.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const JS = path.join(__dirname, '..', 'webApps', 'buildrite', 'resources', 'js');
const load = (file) => {
  let out;
  const box = { console, Date, JSON, Math, Promise, TextEncoder, define: (deps, f) => { out = f(); } };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(JS, file), 'utf8'), box, { filename: file });
  return out;
};
const R = load('scenarioReport.js');
const K = load('exportKit.js');

const SC = {
  id: 'u1', code: 'SC-0007', name: 'Happy path — New Order', kind: 'happy', page: 'shop/orders/order-create', allowWrites: false, notes: 'Orders for a <new> customer',
  journey: [{ page: 'shop/orders/order-create', label: 'New Order' }, { page: 'shop/orders/order-detail', label: 'Order' }],
  steps: [
    { id: 's1', name: 'List of values: Customer', endpoint: 'shopApi/getCustomers', api: { method: 'GET' } },
    { id: 's2', name: 'The order', endpoint: 'shopApi/getOrderById', page: 'shop/orders/order-detail', api: { method: 'GET' } },
    { id: 's3', name: 'Create the order', endpoint: 'shopApi/createOrder', writes: true, api: { method: 'POST' } }
  ]
};
const step = (id, name, call, state, extra) => Object.assign({ step: id, name, call, state, checks: [], extracted: {}, status: 0, ms: 0, rows: null }, extra || {});
const RUN = {
  id: 'r1', scenario: 'u1', name: SC.name, page: SC.page, at: '2026-11-17T09:30:00.000Z', by: 'priya.raman', scope: 'all', ms: 2340, ok: false, passed: 1, failed: 1, skipped: 1,
  rows: [{ vars: {}, ok: false, steps: [
    step('s1', 'List of values: Customer', 'shopApi/getCustomers', 'ok', { status: 200, ms: 41, rows: 2, extracted: { customer: '8' }, request: { method: 'GET', url: 'http://127.0.0.1:9/shop/v1/customers' },
      answer: '{"items":[{"id":7},{"id":8}]}', checks: [{ name: 'status 2xx', ok: true, detail: '200 OK' }, { name: 'within 10000 ms', ok: true, detail: '41 ms' }] }),
    step('s2', 'The order', 'shopApi/getOrderById', 'fail', { status: 404, ms: 12, request: { method: 'GET', url: 'http://127.0.0.1:9/shop/v1/orders/8' }, answer: 'x'.repeat(5000),
      checks: [{ name: 'status 2xx', ok: false, detail: '404 Not Found' }] }),
    step('s3', 'Create the order', 'shopApi/createOrder', 'skip', { note: 'changes data: not run (allow writes on the scenario, then Run with writes)' })
  ] }]
};
const fmt = (iso) => String(iso).replace('T', ' ').slice(0, 16);

T.section('the model: the scenario, the run, its steps, checks and evidence');
const m = R.model(SC, RUN, { fmt, now: '2026-11-17T10:00:00.000Z', madeBy: 'priya.raman' });
T.check('the title is the ID and name; the file name too; the verdict FAILED', m.title === 'SC-0007 · Happy path — New Order' && m.file === 'SC-0007-test-results' && m.verdict === 'FAILED' && !m.ok, m.title);
T.check('the page tested by its label; the flow by its pages; the scope; when and by whom', m.page.label === 'New Order' && m.flow.join(' → ') === 'New Order → Order' && m.scope === 'Whole flow'
  && m.runAt === '2026-11-17 09:30' && m.runBy === 'priya.raman', JSON.stringify([m.page, m.flow, m.scope]));
T.check('counts: 1 passed, 1 failed, 1 not run; 2 of 3 checks passed; 2.3 s', m.counts.passed === 1 && m.counts.failed === 1 && m.counts.skipped === 1 && m.counts.checksOk === 2 && m.counts.checksFailed === 1
  && m.counts.seconds === 2.3, JSON.stringify(m.counts));
T.check('each step: its number in the scenario, its page, method, result, HTTP status, time, rows, checks, values handed on',
  m.steps.length === 3 && m.steps[0].n === 1 && m.steps[0].page === 'New Order' && m.steps[0].method === 'GET' && m.steps[0].result === 'Passed' && m.steps[0].status === 200
  && m.steps[0].ms === 41 && m.steps[0].rows === 2 && m.steps[0].checks === '2 of 2' && m.steps[0].handed === 'customer = 8', JSON.stringify(m.steps[0]));
T.check('…a step on a flow page under that page; a failed one Failed; a held write Not run with its note, no time',
  m.steps[1].page === 'Order' && m.steps[1].result === 'Failed' && m.steps[2].result === 'Not run' && m.steps[2].ms === '' && m.steps[2].method === 'POST' && /changes data/.test(m.steps[2].note), JSON.stringify(m.steps.slice(1)));
T.check('checks: every check of every step, failed marked', m.checks.length === 3 && m.checks[2].result === 'Failed' && m.checks[2].detail === '404 Not Found' && m.checks[2].n === 2, JSON.stringify(m.checks[2]));
T.check('evidence: each request sent and its answer (a long answer cut, said)', m.evidence.length === 2 && m.evidence[0].request === 'GET http://127.0.0.1:9/shop/v1/customers'
  && m.evidence[1].answer.length < 4100 && /cut: 5000 characters in all/.test(m.evidence[1].answer), m.evidence[0].request);
const sum = {};
m.summary.forEach((f) => { sum[f.field] = f.value; });
T.check('the summary: ID, type, page with its path, what ran, writes, notes, who made the report', sum['Scenario ID'] === 'SC-0007' && sum.Type === 'Happy path' && sum['Page tested'] === 'New Order — shop/orders/order-create'
  && sum['What ran'] === 'Whole flow' && /^No/.test(sum['Writes allowed']) && sum.Notes === 'Orders for a <new> customer' && sum['Report made'] === '2026-11-17 10:00 by priya.raman', JSON.stringify(sum));
const noAns = R.model(SC, RUN, { fmt, answers: false });
T.check('without the answers: no evidence (and no Evidence sheet)', noAns.evidence.length === 0 && R.sheets(noAns).map((x) => x.name).join() === 'Summary,Steps,Checks');
const two = R.model(SC, Object.assign({}, RUN, { rows: [Object.assign({}, RUN.rows[0], { vars: { id: '41' } }), Object.assign({}, RUN.rows[0], { vars: { id: '42' } })] }), { fmt });
T.check('several data rows: each step says its row (Row 2: id=42), a Data row column first', two.multi && two.steps.length === 6 && two.steps[3].rowText === 'Row 2: id=42' && R.sheets(two)[1].columns[0].label === 'Data row', two.steps[3].rowText);

T.section('Excel: the sheets, their preview, the workbook');
const sh = R.sheets(m);
T.check('four sheets: Summary, Steps, Checks, Evidence — Steps with its columns', sh.map((x) => x.name).join() === 'Summary,Steps,Checks,Evidence'
  && sh[1].columns.map((c) => c.label).slice(0, 6).join() === 'Step,Page,Step name,Method,API,Result', sh[1].columns.map((c) => c.label).join());
const pv = R.preview(m);
T.check('the preview: column letters, the header, rows numbered from 2; results marked passed / failed / not run', pv[1].letters.slice(0, 3).join() === 'A,B,C' && pv[1].head[0] === 'Step'
  && pv[1].body[0].n === '2' && /ok/.test(pv[1].body[0].cells[5].cls) && /bad/.test(pv[1].body[1].cells[5].cls) && /skip/.test(pv[1].body[2].cells[5].cls) && pv[1].body[0].cells[0].num, JSON.stringify(pv[1].body[0].cells[5]));
T.check('…a long cell cut in the preview, whole in the workbook', pv[3].body[1].cells[5].v.length <= 301 && pv[3].body[1].cells[5].full.length > 4000);
const book = K.xlsxBook(sh);
const text = Buffer.from(book).toString('latin1');
T.check('the workbook: a zip with one worksheet per sheet, named in the workbook', text.startsWith('PK') && /xl\/worksheets\/sheet4\.xml/.test(text) && !/sheet5\.xml/.test(text)
  && /<sheet name="Summary" sheetId="1" r:id="rId1"\/><sheet name="Steps"/.test(text) && /<sheet name="Evidence" sheetId="4" r:id="rId4"\/>/.test(text) && /Target="styles\.xml"/.test(text));
T.check('…numbers stay numbers (HTTP 200), text inline, each sheet with its filter', /<c r="G2"><v>200<\/v><\/c>/.test(text) && /localSheetId="3"/.test(text) && /<autoFilter ref="A1:F3"\/>/.test(text), (text.match(/<autoFilter ref="[^"]+"\/>/g) || []).join(' '));
const dup = Buffer.from(K.xlsxBook([{ name: 'Steps', rows: [], columns: [{ key: 'a', label: 'A' }] }, { name: 'Steps', rows: [], columns: [{ key: 'a', label: 'A' }] }, { name: 'a/b:c', rows: [], columns: [{ key: 'a', label: 'A' }] }])).toString('latin1');
T.check('…two sheets with one name kept apart (Steps, Steps 2); names made safe for Excel', /<sheet name="Steps" /.test(dup) && /<sheet name="Steps 2" /.test(dup) && /<sheet name="a b c" /.test(dup));
const one = Buffer.from(K.xlsx([{ a: 1 }], [{ key: 'a', label: 'A' }], 'Rows')).toString('latin1');
T.check('xlsx (one sheet) still writes one sheet', /<sheet name="Rows" sheetId="1" r:id="rId1"\/>/.test(one) && !/sheet2\.xml/.test(one));

T.section('the PDF: a printable document, A4 landscape');
const doc = R.html(m, { madeBy: 'priya.raman' });
T.check('a whole document, A4 landscape, its title the scenario', /^<!doctype html>/.test(doc) && /@page \{ size: A4 landscape/.test(doc) && /<title>Test results — SC-0007 · Happy path — New Order<\/title>/.test(doc));
T.check('the verdict, the counts, the facts, the steps with their results, the checks, the evidence', /class="verdict bad">FAILED</.test(doc) && /<b>1<\/b><span>steps passed/.test(doc)
  && /2 \/ 3<\/b><span>checks passed/.test(doc) && /<h2>Steps<\/h2>/.test(doc) && /pill bad">Failed</.test(doc) && /<h2>Checks on the answers<\/h2>/.test(doc) && /Evidence: each request and its answer/.test(doc)
  && /the full answer is in the Excel workbook/.test(doc));
T.check('everything escaped (the notes\' <new> is text), no script', /Orders for a &lt;new&gt; customer/.test(doc) && !/<script/i.test(doc));
T.check('without the answers: no evidence section', !/Evidence: each request/.test(R.html(noAns)));
T.check('a passed run: PASSED in green', /class="verdict ok">PASSED</.test(R.html(R.model(SC, Object.assign({}, RUN, { ok: true }), { fmt }))));
T.check('the file name: its ID, test results, the day', R.fileName(m, 'pdf', new Date('2026-11-17T12:00:00Z')) === 'SC-0007-test-results-2026-11-17.pdf'
  && R.fileName(R.model({ name: 'x' }, RUN, { fmt }), 'xlsx', new Date('2026-11-17T12:00:00Z')) === 'scenario-test-results-2026-11-17.xlsx');

T.section('no run: the test script');
const sp = R.model(SC, null, { fmt, now: '2026-11-17T10:00:00.000Z' });
T.check('the test script: NOT RUN, its file name, every step in order with its request, values sent, hands on, checks to make and why', sp.plan && sp.verdict === 'NOT RUN' && sp.file === 'SC-0007-test-script'
  && sp.steps.length === 3 && sp.steps[0].url === 'GET shopApi/getCustomers' && sp.steps[2].method === 'POST' && /changes data/.test(sp.steps[2].note) && sp.steps[1].page === 'Order'
  && sp.steps.every((x) => x.result === 'Not run yet'), JSON.stringify(sp.steps.map((x) => [x.n, x.url, x.note])));
const sp2 = R.model({ code: 'SC-1', name: 'x', page: 'a/b', steps: [{ id: 'a', name: 'List', endpoint: 'p/list', api: { method: 'GET', base: 'http://h', path: '/list' }, lov: { field: 'Customer', target: 'customer' },
  extract: [{ var: 'customer', from: 'items[0].id' }], expect: { status: '2xx', maxMs: 900, sameShape: true, fields: [{ path: 'items[0].id', equals: null }] } },
  { id: 'b', name: 'Create', endpoint: 'p/create', writes: true, api: { method: 'POST', base: 'http://h', path: '/c' }, params: { id: '{{customer}}', note: '' } }] }, null, { fmt });
T.check('…the request with its base and path; values sent (a missing one as ?); hands on; the checks it will make, in words', sp2.steps[0].url === 'GET http://h/list' && sp2.steps[1].sent === 'id = {{customer}}; note = ?'
  && sp2.steps[0].handed === 'customer = items[0].id' && sp2.checks.filter((c) => c.n === 1).map((c) => c.check).join(' | ') === 'status 2XX | within 900 ms | same shape as its example | items[0].id is there | the list has values (Customer)'
  && sp2.checks.every((c) => c.result === 'To check'), JSON.stringify(sp2.checks));
T.check('…sheets Summary, Test script, Checks (no evidence); the document says test script, NOT RUN, no run facts', R.sheets(sp).map((x) => x.name).join() === 'Summary,Test script,Checks'
  && /API test script/.test(R.html(sp)) && /class="verdict plan">NOT RUN</.test(R.html(sp)) && /Steps, in the order they run/.test(R.html(sp)) && !/Evidence/.test(R.html(sp)) && !/Run by/.test(R.html(sp)));
T.check('…a run\'s steps say what they sent too', m.steps[0].sent === '' && R.model(SC, RUN, { fmt }).steps[1].sent === '');

T.report();
