/*
 * API Scenarios (Application → API Scenarios; desktop/lib/apiScenarios.js), in a browser, on the sample VB app's real pages
 * (tests/fixtures/vb-sample) and the harness's fake backend: a page's calls drafted in the order the page makes them, run
 * purely through the APIs (no page opened), each answer checked, every run kept; a value the page gets from the screen
 * before it asked for under Data; BI Publisher run as the page's report where the page calls it; a call that changes data
 * held unless allowed; opened on a page from Application pages' API button.
 *
 * Run:  node tests/e2e/api-scenarios.e2e.js   (after npm run build)
 */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const E = require('./harness');
const H = require('../_harness');
const A = require('../../desktop/lib/apiTest');
const S = require('../../desktop/lib/apiScenarios');

const T = H.makeAsserter();
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const LIST = 'shop/orders/order-list', CREATE = 'shop/orders/order-create', DETAIL = 'shop/orders/order-detail';
const EXAMPLE = JSON.parse(fs.readFileSync(path.join(E.FIXTURE, 'services/shopApi/examples/getOrders/response_default_application_json_vb.json'), 'utf8'));

(async () => {
  const pg = await E.pagesSandbox();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-sc-e2e-'));
  const apiStore = A.open({ root: pg.root, file: path.join(dir, 'api-tests.json') });
  const scenarioStore = S.open({ api: apiStore, dir: path.join(dir, 'scenarios') });
  const apiProject = () => ({ catalogFile: path.join(pg.root, 'services', 'catalog.json'), getIdentity: () => ({ username: 'priya.raman', roles: ['SHOP_CLERK'], fusion: null }) });
  const reportBodies = [];
  const env = await E.start({ port: 19872, pagesStore: pg.store, apiStore, apiProject, scenarioStore,
    handle: (r, res) => {
      if (r.path === '/shop/v1/orders' && r.method === 'GET') return res.json(EXAMPLE);
      if (/^\/shop\/v1\/orders\/41$/.test(r.path)) return res.json(EXAMPLE.data[0]);
      if (r.path === '/shop/v1/customers' && r.method === 'GET') return res.json({ items: [{ id: 7, name: 'Acme Tools' }, { id: 8, name: 'Blue River' }] });
      if (r.path.endsWith('/ExternalReportWSSService') && /CUSTOMERS_RP/.test(r.body)) { reportBodies.push(r.body); return res.bip([{ CUSTOMER_ID: '7', CUSTOMER_NAME: 'Acme Tools' }]); }
      return false;
    } });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const pick = async (id) => {
    await page.click('#scPages .nx-sc-pagerow[data-key="' + id + '"]');
    await page.waitForSelector('#scDraft', { timeout: 10000 });
    await page.waitForTimeout(300);
  };
  const draft = async () => { await page.click('#scDraft'); await page.waitForSelector('#scSteps .nx-sc-step', { timeout: 10000 }); await page.waitForTimeout(300); };
  const saveRun = async () => {
    const before = await page.$$eval('#scRuns .nx-sc-runrow', (r) => r.length).catch(() => 0);
    await page.click('#scRunThis');
    await page.waitForFunction((n) => document.querySelectorAll('#scRuns .nx-sc-runrow').length > n && document.querySelector('#scRun .nx-sc-res'), before, { timeout: 20000 });
    await page.waitForTimeout(300);
  };
  const results = () => page.$$eval('#scRun .nx-sc-res', (a) => a.map((x) => ({ state: (x.className.match(/nx-sc-res--(\w+)/) || [])[1], name: ((x.querySelector('b') || {}).textContent || '').trim(),
    note: ((x.querySelector('.nx-sc-resnote') || {}).textContent || '').trim(), handed: ((x.querySelector('.nx-sc-handed') || {}).textContent || '').trim() })));
  try {
    T.section('a new screen in the menu, its pages from your workspace');
    await env.open('/?open=api-scenarios');
    await page.waitForSelector('#scPages .nx-sc-pagerow', { timeout: 30000 });
    const ids = await page.$$eval('#scPages .nx-sc-pagerow', (r) => r.map((x) => x.getAttribute('data-key')));
    T.check('API Scenarios in the Application group; the workspace\'s pages listed', (await page.$('.nx-nav-item[data-nav-id="api-scenarios"], [data-nav-id="api-scenarios"]')) !== null
      && [LIST, CREATE, DETAIL].every((x) => ids.indexOf(x) !== -1), ids.join());

    T.section('a page\'s calls drafted, run through the APIs alone');
    await pick(LIST);
    await draft();
    const calls = await page.$$eval('#scSteps .nx-sc-call', (a) => a.map((x) => x.textContent.trim()));
    T.check('drafted from the page\'s code: its call, checked for status, time and shape', calls.join() === 'shopApi/getOrders', calls.join());
    await saveRun();
    let res = await results();
    T.check('Save & run: passed, the answer checked (2xx, time, same shape as the example the page was built with)', /^✓ Passed/.test(await text(page, '#scRun h2')) && res.length === 1 && res[0].state === 'ok', await text(page, '#scRun h2'));
    T.check('…the call went to the workspace\'s backend; nothing changed', env.calls.some((c) => /^GET \/shop\/v1\/orders/.test(c)) && env.writes.length === 0, env.calls.join(' | '));
    T.check('…kept: the run listed, the scenario card shows its last run', (await page.$$('#scRuns .nx-sc-runrow')).length === 1 && /✓ passed/.test(await text(page, '.nx-sc-card .nx-sc-last')));
    await env.shot('api-scenarios.png');

    T.section('a value the page gets from the screen before it');
    await pick(DETAIL);
    await draft();
    const dataNow = await page.$eval('#scData textarea', (t) => t.value);
    T.check('the draft asks for it under Data (a header, an empty row) and says so', /^id\s*$/.test(dataNow.trim()) && /Give id under Data/.test(await page.$eval('#scNotes textarea', (t) => t.value)), JSON.stringify(dataNow));
    await saveRun();
    res = await results();
    T.check('run without it: the step says which value and where to give it', res[0].state === 'fail' && /no value for id — give it under Data/.test(res[0].note), JSON.stringify(res));
    await page.fill('#scData textarea', 'id\n41');
    await page.press('#scData textarea', 'Tab');
    await page.waitForTimeout(300);
    await saveRun();
    res = await results();
    T.check('given (id = 41): sent with it, passed', res[0].state === 'ok' && env.calls.some((c) => c === 'GET /shop/v1/orders/41') && /^✓ Passed/.test(await text(page, '#scRun h2')), JSON.stringify(res));

    T.section('BI Publisher where the page calls it; writes held');
    await pick(CREATE);
    await draft();
    const cc = await page.$$eval('#scSteps .nx-sc-call', (a) => a.map((x) => x.textContent.trim()));
    T.check('its report in place of the SOAP call (its path found in the app\'s code), the create last and marked', cc.length === 3 && cc[0] === 'shopApi/getCustomers'
      && /^report \/Custom\/Shop\/CUSTOMERS_RP\.xdo$/.test(cc[1]) && cc[2] === 'shopApi/createOrder' && (await page.$$('#scSteps .nx-sc-step--writes')).length === 1, cc.join(' | '));
    const repParams = await page.$$eval('#scSteps oj-text-area[data-field="params"] textarea', (a) => a[1].value);
    T.check('…its parameter from the code, ready for a value', /^P_CUSTOMER_ID =\s*$/.test(repParams.trim()), JSON.stringify(repParams));
    const pBox = (await page.$$('#scSteps oj-text-area[data-field="params"] textarea'))[1];
    await pBox.fill('P_CUSTOMER_ID = 42'); await pBox.press('Tab'); await page.waitForTimeout(300);
    await saveRun();
    res = await results();
    T.check('run: the reads and the report checked, the create not sent (writes not allowed)', res[0].state === 'ok' && res[1].state === 'ok' && res[2].state === 'skip' && env.writes.length === 0, JSON.stringify(res));
    T.check('…the report sent with the value given (P_CUSTOMER_ID = 42)', reportBodies.some((b) => /reportAbsolutePath>\/Custom\/Shop\/CUSTOMERS_RP\.xdo</.test(b) && /P_CUSTOMER_ID[\s\S]{0,200}>42</.test(b)), (reportBodies[reportBodies.length - 1] || '').slice(0, 300));

    T.section('a list of values: its values shown, picked as on the page, here and in the steps that send it');
    const lovInfo = await text(page, '#scSteps .nx-sc-step:first-child .nx-sc-lovinfo');
    T.check('the Customer dropdown found in the code: its step says so (what it keeps, the value it hands on)', /^List of values: Customer/.test(await page.$eval('#scSteps .nx-sc-step:first-child .nx-sc-stepname', (e) => e.value))
      && /Customer on the page: .*keeps id → hands it on as \{\{customer\}\}/.test(lovInfo), lovInfo);
    T.check('…its values there, from the run (the first one used until another is picked)', /Acme Tools/.test(await text(page, '#scSteps .nx-sc-step:first-child .nx-sc-values')) && /Blue River/.test(await text(page, '#scSteps .nx-sc-step:first-child .nx-sc-values'))
      && /the first value: Acme Tools \(7\)/.test(await text(page, '#scSteps .nx-sc-step:first-child .nx-sc-picked')), await text(page, '#scSteps .nx-sc-step:first-child .nx-sc-picker'));
    T.check('…and in the run: how many, which', /Customer: 2 value\(s\) — Acme Tools, Blue River/.test(await text(page, '#scRun .nx-sc-resvalues')), await text(page, '#scRun .nx-sc-resvalues'));
    // the report sends the customer picked: the same list shows on its step too
    const pBox2 = (await page.$$('#scSteps oj-text-area[data-field="params"] textarea'))[1];
    await pBox2.fill('P_CUSTOMER_ID = {{customer}}'); await pBox2.press('Tab'); await page.waitForTimeout(400);
    const repStep = '#scSteps .nx-sc-step:nth-child(2)';
    T.check('a step that sends {{customer}}: the list\'s values right there', (await page.$$(repStep + ' .nx-sc-picker .nx-sc-value')).length === 2, await text(page, repStep + ' .nx-sc-picker').catch(() => ''));
    await page.click(repStep + ' .nx-sc-value[data-value="8"]');
    await page.waitForTimeout(400);
    T.check('picked there (Blue River): marked on both steps', /picked: Blue River \(8\)/.test(await text(page, repStep + ' .nx-sc-picked')) && /picked: Blue River \(8\)/.test(await text(page, '#scSteps .nx-sc-step:first-child .nx-sc-picked'))
      && (await page.$$('#scSteps .nx-sc-value--on[data-value="8"]')).length === 2, await text(page, repStep + ' .nx-sc-picked'));
    const before = reportBodies.length;
    await saveRun();
    T.check('Save & run: the value picked handed on and sent (P_CUSTOMER_ID = 8)', reportBodies.length > before && /P_CUSTOMER_ID[\s\S]{0,200}>8</.test(reportBodies[reportBodies.length - 1])
      && /customer = 8/.test(await text(page, '#scRun .nx-sc-handed')), (reportBodies[reportBodies.length - 1] || '').slice(0, 200));
    await page.fill('#scSteps .nx-sc-step:first-child .nx-sc-pickq', 'acme'); await page.waitForTimeout(300);
    T.check('find a value by name', (await page.$$('#scSteps .nx-sc-step:first-child .nx-sc-value')).length === 1, String((await page.$$('#scSteps .nx-sc-step:first-child .nx-sc-value')).length));
    await env.shot('api-scenarios-lov.png');

    T.section('opened on a page from Application pages');
    await env.open('/?open=app-pages');
    await page.waitForSelector('#pgRows .nx-pg-row', { timeout: 30000 });
    await page.click('.nx-pg-apibtn[data-key="' + DETAIL + '"]');
    await page.waitForSelector('#scPages .nx-sc-pagerow--on', { timeout: 15000 });
    T.check('the API button beside a page opens API Scenarios on it, its scenario and last run there', (await text(page, '#scPages .nx-sc-pagerow--on span')) === DETAIL
      && /✓ passed/.test(await text(page, '.nx-sc-card .nx-sc-last')), await text(page, '#scPages .nx-sc-pagerow--on'));

    T.check('no page errors', errs().length === 0, errs().slice(0, 3).join(' | '));
  } catch (e) {
    T.check('ran through', false, e.message);
    await env.shot('api-scenarios-fail.png').catch(() => {});
  } finally {
    await env.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
    pg.restore();
  }
  T.report();
})();
