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
const OPT = '.oj-listbox-drop li.oj-listview-item-element'; // an option of an oj-select-single's open list
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const LIST = 'shop/orders/order-list', CREATE = 'shop/orders/order-create', DETAIL = 'shop/orders/order-detail', PICK = 'shop/customers/customer-pick';

/** A page whose Customer is a search as you type, as real apps write it: a provider in the page module fires an event, a chain runs a report with the text. */
function writeSearchPage(root) {
  const dir = path.join(root, 'webApps', 'shop', 'flows', 'customers', 'pages');
  fs.mkdirSync(path.join(dir, 'customer-pick-page-chains'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'customer-pick-page.html'), '<div class="oj-web-applayout-max-width"><h1>New Order</h1>\n'
    + '  <oj-select-single label-hint="Customer Type" data="[[ $variables.requestTypeADP ]]" item-text="label" value="{{ $variables.requestTypeSel }}"></oj-select-single>\n'
    + '  <oj-bind-if test="[[ $variables.requestTypeSel !== ' + "'" + 'EXTERNAL' + "'" + ' ]]">\n'
    + '  <oj-select-single aria-label="Customer" value="[[ $page.variables.picked && $page.variables.picked.CustomerId != null ? String($page.variables.picked.CustomerId) : null ]]"\n'
    + '    data="[[ $functions.customerProvider() ]]" item-text="Customer">\n'
    + '    <template slot="itemTemplate"><span><oj-bind-text value="[[ $current.data.Customer ]]"></oj-bind-text></span><small><oj-bind-text value="[[ $current.data.CustomerNumber ]]"></oj-bind-text></small></template>\n'
    + '  </oj-select-single>\n  </oj-bind-if>\n'
    + '  <oj-bind-if test="[[ $variables.requestTypeSel === ' + "'" + 'EXTERNAL' + "'" + ' ]]">\n'
    + '  <oj-select-single label-hint="Customer (external)" data="[[ $variables.extADP ]]" item-text="name" value="{{ $variables.extCustomerId }}"></oj-select-single>\n'
    + '  </oj-bind-if>\n</div>\n');
  fs.writeFileSync(path.join(dir, 'customer-pick-page.json'), JSON.stringify({ description: 'New Order', variables: { picked: { type: 'any', defaultValue: null },
    requestTypeSel: { type: 'string' }, requestTypeArray: { type: 'any[]', defaultValue: [{ value: 'INTERNAL', label: 'Internal' }, { value: 'EXTERNAL', label: 'External' }] },
    requestTypeADP: { type: 'vb/ArrayDataProvider2', defaultValue: { keyAttributes: 'value', data: '{{ $page.variables.requestTypeArray }}' } },
    extCustomers: { type: 'any[]', defaultValue: [] }, extADP: { type: 'vb/ArrayDataProvider2', defaultValue: { keyAttributes: 'id', data: '{{ $page.variables.extCustomers }}' } }, extCustomerId: { type: 'string' } },
    events: { customerSearchRequested: { payloadType: 'object' } },
    eventListeners: { vbEnter: { chains: [{ chain: 'LoadExternalChain' }] }, customerSearchRequested: { chains: [{ chain: 'CustomerSearchChain', parameters: { searchValue: '[[ $event.text ]]' } }] } } }, null, 2));
  fs.writeFileSync(path.join(dir, 'customer-pick-page-chains', 'LoadExternalChain.js'), "define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {\n  'use strict';\n"
    + "  class LoadExternalChain extends ActionChain {\n    async run(context) {\n      const res = await Actions.callRest(context, { endpoint: 'shopApi/getCustomers' });\n"
    + "      context.$page.variables.extCustomers = res.ok ? res.body.items || [] : [];\n    }\n  }\n  return LoadExternalChain;\n});\n");
  fs.writeFileSync(path.join(dir, 'customer-pick-page.js'), "define([], () => {\n  'use strict';\n  class PageModule {\n    constructor(context) {\n      const self = this;\n"
    + "      this._custDP = new SearchProvider(function (text) { self._emit('customerSearchRequested', text); }, 'CustomerId');\n    }\n"
    + "    customerProvider() {\n      return this._custDP;\n    }\n  }\n  return PageModule;\n});\n");
  fs.writeFileSync(path.join(dir, 'customer-pick-page-chains', 'CustomerSearchChain.js'), "define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/shopRules'], (ActionChain, Actions, rules) => {\n  'use strict';\n"
    + "  class CustomerSearchChain extends ActionChain {\n    async run(context, params) {\n      const text = params && params.searchValue != null ? String(params.searchValue).trim() : '';\n"
    + "      const response = await Actions.callRest(context, { endpoint: 'bipService/runBIPReport', body: { reportAbsolutePath: '/Custom/Shop/CUST_LOV_RP.xdo',\n"
    + "        parameterNameValues: [{ name: 'P_SEARCH', values: [text] }, { name: 'P_SEARCH_BY', values: ['ALL'] }] } });\n"
    + "      const rows = rules.decodeReportRows(response.body, 'G_1').map((r) => ({ CustomerId: r.CUSTOMERID, Customer: r.CUSTOMER, CustomerNumber: r.CUSTOMERNUMBER }));\n"
    + "      context.$page.functions.deliver(text, rows);\n    }\n  }\n  return CustomerSearchChain;\n});\n");
}
const EXAMPLE = JSON.parse(fs.readFileSync(path.join(E.FIXTURE, 'services/shopApi/examples/getOrders/response_default_application_json_vb.json'), 'utf8'));

(async () => {
  const pg = await E.pagesSandbox();
  writeSearchPage(pg.root);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-sc-e2e-'));
  const apiStore = A.open({ root: pg.root, file: path.join(dir, 'api-tests.json') });
  const scenarioStore = S.open({ api: apiStore, dir: path.join(dir, 'scenarios') });
  const apiProject = () => ({ catalogFile: path.join(pg.root, 'services', 'catalog.json'), getIdentity: () => ({ username: 'priya.raman', roles: ['SHOP_CLERK'], fusion: null }) });
  const reportBodies = [];
  const searches = []; // the text each search-as-you-type report was run with
  let appUrl = 'http://localhost:18950/vp/shell/orders/order-create'; // the app's window (▶ Run): the page it shows
  const appWindow = () => (appUrl ? { url: appUrl, title: 'Working copy — Shop' } : null);
  const env = await E.start({ port: 19872, pagesStore: pg.store, apiStore, apiProject, scenarioStore, appWindow,
    handle: (r, res) => {
      if (r.path === '/shop/v1/orders' && r.method === 'GET') return res.json(EXAMPLE);
      if (/^\/shop\/v1\/orders\/41$/.test(r.path)) return res.json(EXAMPLE.data[0]);
      if (r.path === '/shop/v1/customers' && r.method === 'GET') return res.json({ items: [{ id: 7, name: 'Acme Tools' }, { id: 8, name: 'Blue River' }] });
      if (r.path.endsWith('/ExternalReportWSSService') && /CUST_LOV_RP/.test(r.body)) {
        const q = (/<pub:name>P_SEARCH<\/pub:name><pub:values><pub:item>([^<]*)</.exec(r.body) || [])[1] || '';
        searches.push(q);
        const all = [{ CUSTOMERID: '300100', CUSTOMER: 'HARBOR STEEL WORKS INC', CUSTOMERNUMBER: 'CR10042' }, { CUSTOMERID: '300200', CUSTOMER: 'MAPLE FREIGHT CO', CUSTOMERNUMBER: 'CR10077' }];
        return res.bip(all.filter((x) => !q || (x.CUSTOMER + ' ' + x.CUSTOMERNUMBER).toUpperCase().indexOf(q.toUpperCase()) !== -1));
      }
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

    T.section('the page your app\'s window is on: the one you test');
    await page.waitForSelector('#scAppAt', { timeout: 10000 });
    T.check('said: your app\'s window is on New Order (order-create); it is marked in the list', /Your app's window is on New Order shop\/orders\/order-create/.test(await text(page, '#scAppAt'))
      && /● open in your app/.test(await text(page, '#scPages .nx-sc-pagerow[data-key="' + CREATE + '"]')), await text(page, '#scAppAt'));
    T.check('two pages with one title ("New Order"): each says so', /same title as another page/.test(await text(page, '#scPages .nx-sc-pagerow[data-key="' + CREATE + '"]'))
      && /same title as another page/.test(await text(page, '#scPages .nx-sc-pagerow[data-key="' + PICK + '"]')) && !/same title/.test(await text(page, '#scPages .nx-sc-pagerow[data-key="' + LIST + '"]')));
    await page.click('#scAppAtOpen');
    await page.waitForSelector('#scDraft', { timeout: 10000 });
    T.check('"Test this page": that page opened, said to be the one you test', (await text(page, '#scPages .nx-sc-pagerow--on span')) === CREATE && /✓ the page you are testing/.test(await text(page, '#scAppAt')));
    // the app's window goes elsewhere; back in Build.Rite, it follows
    appUrl = 'http://localhost:18950/vp/shell/orders/order-list?from=menu';
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => /Order Workbench/.test((document.getElementById('scAppAt') || {}).textContent || ''), null, { timeout: 10000 });
    T.check('back from the app\'s window (now on Order Workbench): it follows, offers that page', /Your app's window is on Order Workbench shop\/orders\/order-list/.test(await text(page, '#scAppAt')) && !!(await page.$('#scAppAtOpen')), await text(page, '#scAppAt'));
    appUrl = '';

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

    T.section('the journey: where the page goes next in the app');
    await page.waitForSelector('#scNext', { timeout: 10000 });
    T.check('Continue the journey: where Order Workbench goes (a row opens the order)', /→ Order\b/.test(await text(page, '#scNext')), await text(page, '#scNext'));
    await page.click('#scNext button[data-key="' + DETAIL + '"]');
    await page.waitForSelector('#scSteps .nx-sc-pagehead', { timeout: 10000 });
    await page.waitForTimeout(300);
    const heads = await page.$$eval('#scSteps .nx-sc-pagehead', (a) => a.map((x) => x.textContent.trim()));
    const jcalls = await page.$$eval('#scSteps .nx-sc-call', (a) => a.map((x) => x.textContent.trim()));
    T.check('its steps after the list\'s, under the page they are on', heads.length === 2 && /^On Order Workbench/.test(heads[0]) && /^Then, on Order/.test(heads[1]) && jcalls.join() === 'shopApi/getOrders,shopApi/getOrderById', heads.join(' | ') + ' / ' + jcalls.join());
    T.check('…the order\'s id handed on from the list (as a row clicked), nothing to give under Data', /id = auto:id/.test(await page.$eval('#scSteps .nx-sc-step:first-child oj-text-area[data-field="extract"] textarea', (t) => t.value))
      && /^id = \{\{id\}\}$/.test((await page.$$eval('#scSteps oj-text-area[data-field="params"] textarea', (a) => a[1].value)).trim()), await page.$eval('#scSteps .nx-sc-step:first-child oj-text-area[data-field="extract"] textarea', (t) => t.value));
    await saveRun();
    res = await results();
    T.check('Save & run: the list, then the order it opened, as one journey', res.length === 2 && res.every((x) => x.state === 'ok') && /handed|id =/.test(res[0].handed || 'id =') && env.calls.some((c) => /^GET \/shop\/v1\/orders\/\w+$/.test(c)), JSON.stringify(res));

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

    T.section('a list of values: searched and picked as on the page, here and in the steps that send it');
    const s1 = '#scSteps .nx-sc-step:first-child';
    const lovInfo = await text(page, s1 + ' .nx-sc-lovinfo');
    T.check('the Customer dropdown found in the code: its step says so (what it keeps, the value it hands on)', /^List of values: Customer/.test(await page.$eval(s1 + ' .nx-sc-stepname', (e) => e.value))
      && /Customer on the page: .*keeps id → hands it on as \{\{customer\}\}/.test(lovInfo), lovInfo);
    T.check('each step shows its API in full (method, the backend this PC reaches, the path)', /^GET http:\/\/127\.0\.0\.1:\d+\/shop\/v1\/customers$/.test(await text(page, s1 + ' .nx-sc-api'))
      && /^REPORT \/Custom\/Shop\/CUSTOMERS_RP\.xdo/.test(await text(page, '#scSteps .nx-sc-step:nth-child(2) .nx-sc-api')), await text(page, s1 + ' .nx-sc-api'));
    // ▶ Run: this API alone, now
    await page.click(s1 + ' .nx-sc-trybtn');
    await page.waitForSelector(s1 + ' .nx-sc-tried', { timeout: 15000 });
    T.check('▶ Run: the API run on its own — what was sent, 200, its values, its answer', /^200 · \d+ ms/.test(await text(page, s1 + ' .nx-sc-tried b'))
      && /Sent: GET http:\/\/127\.0\.0\.1:\d+\/shop\/v1\/customers/.test(await text(page, s1 + ' .nx-sc-tried .nx-sc-sent')) && /2 value\(s\): Acme Tools, Blue River/.test(await text(page, s1 + ' .nx-sc-tried .nx-sc-resvalues'))
      && /"Blue River"/.test(await text(page, s1 + ' .nx-sc-tried pre')), await text(page, s1 + ' .nx-sc-tried'));
    // the report sends the customer picked: the same list shows on its step too
    const pBox2 = (await page.$$('#scSteps oj-text-area[data-field="params"] textarea'))[1];
    await pBox2.fill('P_CUSTOMER_ID = {{customer}}'); await pBox2.press('Tab'); await page.waitForTimeout(500);
    const repStep = '#scSteps .nx-sc-step:nth-child(2)';
    T.check('a step that sends {{customer}}: the list right there, the same component the page uses', (await page.$$(repStep + ' .nx-sc-picker oj-select-single')).length === 1);
    // searched as on the page: type, pick
    const where = () => page.evaluate(() => { const r = document.querySelector('#scSteps .nx-sc-step:nth-child(2) .nx-sc-picker').getBoundingClientRect(); return Math.round(r.top); });
    await page.click(repStep + ' .nx-sc-picker oj-select-single input');
    await page.keyboard.type('blue', { delay: 60 });
    const opt = page.locator(OPT, { hasText: 'Blue River' }).first();
    await opt.waitFor({ timeout: 10000 });
    T.check('typing finds it (the values from the API, "blue" → Blue River only)', (await page.locator(OPT).count()) === 1, String(await page.locator(OPT).count()));
    const top0 = await where();
    await opt.click();
    await page.waitForFunction(() => /picked: Blue River/.test((document.querySelector('#scSteps .nx-sc-step:nth-child(2) .nx-sc-picked') || {}).textContent || ''), null, { timeout: 10000 });
    await page.waitForTimeout(400);
    const top1 = await where();
    T.check('picked there: the page stays where it is', Math.abs(top1 - top0) <= 4, top0 + ' → ' + top1);
    T.check('…shown as picked on both steps; the list\'s step reads that row from now on', /picked: Blue River/.test(await text(page, s1 + ' .nx-sc-picked'))
      && /customer = items\[id=8\]\.id/.test(await page.$eval(s1 + ' oj-text-area[data-field="extract"] textarea', (t) => t.value)), await text(page, s1 + ' .nx-sc-picked'));
    T.check('…and the API in full shows the value it will send', /P_CUSTOMER_ID=8/.test(await text(page, repStep + ' .nx-sc-api')), await text(page, repStep + ' .nx-sc-api'));
    const before = reportBodies.length;
    await saveRun();
    T.check('Save & run: the value picked handed on and sent (P_CUSTOMER_ID = 8)', reportBodies.length > before && /P_CUSTOMER_ID[\s\S]{0,200}>8</.test(reportBodies[reportBodies.length - 1])
      && /customer = 8/.test(await text(page, '#scRun .nx-sc-handed')), (reportBodies[reportBodies.length - 1] || '').slice(0, 200));
    await env.shot('api-scenarios-lov.png');

    T.section('a search as you type (a report, as on the page): what you type is sent, what it finds is shown');
    await env.open('/?open=api-scenarios');
    await page.waitForSelector('#scPages .nx-sc-pagerow', { timeout: 30000 });
    await pick(PICK);
    await draft();
    const t1 = '#scSteps .nx-sc-step:first-child';
    T.check('the Customer search found in the code: its report, the text typed as P_SEARCH, the fixed value as written', /^List of values: Customer — report CUST_LOV_RP \(a search as you type\)/.test(await page.$eval(t1 + ' .nx-sc-stepname', (e) => e.value))
      && /P_SEARCH = the text typed/.test(await text(page, t1 + ' .nx-sc-lovinfo')) && /P_SEARCH_BY = ALL/.test(await page.$eval(t1 + ' oj-text-area[data-field="params"] textarea', (t) => t.value)), await text(page, t1 + ' .nx-sc-lovinfo'));
    // the page as on your screen: Customer Type (Internal) — the External-only Customer shown as not on the page
    T.check('the page as: Customer Type, Internal chosen (as the page starts); the External-only Customer not on the page', /The page as\s*Customer Type\s*Internal\s*External/.test(await text(page, '#scChoices'))
      && (await text(page, '#scChoices .nx-sc-chip--on')) === 'Internal' && (await page.$$('#scSteps .nx-sc-step--off')).length === 1
      && /Not on the page as chosen \(Customer Type is Internal\): skipped when run/.test(await text(page, '#scSteps .nx-sc-step--off .nx-sc-when')), await text(page, '#scChoices'));
    await page.click(t1 + ' .nx-sc-picker oj-select-single input');
    // opened: the report's first rows (a blank search), as the page shows them when the field is clicked
    await page.locator(OPT, { hasText: 'MAPLE FREIGHT CO' }).first().waitFor({ timeout: 15000 });
    T.check('clicked: the report run with a blank search, its first rows listed', searches.indexOf('') !== -1 && (await page.locator(OPT).count()) === 2, JSON.stringify(searches));
    await page.keyboard.type('harbor', { delay: 60 });
    const bopt = page.locator(OPT, { hasText: 'HARBOR STEEL WORKS INC' }).first();
    await bopt.waitFor({ timeout: 15000 });
    await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 1, OPT, { timeout: 10000 }).catch(() => {});
    T.check('typing "harbor": the report run with P_SEARCH = harbor; what it finds shown with its number, as on the page', searches.indexOf('harbor') !== -1 && /CR10042/.test(await bopt.textContent())
      && (await page.locator(OPT).count()) === 1, searches.join(' | '));
    await bopt.click();
    await page.waitForFunction(() => /picked: HARBOR STEEL WORKS INC · CR10042/.test((document.querySelector('#scSteps .nx-sc-step:first-child .nx-sc-picked') || {}).textContent || ''), null, { timeout: 10000 });
    T.check('picked: it searches for its number from now on, and reads that row', /P_SEARCH = CR10042/.test(await page.$eval(t1 + ' oj-text-area[data-field="params"] textarea', (t) => t.value))
      && /CustomerId = rows\[CUSTOMERID=300100\]\.CUSTOMERID/.test(await page.$eval(t1 + ' oj-text-area[data-field="extract"] textarea', (t) => t.value)));
    await saveRun();
    T.check('Save & run: the report searched for CR10042, the customer handed on (CustomerId = 300100)', searches[searches.length - 1] === 'CR10042' && /CustomerId = 300100/.test(await text(page, '#scRun .nx-sc-handed')), searches.join(' | ') + ' / ' + await text(page, '#scRun .nx-sc-handed'));
    T.check('…the External-only list not run: not on the page as Internal', /not on the page when Customer Type is Internal/.test(JSON.stringify(await results())), JSON.stringify((await results()).map((x) => x.state + ':' + x.note)));
    await page.click('#scChoices .nx-sc-chip[data-value="EXTERNAL"]');
    await page.waitForFunction(() => (document.querySelector('#scChoices .nx-sc-chip--on') || {}).textContent === 'External', null, { timeout: 5000 });
    await page.waitForTimeout(300);
    T.check('External chosen: the report-backed Customer is the one not on the page now', (await page.$$('#scSteps .nx-sc-step--off')).length === 1
      && /report \/Custom\/Shop\/CUST_LOV_RP/.test(await text(page, '#scSteps .nx-sc-step--off .nx-sc-call')), await text(page, '#scSteps .nx-sc-step--off .nx-sc-call'));
    await env.shot('api-scenarios-search.png');

    T.section('built by you from the page\'s APIs, the order suggested; deleted');
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await env.open('/?open=api-scenarios');
    await page.waitForSelector('#scPages .nx-sc-pagerow', { timeout: 30000 });
    await pick(CREATE);
    await page.click('#scNew');
    await page.waitForSelector('#scApiList .nx-sc-apirow', { timeout: 15000 });
    const apiKeys = await page.$$eval('#scApiList .nx-sc-apirow', (a) => a.map((x) => x.getAttribute('data-key')));
    T.check('New scenario (from APIs): the APIs tab, every API of the page — its list, its report, its create', apiKeys.join() === 'shopApi/getCustomers,report:CUSTOMERS_RP,shopApi/createOrder'
      && /a list of values/.test(await text(page, '#scApiList .nx-sc-apirow[data-key="shopApi/getCustomers"] .nx-sc-apiwhere')) && /Building: My scenario — New Order · 0 step/.test(await text(page, '#scApiBar')), apiKeys.join());
    await page.click('#scApiList .nx-sc-apirow[data-key="shopApi/getCustomers"] .nx-sc-apitry');
    await page.waitForSelector('#scApiList .nx-sc-apirow[data-key="shopApi/getCustomers"] .nx-sc-tried', { timeout: 15000 });
    T.check('▶ Test: that API alone — 200, its values, what was sent', /^200 · \d+ ms/.test(await text(page, '#scApiList .nx-sc-apirow[data-key="shopApi/getCustomers"] .nx-sc-tried b'))
      && /2 value\(s\): Acme Tools, Blue River/.test(await text(page, '#scApiList .nx-sc-apirow[data-key="shopApi/getCustomers"] .nx-sc-resvalues')), await text(page, '#scApiList .nx-sc-apirow[data-key="shopApi/getCustomers"] .nx-sc-tried'));
    await env.shot('api-scenarios-apis.png');
    // added in the wrong order: the create, the report, then the list
    for (const k of ['shopApi/createOrder', 'report:CUSTOMERS_RP', 'shopApi/getCustomers']) { await page.click('#scApiList .nx-sc-apirow[data-key="' + k + '"] .nx-sc-apiadd'); await page.waitForTimeout(200); }
    T.check('+ Add to scenario: three steps in the order added', /Building: My scenario — New Order · 3 step\(s\) \(not saved yet\)/.test(await text(page, '#scApiBar'))
      && /In the scenario/.test(await text(page, '#scApiList .nx-sc-apirow[data-key="shopApi/createOrder"] .nx-sc-apiadd')), await text(page, '#scApiBar'));
    await page.click('#scApiGo');
    await page.waitForSelector('#scSteps .nx-sc-step', { timeout: 10000 });
    const rp = (await page.$$('#scSteps oj-text-area[data-field="params"] textarea'))[1];
    await rp.fill('P_CUSTOMER_ID = {{customer}}'); await rp.press('Tab'); await page.waitForTimeout(400);
    await page.click('#scSuggestBtn');
    await page.waitForSelector('#scSuggest', { timeout: 10000 });
    const sug = await page.$$eval('#scSuggest .nx-sc-suggorder li', (a) => a.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    T.check('Suggest order: the list first (it hands on {{customer}}), the report after it, the create last — why said', /^Suggested order/.test(await text(page, '#scSuggest .nx-sc-sugghead'))
      && /^List of values: Customer/.test(sug[0]) && /CUSTOMERS_RP/.test(sug[1]) && /after what hands it \{\{customer\}\} from List of values: Customer/.test(sug[1]) && /createOrder|order/i.test(sug[2]), sug.join(' | '));
    await env.shot('api-scenarios-suggest.png');
    await page.click('#scApplyOrder');
    await page.waitForTimeout(400);
    const after = await page.$$eval('#scSteps .nx-sc-call', (a) => a.map((x) => x.textContent.trim()));
    T.check('Apply this order: the steps in it', after[0] === 'shopApi/getCustomers' && /CUSTOMERS_RP/.test(after[1]) && after[2] === 'shopApi/createOrder', after.join(' | '));
    await page.click('#scSave'); await page.waitForTimeout(800);
    // one that misses a value: the report alone, sending {{customer}}
    await page.click('#scNew');
    await page.waitForSelector('#scApiList .nx-sc-apirow', { timeout: 15000 });
    await page.click('#scApiList .nx-sc-apirow[data-key="report:CUSTOMERS_RP"] .nx-sc-apiname');
    await page.waitForSelector('#scApiList .nx-sc-apirow[data-key="report:CUSTOMERS_RP"] .nx-sc-apivals textarea', { timeout: 5000 });
    const av = await page.$('#scApiList .nx-sc-apirow[data-key="report:CUSTOMERS_RP"] .nx-sc-apivals textarea');
    await av.fill('P_CUSTOMER_ID = {{customer}}'); await av.press('Tab'); await page.waitForTimeout(300);
    await page.click('#scApiList .nx-sc-apirow[data-key="report:CUSTOMERS_RP"] .nx-sc-apiadd');
    await page.click('#scApiGo');
    await page.waitForSelector('#scSuggestBtn', { timeout: 10000 });
    await page.click('#scSuggestBtn');
    await page.waitForSelector('#scMissing', { timeout: 10000 });
    T.check('…a value no step hands on: said, with the API that would (the Customer list)', /sends \{\{customer\}\}, which no step hands on\. Add: List of values: Customer/.test(await text(page, '#scMissing')), await text(page, '#scMissing'));
    await page.click('#scMissing button');
    await page.waitForFunction(() => document.querySelectorAll('#scSteps .nx-sc-step').length === 2, null, { timeout: 10000 });
    await page.waitForTimeout(300);
    T.check('+ Add it: added, the order suggested again (the list first)', /^List of values: Customer/.test(await text(page, '#scSuggest .nx-sc-suggorder li:first-child')) && !(await page.$('#scMissing')), await text(page, '#scSuggest'));
    await page.click('#scSave'); await page.waitForTimeout(800);
    // delete: one by its card, then all of the page's
    await page.click('#scTabScenarios').catch(() => {});
    const cardsBefore = (await page.$$('#scList .nx-sc-card')).length;
    await page.click('#scList .nx-sc-card .nx-sc-carddel');
    await page.waitForFunction((n) => document.querySelectorAll('#scList .nx-sc-card').length === n - 1, cardsBefore, { timeout: 10000 });
    T.check('🗑 on a card: that scenario deleted', (await page.$$('#scList .nx-sc-card')).length === cardsBefore - 1, cardsBefore + ' → ' + (await page.$$('#scList .nx-sc-card')).length);
    await page.click('#scDeleteAll');
    await page.waitForSelector('#scNone', { timeout: 10000 });
    T.check('Delete all: none left on the page', (await page.$$('#scList .nx-sc-card')).length === 0);
    await env.shot('api-scenarios-build.png');

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
    console.log('server log (last):\n  ' + env.serverLog.slice(-12).join('\n  ') + '\nsearches: ' + JSON.stringify(searches) + '\npage errors: ' + env.errors.slice(-5).join(' | '));
    await env.shot('api-scenarios-fail.png').catch(() => {});
  } finally {
    await env.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
    pg.restore();
  }
  T.report();
})();
