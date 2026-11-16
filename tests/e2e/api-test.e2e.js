/*
 * The API tester (Application pages → a page → Integrations → Test; desktop/lib/apiTest.js), in a browser: your
 * workspace's pages (the sample VB app, tests/fixtures/vb-sample), their calls read from its services/ and sent to its
 * backends (the harness's fake one) — a call with Test (where it goes, the login, its rows, its shape against the example
 * it was built with, body, headers, curl), its last run beside it; a call that changes data held until confirmed; a BI
 * Publisher report of the page run with its parameter (its rows decoded); Check all reads, an id taken from a list.
 *
 * Run:  node tests/e2e/api-test.e2e.js   (after npm run build)
 */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const E = require('./harness');
const H = require('../_harness');
const A = require('../../desktop/lib/apiTest');

const T = H.makeAsserter();
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const LIST = 'shop/orders/order-list', CREATE = 'shop/orders/order-create', DETAIL = 'shop/orders/order-detail';
const EXAMPLE = JSON.parse(fs.readFileSync(path.join(E.FIXTURE, 'services/shopApi/examples/getOrders/response_default_application_json_vb.json'), 'utf8'));

(async () => {
  const pg = await E.pagesSandbox();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-api-e2e-'));
  // the calls read from your workspace (here the sandbox's copy of the sample app), sent to its backends
  const apiStore = A.open({ root: pg.root, file: path.join(dir, 'api-tests.json') });
  const apiProject = () => ({ catalogFile: path.join(pg.root, 'services', 'catalog.json'), getIdentity: () => ({ username: 'priya.raman', roles: ['SHOP_CLERK'], fusion: null }) });
  const reportBodies = [];
  const env = await E.start({ port: 19870, pagesStore: pg.store, apiStore, apiProject,
    handle: (r, res) => {
      if (r.path === '/shop/v1/orders' && r.method === 'GET') return res.json(EXAMPLE);
      if (/^\/shop\/v1\/orders\/\d+$/.test(r.path)) return res.json(EXAMPLE.data[0]);
      // a report that fails: BI Publisher's SOAP fault, gzip'd unasked (as a gateway in front of it does)
      if (r.path.endsWith('/ExternalReportWSSService') && /<pub:item>500<\/pub:item>/.test(r.body)) {
        return res.raw(500, { 'content-type': 'application/soap+xml; charset=UTF-8', 'content-encoding': 'gzip' }, require('zlib').gzipSync(Buffer.from(
          '<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body><env:Fault><env:Code><env:Value>env:Receiver</env:Value></env:Code>'
          + '<env:Reason><env:Text xml:lang="en">PublicReportService::executeRunReport Failure: no data for P_CUSTOMER_ID 500</env:Text></env:Reason></env:Fault></env:Body></env:Envelope>')));
      }
      if (r.path.endsWith('/ExternalReportWSSService') && /CUSTOMERS_RP/.test(r.body)) {
        reportBodies.push(r.body);
        return res.bip([{ CUSTOMER_ID: '7', CUSTOMER_NAME: 'Acme Tools', CREDIT_STATUS: 'OK' }, { CUSTOMER_ID: '8', CUSTOMER_NAME: 'Blue River', CREDIT_STATUS: 'ON HOLD' }]);
      }
      return false;
    } });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const dlgOpen = () => page.evaluate(() => document.getElementById('apiDlg').open);
  const openPage = async (id) => {
    await page.click('#pgRows .nx-pg-row[data-id="' + id + '"]');
    await page.waitForSelector('#pgRest', { timeout: 15000 });
    await page.waitForTimeout(400);
  };
  try {
    T.section('a page\'s REST calls, each with Test');
    await env.open('/?open=app-pages');
    await page.waitForSelector('#pgRows .nx-pg-row', { timeout: 30000 });
    await openPage(LIST);
    const rows = await page.$$eval('#pgRest .nx-pg-gr[data-endpoint]', (r) => r.map((x) => x.getAttribute('data-endpoint')));
    const tests = await page.$$eval('#pgRest .nx-api-test', (b) => b.filter((x) => !x.disabled).length);
    T.check('every call of the page has Test, with Check all reads', rows.join() === 'shopApi/getOrders' && tests === 1 && /Check all reads/.test(await text(page, '#apiCheckAll')), rows.join() + ' / ' + tests);

    T.section('one call sent to your workspace\'s backend');
    await page.click('#pgRest [data-endpoint="shopApi/getOrders"] .nx-api-test');
    await page.waitForSelector('#apiParams', { timeout: 10000 });
    T.check('the tester: where it goes (the backend\'s address and path), the login, only reads; its parameters from the service', await dlgOpen()
      && /^http:\/\/127\.0\.0\.1:\d+\/shop\/v1\/orders$/.test(await text(page, '#apiTarget')) && (await text(page, '#apiLogin')) === 'None needed'
      && (await text(page, '#apiKind')) === 'Only reads' && (await text(page, '#apiTitle')) === 'getOrders' && (await page.$$('#apiParams [data-param]')).length === 3,
      [await text(page, '#apiTarget'), await text(page, '#apiLogin'), await text(page, '#apiTitle')].join(' | '));
    await page.click('#apiSend');
    await page.waitForSelector('#apiStatus', { timeout: 15000 });
    await page.waitForTimeout(400);
    T.check('sent: 200 OK, its time and size and rows; same shape as the example the page was built with', (await text(page, '#apiStatus')) === '200 OK'
      && new RegExp('ms · [0-9.]+ (KB|B) · ' + EXAMPLE.data.length + ' rows').test(await text(page, '#apiFacts')) && /Same shape as the example/.test(await text(page, '#apiShapeBadge')), await text(page, '#apiFacts'));
    const tbl = await page.evaluate(() => ({ heads: Array.prototype.map.call(document.querySelectorAll('#apiTable .nx-api-tr--head .nx-api-td'), (c) => c.textContent.trim()),
      rows: document.querySelectorAll('#apiTable .nx-api-tr:not(.nx-api-tr--head)').length, first: (document.querySelector('#apiTable .nx-api-tr:not(.nx-api-tr--head)') || {}).textContent || '' }));
    T.check('its rows as a table: its columns, every record', tbl.rows === EXAMPLE.data.length && tbl.heads.indexOf('customerName') !== -1 && tbl.first.indexOf(EXAMPLE.data[0].customerName) !== -1, JSON.stringify(tbl).slice(0, 300));
    await env.shot('api-test.png');
    await page.click('.nx-api-tab[data-key="body"]');
    T.check('…the body, pretty', /"customerName": "/.test(await text(page, '#apiBodyOut')));
    await page.click('.nx-api-tab[data-key="headers"]');
    T.check('…its headers', /content-type\s*application\/json/.test(await text(page, '#apiHeaders')));
    await page.click('.nx-api-tab[data-key="shape"]');
    T.check('…its shape: why it matters, compared with the saved example', /Every field of the example the page was built with is still in the answer[\s\S]*services\/shopApi\/examples\/getOrders/.test(await text(page, '#apiShape')));
    await page.click('.nx-api-tab[data-key="curl"]');
    T.check('…the same call as curl', /^curl -X GET 'http:\/\/127\.0\.0\.1:\d+\/shop\/v1\/orders' \\ -H 'Accept: application\/json'/.test(await text(page, '#apiCurl')), await text(page, '#apiCurl'));
    T.check('its last runs listed', /^200 · \d+ ms · \d+ rows/.test(await text(page, '#apiHist li')));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    T.check('Esc closes it; its last run shown beside the call', !(await dlgOpen()) && /^200 · \d+ ms · \d+ rows/.test(await text(page, '#pgRest [data-endpoint="shopApi/getOrders"] .nx-api-last')));

    T.section('a call that changes data waits for "Send it"');
    await openPage(CREATE);
    await page.waitForSelector('#apiReports .nx-api-rep', { timeout: 10000 }).catch(() => {});
    const cRows = await page.$$eval('#pgRest .nx-pg-gr[data-endpoint]', (r) => r.map((x) => x.getAttribute('data-endpoint')).sort());
    T.check('New Order\'s calls, each with Test; its BI Publisher report read from its code, with Run: path and parameter', cRows.join() === 'bipService/runBIPReport,shopApi/createOrder,shopApi/getCustomers'
      && (await page.$$('#apiReports .nx-api-rep')).length === 1 && /\/Custom\/Shop\/CUSTOMERS_RP\.xdo[\s\S]*Parameters: P_CUSTOMER_ID/.test(await text(page, '#apiReports [data-report="CUSTOMERS_RP"]')), cRows.join());
    const before = env.writes.length;
    await page.click('#pgRest [data-endpoint="shopApi/createOrder"] .nx-api-test');
    await page.waitForSelector('#apiBody', { timeout: 10000 });
    await page.waitForTimeout(200);
    T.check('a POST: "changes data", its JSON body to start from', /Changes data/.test(await text(page, '#apiKind')) && (await page.$eval('#apiBody', (e) => e.value)).trim().length > 0);
    await page.fill('#apiBody', '{"customer":"C-100","note":"T-1"}');
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('#apiConfirm', { timeout: 10000 });
    T.check('Ctrl+Enter: not sent — it asks first', env.writes.length === before && /changes data on http:\/\/127\.0\.0\.1:\d+/.test(await text(page, '#apiMsg')));
    await page.click('#apiConfirm');
    await page.waitForSelector('#apiStatus', { timeout: 10000 });
    const w = env.writes[env.writes.length - 1];
    T.check('…"Send it — it changes data": sent, with its body', env.writes.length === before + 1 && w.method === 'POST' && w.path === '/shop/v1/orders' && w.body.note === 'T-1'
      && /^201/.test(await text(page, '#apiStatus')), JSON.stringify(w));
    await page.click('#apiClose');

    T.section('a BI Publisher report run');
    await page.click('#apiReports [data-report="CUSTOMERS_RP"] .nx-api-test');
    await page.waitForSelector('#apiParams [data-param="P_CUSTOMER_ID"]', { timeout: 10000 });
    T.check('the report: REPORT, to BI Publisher\'s SOAP service, its parameter from the code; no login for the app yet (said)', /REPORT/.test(await text(page, '.nx-api-method')) && /\/xmlpserver\/services\/ExternalReportWSSService$/.test(await text(page, '#apiTarget')) && (await text(page, '#apiReportPath')) === '/Custom/Shop/CUSTOMERS_RP.xdo'
      && /No login for it yet: File → Sign in for your app/.test(await text(page, '#apiLogin')), [await text(page, '.nx-api-method'), await text(page, '#apiTarget'), await text(page, '#apiLogin')].join(' | '));
    await page.fill('#apiParams [data-param="P_CUSTOMER_ID"]', '42');
    await page.click('#apiSend');
    await page.waitForSelector('#apiTable', { timeout: 10000 });
    T.check('run: the envelope the app sends (its path, P_CUSTOMER_ID=42); the report\'s rows decoded', /reportAbsolutePath>\/Custom\/Shop\/CUSTOMERS_RP\.xdo</.test(reportBodies[0] || '') && /<pub:name>P_CUSTOMER_ID<\/pub:name><pub:values><pub:item>42</.test(reportBodies[0] || '')
      && (await page.$$('#apiTable .nx-api-tr:not(.nx-api-tr--head)')).length === 2 && /Acme Tools[\s\S]*OK/.test(await text(page, '#apiTable')) && /report rows <G_1>/.test(await text(page, '#apiFacts')));
    await env.shot('api-test-report.png');
    // a report that fails, its fault gzip'd: unpacked, its reason said, its body readable XML
    await page.fill('#apiParams [data-param="P_CUSTOMER_ID"]', '500');
    await page.click('#apiSend');
    await page.waitForFunction(() => /^500/.test((document.getElementById('apiStatus') || {}).textContent || ''), null, { timeout: 10000 });
    await page.waitForTimeout(300);
    await page.click('.nx-api-tab[data-key="body"]').catch(() => {});
    T.check('a report that fails (its SOAP fault gzip\'d): the reason in words, the body readable XML', /executeRunReport Failure: no data for P_CUSTOMER_ID 500/.test(await text(page, '#apiErr'))
      && /<env:Fault>/.test(await text(page, '#apiBodyOut')), (await text(page, '#apiErr')) + ' / ' + (await text(page, '#apiBodyOut')).slice(0, 80));
    await page.click('#apiClose');
    // BI Publisher's own service in the REST calls: its Test opens the page's report (its path from the code), not a blank one
    await page.waitForTimeout(300);
    await page.click('#pgRest [data-endpoint="bipService/runBIPReport"] .nx-api-test');
    await page.waitForSelector('#apiParams [data-param="P_CUSTOMER_ID"]', { timeout: 10000 });
    T.check('runBIPReport\'s Test: the page\'s report opened (its path, its parameter), said why', (await text(page, '#apiReportPath')) === '/Custom/Shop/CUSTOMERS_RP.xdo'
      && /BI Publisher's own service: it runs this page's reports\. Showing CUSTOMERS_RP/.test(await text(page, '#apiDlg')), await text(page, '#apiReportPath'));
    await page.click('#apiClose');

    T.section('Check all reads');
    await page.click('#apiCheckAll');
    await page.waitForSelector('#apiCheckSum', { timeout: 60000 });
    const sum = await text(page, '#apiCheckSum');
    const notes = await page.$$eval('#pgRest .nx-api-chk', (n) => n.map((x) => x.textContent.trim()));
    T.check('every call that only reads, run: counted; the write and the report runner left alone', /^1 ok/.test(sum) && !/failed/.test(sum)
      && notes.some((x) => /Changes data/.test(x)) && notes.some((x) => /reports/.test(x)), sum + ' | ' + notes.join(' | '));
    await page.$eval('#apiBar', (e) => e.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    await env.shot('api-test-check.png');
    await openPage(DETAIL);
    await page.click('#apiCheckAll');
    await page.waitForSelector('#apiCheckSum', { timeout: 60000 });
    const dnotes = await page.$$eval('#pgRest .nx-api-chk', (n) => n.map((x) => x.textContent.trim()));
    T.check('…an order\'s detail: run with an id an answer above gave (the order created, or the orders read)', /^1 ok/.test(await text(page, '#apiCheckSum')) && dnotes.some((x) => /with id=\d+ \(from (createOrder|getOrders)\)/.test(x)), dnotes.join(' | '));
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.message), false);
  } finally {
    await env.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
    pg.restore();
  }
  T.report();
})();
