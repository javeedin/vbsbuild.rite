#!/usr/bin/env node
'use strict';
/*
 * A saved flow's steps run for real, in a browser (Page Flows → Saved flows → a flow → Edit steps): ▶ Run on a step opens
 * its panel — where its call goes, as whom — and a read is sent at once to the app's backend (the harness's fake one):
 * its status, time, rows as a table, the answer; a chip beside the step. BI Publisher's service runs the page's report
 * (its path read from the page's code), its rows decoded. A call that changes data is held: nothing is sent until "Send —
 * it changes data" is confirmed (cancelled: still nothing), then sent with the body as edited. A step added by hand cannot
 * run. A failure shows why. Run on an action: its reads in order, an id one answer gives handed to the next call. Run
 * the flow from the Flow tab: the Last run column, a chip opens its panel; never a call that changes data; running
 * marks nothing unsaved. Needs `npm run build`. Run: node tests/e2e/flow-run.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const A = require('../../desktop/lib/apiTest');
const I = require('../../desktop/lib/integrations');

const T = H.makeAsserter();
const JS = path.join(__dirname, '..', '..', 'webApps', 'buildrite', 'resources', 'js');
const load = (f, deps) => { let out = null; new Function('define', fs.readFileSync(path.join(JS, f), 'utf8'))((d, fn) => { out = fn.apply(null, deps || []); }); return out; };
const settle = (page, ms) => page.waitForTimeout(ms || 400);
const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
const EXAMPLE = JSON.parse(fs.readFileSync(path.join(E.FIXTURE, 'services/shopApi/examples/getOrders/response_default_application_json_vb.json'), 'utf8'));
const CUSTOMERS = { items: [{ customerId: 7, customerName: 'Acme Tools', credit: 'OK' }, { customerId: 8, customerName: 'Blue River', credit: 'ON HOLD' }, { customerId: 9, customerName: 'Cedar Works', credit: 'OK' }] };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-flowrun-e2e-'));
  const pg = await E.pagesSandbox();
  const D = load('integrationDiagram.js');
  const M = load('flowModel.js', [D]);
  const flowStore = require('../../desktop/lib/savedFlows').open({ dir: path.join(dir, 'saved-flows') });
  // FL-0001: the New Order page's flow (a read, its report, a write); FL-0002: a list, then one of its orders by id
  flowStore.save(M.fromPage(I.scan(pg.root), 'shop/orders/order-create', { name: 'Order intake', status: 'draft' }), 'Priya Raman');
  const f1 = flowStore.get('FL-0001').flow;
  const lane = f1.lanes.filter((l) => /shop/i.test(l.name))[0].id;
  flowStore.save({ name: 'Order lookup', status: 'draft', source: { kind: 'blank' }, lanes: [f1.lanes.filter((l) => l.id === lane)[0]],
    actions: [{ id: 'a1', trigger: 'when the page opens', steps: [{ id: 's1', system: lane, method: 'GET', path: '/shop/v1/orders', endpoint: 'shopApi/getOrders', object: 'Orders', direction: 'Read' },
      { id: 's2', system: lane, method: 'GET', path: '/shop/v1/orders/{id}', endpoint: 'shopApi/getOrderById', object: 'Orders', direction: 'Read' }] }] }, 'Priya Raman');
  const apiStore = A.open({ root: pg.root, file: path.join(dir, 'api-tests.json') });
  const apiProject = () => ({ catalogFile: path.join(pg.root, 'services', 'catalog.json'), getIdentity: () => ({ username: 'priya.raman', roles: ['SHOP_CLERK'], fusion: null }) });
  const posts = [];
  const byId = [];
  let failCustomers = false;
  const env = await E.start({ port: 19988, pagesStore: pg.store, flowStore, apiStore, apiProject,
    handle: (r, res) => {
      if (r.path === '/shop/v1/customers' && r.method === 'GET') return failCustomers ? res.json({ title: 'Customers are down for maintenance' }, 500) : res.json(CUSTOMERS);
      if (r.path === '/shop/v1/orders' && r.method === 'GET') return res.json(EXAMPLE);
      if (/^\/shop\/v1\/orders\/\d+$/.test(r.path) && r.method === 'GET') { byId.push(r.path); return res.json(EXAMPLE.data[0]); }
      if (r.path === '/shop/v1/orders' && r.method === 'POST') { posts.push(r.body); return res.json({ id: 900, orderNumber: 'SO-900' }, 201); }
      if (r.path.endsWith('/ExternalReportWSSService') && /CUSTOMERS_RP/.test(r.body)) return res.bip([{ CUSTOMER_ID: '7', CUSTOMER_NAME: 'Acme Tools', CREDIT_STATUS: 'OK' }, { CUSTOMER_ID: '8', CUSTOMER_NAME: 'Blue River', CREDIT_STATUS: 'ON HOLD' }]);
      return false;
    } });
  const page = env.page;
  let answer = 'accept';
  page.on('dialog', (d) => (answer === 'accept' ? d.accept() : d.dismiss()));
  const errs = () => env.errors.filter((e) => !/404|401|500|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const step = (id) => '.nx-sfp-stepwrap[data-id="' + id + '"]';
  const ids = async () => page.$$eval('#sfpActions .nx-sfp-stepwrap', (l) => l.map((x) => x.getAttribute('data-id')));
  const waitDone = async (sel) => { await page.waitForFunction((s) => { const b = document.querySelector(s); return b && !/Running/.test(b.textContent); }, sel, { timeout: 15000 }); await settle(page, 300); };
  const openFlow = async (id) => {
    await page.click('#intTabSaved');
    await page.waitForSelector('[data-act="flowOpen"][data-key="' + id + '"]', { timeout: 10000 });
    await page.click('.nx-btn[data-act="flowOpen"][data-key="' + id + '"]');
    await page.waitForSelector('#sfpTitle', { timeout: 15000 });
    await settle(page, 800);
  };
  try {
    T.section('a saved flow\'s steps, each with Run');
    await env.open('/?open=integrations');
    await page.waitForSelector('#intKpis', { timeout: 30000 });
    await openFlow('FL-0001');
    await page.click('#sfpTabEdit');
    await page.waitForSelector('#sfpActions .nx-sfp-step', { timeout: 10000 });
    await page.click('#sfpAddNote');
    await settle(page, 500);
    await page.fill('#sfpStickyList textarea', 'Ask the shop team first');
    await page.press('#sfpStickyList textarea', 'Tab');
    await settle(page, 600);
    T.check('a sticky note keeps its text in its box once you leave it (drawn again, not emptied)', (await page.inputValue('#sfpStickyList textarea')) === 'Ask the shop team first');
    await page.click('#sfpRevert');
    await settle(page, 500);
    const [s11, s12, s21] = await ids();
    const btns = await page.$$eval('#sfpActions .nx-sfp-runbtn', (l) => l.map((b) => b.disabled + ':' + b.textContent.trim()));
    T.check('every step of the page has ▶ Run (the write says it is sent only once confirmed); each action has Run', btns.join() === 'false:Run,false:Run,false:Run'
      && (await page.$$('#sfpActions .nx-sfp-runall')).length === 2 && /only once you confirm/.test(await page.getAttribute(step(s21) + ' .nx-sfp-runbtn', 'title')), btns.join());

    T.section('a read, sent at once');
    await page.click(step(s11) + ' .nx-sfp-runbtn');
    await page.waitForSelector('#sfpRun-' + s11 + ' .nx-sfp-rstatus', { timeout: 15000 });
    await settle(page);
    const p1 = '#sfpRun-' + s11;
    T.check('its panel: the call, only reads, where it goes and as whom', /^GET \/shop\/v1\/customers$/.test(await text(page, p1 + ' .nx-sfp-rcall')) && (await text(page, p1 + ' .nx-sfp-rkind')) === 'Only reads'
      && /^Goes to http:\/\/127\.0\.0\.1:\d+\/shop\/v1\/customers · as None needed$/.test(await text(page, p1 + ' .nx-sfp-rtarget')), await text(page, p1 + ' .nx-sfp-rtarget'));
    const t1 = await page.evaluate((s) => ({ heads: Array.prototype.map.call(document.querySelectorAll(s + ' .nx-sfp-rtr--head .nx-sfp-rtd'), (c) => c.textContent.trim()), rows: Array.prototype.map.call(document.querySelectorAll(s + ' .nx-sfp-rtr:not(.nx-sfp-rtr--head)'), (r) => r.textContent.trim()) }), p1);
    T.check('its answer: 200 OK, time and rows, its rows as a table, the answer itself', (await text(page, p1 + ' .nx-sfp-rstatus')) === '200 OK' && /^\d+ ms · [0-9.]+ (B|KB) · 3 rows · sent /.test(await text(page, p1 + ' .nx-sfp-rline .nx-note'))
      && t1.heads.join() === 'customerId,customerName,credit' && t1.rows.length === 3 && /Blue River/.test(t1.rows[1]) && /Rows from items/.test(await text(page, p1 + ' .nx-sfp-rres > .nx-note'))
      && !!(await page.$(p1 + ' details.nx-sfp-ranswer')), JSON.stringify(t1));
    T.check('…a chip beside the step: 200 · 3 rows · time', /^200 · 3 rows · \d+ ms$/.test(await text(page, step(s11) + ' .nx-sfp-step .nx-sfp-rchip--ok')), await text(page, step(s11) + ' .nx-sfp-step .nx-sfp-rchip'));
    await env.shot('flow-run-read.png');

    T.section('BI Publisher\'s service runs the page\'s report');
    await page.click(step(s12) + ' .nx-sfp-runbtn');
    await page.waitForSelector('#sfpRun-' + s12 + ' .nx-sfp-rstatus', { timeout: 15000 });
    await settle(page);
    const p2 = '#sfpRun-' + s12;
    T.check('the report (its path from the page\'s code), its rows decoded', /^BI Publisher report CUSTOMERS_RP$/.test(await text(page, p2 + ' .nx-sfp-rcall')) && /CUSTOMERS_RP\.xdo/.test(await text(page, p2 + ' .nx-sfp-rtarget'))
      && (await text(page, p2 + ' .nx-sfp-rstatus')) === '200 OK' && /CUSTOMER_NAME/.test(await text(page, p2 + ' .nx-sfp-rtr--head')) && (await page.$$(p2 + ' .nx-sfp-rtr:not(.nx-sfp-rtr--head)')).length === 2,
    [await text(page, p2 + ' .nx-sfp-rcall'), await text(page, p2 + ' .nx-sfp-rtarget'), await text(page, p2 + ' .nx-sfp-rstatus')].join(' | '));

    T.section('a call that changes data: held until confirmed');
    await page.click(step(s21) + ' .nx-sfp-runbtn');
    await page.waitForSelector('#sfpRun-' + s21 + ' .nx-sfp-rwrite', { timeout: 15000 });
    await settle(page);
    const p3 = '#sfpRun-' + s21;
    T.check('nothing sent: it says it changes data and where; its body to edit; a chip "held"', posts.length === 0 && (await text(page, p3 + ' .nx-sfp-rkind')) === 'Changes data'
      && /changes data on http:\/\/127\.0\.0\.1:\d+ — nothing is sent until you press "Send — it changes data"/.test(await text(page, p3 + ' .nx-sfp-rmsg')) && !!(await page.$(p3 + ' textarea.nx-sfp-rbody'))
      && (await text(page, step(s21) + ' .nx-sfp-step .nx-sfp-rchip--held')) === 'Changes data — not sent', await text(page, p3 + ' .nx-sfp-rmsg'));
    await env.shot('flow-run-write-held.png');
    await page.fill(p3 + ' textarea.nx-sfp-rbody', '{ "customerId": 8, "note": "from the flow run test" }');
    await page.press(p3 + ' textarea.nx-sfp-rbody', 'Tab');
    await settle(page, 500);
    T.check('…the body as edited stays in its box', /from the flow run test/.test(await page.inputValue(p3 + ' textarea.nx-sfp-rbody')));
    answer = 'dismiss';
    await page.click(p3 + ' .nx-sfp-rwrite');
    await settle(page, 600);
    T.check('Send — it changes data, cancelled at the confirmation: still nothing sent', posts.length === 0);
    answer = 'accept';
    await page.click(p3 + ' .nx-sfp-rwrite');
    await page.waitForSelector(p3 + ' .nx-sfp-rstatus', { timeout: 15000 });
    await settle(page);
    T.check('…confirmed: sent once, with the body as edited; 201 Created', posts.length === 1 && /from the flow run test/.test(posts[0]) && (await text(page, p3 + ' .nx-sfp-rstatus')) === '201 Created'
      && /^201 · 1 row · \d+ ms$/.test(await text(page, step(s21) + ' .nx-sfp-step .nx-sfp-rchip')), posts.join() + ' / ' + await text(page, p3 + ' .nx-sfp-rstatus'));

    T.section('a failure shows why');
    failCustomers = true;
    await page.click(p1 + ' .nx-btn--primary');
    await page.waitForFunction((s) => { const e = document.querySelector(s + ' .nx-sfp-rstatus'); return e && /500/.test(e.textContent); }, p1, { timeout: 15000 });
    await settle(page);
    T.check('Send again: 500, a red chip, its answer to read', /^500/.test(await text(page, p1 + ' .nx-sfp-rstatus')) && !!(await page.$(step(s11) + ' .nx-sfp-step .nx-sfp-rchip--fail')) && /down for maintenance/.test(await page.$eval(p1 + ' details pre', (e) => e.textContent)));
    failCustomers = false;

    T.section('closed and opened again; a step added by hand');
    await page.click(p1 + ' [data-act="runClose"]');
    await settle(page);
    T.check('closed: the panel goes, the chip stays', !(await page.$(p1)) && !!(await page.$(step(s11) + ' .nx-sfp-step .nx-sfp-rchip')));
    await page.click(step(s11) + ' .nx-sfp-step .nx-sfp-rchip');
    await page.waitForSelector(p1, { timeout: 5000 });
    T.check('…its chip opens it again, with its last answer', /^500/.test(await text(page, p1 + ' .nx-sfp-rstatus')));
    await page.click('#sfpActions .nx-sfp-action:first-of-type .nx-sfp-addstep');
    await settle(page);
    const added = (await ids()).filter((x) => [s11, s12, s21].indexOf(x) === -1)[0];
    T.check('a step added by hand: Run off, and says why', await page.$eval(step(added) + ' .nx-sfp-runbtn', (b) => b.disabled) && /Added by hand/.test(await page.getAttribute(step(added) + ' .nx-sfp-runbtn', 'title')));

    T.section('Run the flow (the Flow tab)');
    await page.click('#sfpTabFlow');
    await page.waitForSelector('#sfpRunFlow', { timeout: 5000 });
    const before = posts.length;
    await page.click('#sfpRunFlow');
    await page.waitForSelector('#sfpRunSum', { timeout: 20000 });
    await settle(page);
    const chips = await page.$$eval('#sfpSteps .nx-sfp-lastrun .nx-sfp-rchip', (l) => l.map((c) => c.className.replace(/.*rchip--/, '') + ':' + c.textContent.trim()));
    T.check('every step in order: the reads sent, the write held (never sent from here), the one added by hand passed; said in words', posts.length === before
      && /^The flow ran: 2 ok, 1 held \(change data or need a value — send them from their own panel\), 1 not run \(no call to send\)\.$/.test(await text(page, '#sfpRunSum')), await text(page, '#sfpRunSum'));
    T.check('…the Last run column: a chip per step', chips.length === 4 && /^ok:200 · 3 rows/.test(chips[0]) && /^ok:200 · 2 rows/.test(chips[1]) && /^skip:Not run/.test(chips[2]) && /^held:Changes data — not sent/.test(chips[3]), JSON.stringify(chips));
    T.check('running marks nothing unsaved but the step added by hand', /Save as version 2/.test(await text(page, '#sfpSave')));
    await env.shot('flow-run-flow.png');
    await page.click('#sfpSteps .nx-sfp-lastrun .nx-sfp-rchip');
    await page.waitForSelector(p1, { timeout: 5000 });
    T.check('a chip opens its step\'s panel on Edit steps', (await page.getAttribute('#sfpTabEdit', 'aria-selected')) === 'true' && (await text(page, p1 + ' .nx-sfp-rstatus')) === '200 OK');
    await page.click('#sfpRevert');
    await settle(page);
    await page.click('.nx-tab--on .nx-tab-close');
    await settle(page, 600);

    T.section('Run on an action: an id one answer gives, handed to the next call');
    await page.click('.nx-tab .nx-tab-title >> text=Page Flows');
    await settle(page, 600);
    await openFlow('FL-0002');
    await page.click('#sfpTabEdit');
    await page.waitForSelector('#sfpActions .nx-sfp-runall', { timeout: 10000 });
    await page.click('#sfpActions .nx-sfp-runall');
    await page.waitForSelector('#sfpRunSumEdit', { timeout: 20000 });
    await waitDone('#sfpActions .nx-sfp-runall');
    T.check('both reads sent in order: the list, then one of its orders by its id', /^Action 1 ran: 2 ok\.$/.test(await text(page, '#sfpRunSumEdit')) && byId.length === 1 && /^\/shop\/v1\/orders\/10[1-3]$/.test(byId[0]), await text(page, '#sfpRunSumEdit') + ' ' + byId.join());
    await page.click(step('s2') + ' .nx-sfp-step .nx-sfp-rchip');
    await page.waitForSelector('#sfpRun-s2 [data-run-param="id"]', { timeout: 5000 });
    T.check('…its panel shows the id and where it came from (the list\'s answer), with the others to pick', /^10[1-3]$/.test(await page.inputValue('#sfpRun-s2 [data-run-param="id"]'))
      && /path · from getOrders/.test(await text(page, '#sfpRun-s2 .nx-sfp-rparam small')) && (await page.$$('#sfpRun-s2 .nx-sfp-rchoice')).length >= 2, await text(page, '#sfpRun-s2 .nx-sfp-rparam small'));
    const other = await page.$eval('#sfpRun-s2 .nx-sfp-rchoice:last-child', (b) => b.textContent.trim());
    await page.click('#sfpRun-s2 .nx-sfp-rchoice:last-child');
    await page.click('#sfpRun-s2 .nx-btn--primary');
    await page.waitForFunction(() => /Send again/.test((document.querySelector('#sfpRun-s2 .nx-btn--primary') || {}).textContent || ''), null, { timeout: 15000 });
    await settle(page);
    T.check('a value picked, sent again with it', byId.length === 2 && byId[1] === '/shop/v1/orders/' + other, byId.join());
    await env.shot('flow-run-action.png');

    T.check('no page errors', errs().length === 0, errs().slice(0, 3).join(' | '));
  } catch (e) {
    T.check('no exception: ' + e.message, false);
    console.log('PANELS:', await page.$$eval('.nx-sfp-run', (l) => l.map((x) => x.id + ': ' + x.innerText.replace(/\s+/g, ' ').slice(0, 400))).catch(() => ''), 'POSTS:', posts.length);
    await env.shot('flow-run-failed.png').catch(() => {});
  } finally {
    await env.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  T.report();
})();
