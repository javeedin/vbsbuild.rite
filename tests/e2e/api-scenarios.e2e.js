/*
 * API Scenarios (Application → API Scenarios; desktop/lib/apiScenarios.js), in a browser, on the sample VB app's real pages
 * (tests/fixtures/vb-sample) and the harness's fake backend. The screen opens on the list of every scenario; + New scenario
 * opens one in a tab of its own: its header (ID, name, the page it tests, type, status, made / tested by), then Main
 * scenario (the page's calls drafted in the order the page makes them, run through the APIs alone), Flow (the pages it
 * leads to, opened once the main page's APIs have all run) and Runs. Also: a value the page gets from the screen before it
 * asked for under Data; BI Publisher run as the page's report; a call that changes data held unless allowed; lists of
 * values and searches picked as on the page; built from the page's APIs; opened on a page from Application pages.
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
  // dialogs (confirms) are accepted; a section that reads one keeps its text through `asked`
  let asked = '';
  page.on('dialog', (d) => { asked = d.message(); d.accept().catch(() => {}); });
  const vis = (sel) => page.evaluate((q) => { const e = Array.prototype.slice.call(document.querySelectorAll(q)).filter((x) => x.offsetParent !== null)[0]; return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; }, sel);
  const result = () => vis('.nx-flib-result');
  const toList = async () => {
    await page.click('.nx-tab[data-tab-id="api-scenarios"] .nx-tab-btn').catch(() => page.click('.nx-tab[data-tab-id="api-scenarios"]').catch(() => {}));
    await page.waitForSelector('#scList', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(300);
  };
  // + New scenario (on the list) → its own tab; the page picked in its header
  const newSc = async (id) => {
    await toList();
    const before = await page.$$eval('.nx-tab', (t) => t.length);
    await page.click('#scNewBtn');
    await page.waitForFunction((n) => document.querySelectorAll('.nx-tab').length > n, before, { timeout: 15000 });
    await page.waitForSelector('#scPageSel', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(300);
    if (id) {
      await page.selectOption('#scPageSel', id);
      await page.waitForSelector('#scDraft', { state: 'visible', timeout: 10000 });
      await page.waitForTimeout(300);
    }
  };
  // the scenario tab shown closed (its list stays)
  const closeSc = async () => {
    await page.click('.nx-tab--on .nx-tab-close').catch(() => {});
    await page.waitForTimeout(400);
  };
  const tabTitle = () => page.$eval('.nx-tab--on .nx-tab-title', (e) => e.textContent.trim()).catch(() => '');
  const draft = async () => { await page.click('#scDraft'); await page.waitForSelector('#scSteps .nx-sc-step', { timeout: 10000 }); await page.waitForTimeout(400); };
  const runCount = async () => Number(((await text(page, '#scTabRuns')).match(/\((\d+)\)/) || [])[1] || 0);
  const runWith = async (sel) => {
    const before = await runCount();
    await page.click(sel);
    await page.waitForFunction((n) => { const m = ((document.getElementById('scTabRuns') || {}).textContent || '').match(/\((\d+)\)/); return m && Number(m[1]) > n && document.querySelector('#scRun .nx-sc-res'); }, before, { timeout: 20000 });
    await page.waitForTimeout(400);
  };
  const saveRun = () => runWith('#scRunThis');
  const results = () => page.$$eval('#scRun .nx-sc-res', (a) => a.map((x) => ({ state: (x.className.match(/nx-sc-res--(\w+)/) || [])[1], name: ((x.querySelector('b') || {}).textContent || '').trim(),
    note: ((x.querySelector('.nx-sc-resnote') || {}).textContent || '').trim(), handed: ((x.querySelector('.nx-sc-handed') || {}).textContent || '').trim() })));
  const tab = async (k) => { await page.click('#scTab' + k); await page.waitForTimeout(400); };
  try {
    T.section('the list of every scenario, in the menu');
    await env.open('/?open=api-scenarios');
    await page.waitForSelector('#scList', { timeout: 30000 });
    T.check('API Scenarios in the Application group: it opens on the list of every scenario — none yet, + New scenario',
      (await page.$('[data-nav-id="api-scenarios"]')) !== null && /No scenario yet/.test(await text(page, '#scNone')) && !!(await page.$('#scNewBtn')) && !(await page.$('#scPages')), await text(page, '#scList'));
    T.check('the page your app\'s window is on: said, with + New scenario for it', /Your app's window is on New Order shop\/orders\/order-create/.test(await text(page, '#scAppAt')) && !!(await page.$('#scAppAtNew')), await text(page, '#scAppAt'));
    await env.shot('api-scenarios-empty.png');

    T.section('+ New scenario: its own tab, a header, then its page');
    await newSc('');
    T.check('a tab of its own (New scenario), its header: not saved yet, no page yet, Draft (no step), made / tested nothing yet',
      /New scenario/.test(await tabTitle()) && /New — not saved yet/.test(await text(page, '#scCode')) && /Draft/.test(await text(page, '#scStatus'))
      && (await page.inputValue('#scName')) === 'New scenario' && (await page.$eval('#scPageSel', (s) => s.value)) === '' && /Pick the page this scenario tests/.test(await text(page, '#scPick'))
      && (await text(page, '#scMade')) === '—' && /not yet/.test(await text(page, '#scTested')) && !(await page.$('#scTabs')), await text(page, '#scHeader'));
    const opts = await page.$$eval('#scPageSel option', (o) => o.map((x) => x.textContent.trim()));
    T.check('…the pages to pick from: every page of the workspace, two with one title said so', opts.some((x) => /^Order Workbench — shop\/orders\/order-list$/.test(x)) && opts.filter((x) => /same title as another page/.test(x)).length === 2, opts.join(' | '));
    await page.selectOption('#scPageSel', LIST);
    await page.waitForSelector('#scDraft', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(300);
    T.check('Order Workbench picked: named for it, the tabs Main scenario · Flow · Runs, Main open — no step yet, Draft from the page to start',
      (await page.inputValue('#scName')) === 'Happy path — Order Workbench' && /Main scenario \(0\)/.test(await text(page, '#scTabMain')) && /Flow — expected pages \(0\)/.test(await text(page, '#scTabFlow'))
      && /Runs \(0\)/.test(await text(page, '#scTabRuns')) && /No step yet/.test(await text(page, '#scNoSteps')), await text(page, '#scTabs'));
    await draft();
    const calls = await page.$$eval('#scSteps .nx-sc-call', (a) => a.map((x) => x.textContent.trim()));
    T.check('Draft from the page: its call from the page\'s code, saved — its ID SC-0001 in the header and on the tab', calls.join() === 'shopApi/getOrders' && (await text(page, '#scCode')) === 'SC-0001'
      && /^SC-0001 · Happy path — Order Workbench$/.test(await tabTitle()) && /Not run/.test(await text(page, '#scStatus')) && /priya\.raman/.test(await text(page, '#scMade')), calls.join() + ' / ' + await tabTitle());
    await tab('Flow');
    T.check('Flow before the main page has run: locked — "the main page first: 0 of its 1 APIs passed, 1 not run yet"; no page to continue to yet',
      /The main page first: 0 of its 1 APIs passed, 1 not run yet/.test(await text(page, '#scGateText')) && !!(await page.$('#scGateSkip')) && !(await page.$('#scNext')) && !!(await page.$('#scTabFlow .nx-sc-tablock')), await text(page, '#scGate'));
    const lockedAdd = await page.$eval('#scFlowCols .nx-sc-fnode[data-page="' + DETAIL + '"] .nx-sc-fpath', (b) => b.disabled).catch(() => null);
    T.check('…the pages it leads to shown (Order), Add to the flow waiting for the main page', lockedAdd === true, String(lockedAdd));
    await tab('Main');
    await saveRun();
    let res = await results();
    T.check('Save & run: the main page\'s API run alone, passed (2xx, time, the example\'s shape)', res.length === 1 && res[0].state === 'ok' && /The main page passed/.test(await result())
      && env.calls.some((c) => /^GET \/shop\/v1\/orders/.test(c)) && env.writes.length === 0, JSON.stringify(res));
    T.check('…the header: Passed (main page), last tested now · the main page, by you', /Passed \(main page\)/.test(await text(page, '#scStatus')) && /the main page/.test(await text(page, '#scTested')) && (await text(page, '#scTestedBy')) === 'priya.raman'
      && /Runs \(1\)/.test(await text(page, '#scTabRuns')), await text(page, '#scHeader'));
    await env.shot('api-scenarios.png');

    T.section('Flow: opened once the main page\'s APIs have all run');
    await tab('Flow');
    T.check('the main page is done: unlocked, the page it leads to offered (→ Order)', /The main page is done: all 1 of its APIs ran/.test(await text(page, '#scGateText')) && !(await page.$('#scTabFlow .nx-sc-tablock'))
      && /→ Order\b/.test(await text(page, '#scNext')), await text(page, '#scGate') + ' / ' + await text(page, '#scNext'));
    await page.click('#scNext button[data-key="' + DETAIL + '"]');
    await page.waitForSelector('#scSteps .nx-sc-pagehead', { timeout: 10000 });
    await page.waitForTimeout(400);
    const heads = await page.$$eval('#scSteps .nx-sc-pagehead', (a) => a.map((x) => x.textContent.trim()));
    T.check('Continue the flow → Order: its step in the Flow tab under its page (the main page\'s stays in Main)', heads.length === 1 && /^Then, on Order/.test(heads[0])
      && (await page.$$eval('#scSteps .nx-sc-call', (a) => a.map((x) => x.textContent.trim()))).join() === 'shopApi/getOrderById' && /Flow — expected pages \(1\)/.test(await text(page, '#scTabFlow')), heads.join(' | '));
    T.check('…the order\'s id handed on from the list (as a row clicked)', /^id = \{\{id\}\}$/.test((await page.$eval('#scSteps oj-text-area[data-field="params"] textarea', (t) => t.value)).trim()));
    await runWith('#scRunFlow');
    res = await results();
    T.check('▶ Run the whole flow: the list, then the order it opened — this tab shows the flow\'s part', res.length === 1 && res[0].state === 'ok' && env.calls.some((c) => /^GET \/shop\/v1\/orders\/\w+$/.test(c))
      && /The whole flow passed/.test(await result()) && /Passed$/.test(await text(page, '#scStatus')), JSON.stringify(res) + ' / ' + await text(page, '#scStatus'));
    await tab('Runs');
    const rl = await page.$$eval('#scRuns .nx-sc-runrow', (a) => a.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    T.check('Runs: both runs of this scenario, newest first — the whole flow, then the main page, by you', rl.length === 2 && /Whole flow/.test(rl[0]) && /Main page/.test(rl[1]) && rl.every((x) => /priya\.raman/.test(x))
      && (await page.$$('#scRun .nx-sc-res')).length === 2, rl.join(' | '));

    T.section('the flow\'s pages: their APIs, a tab of their own, a link taken out and made again');
    const sc1Tab = await page.$eval('.nx-tab--on', (e) => e.getAttribute('data-tab-id'));
    const goTab = async (id) => { await page.click('.nx-tab[data-tab-id="' + id + '"] .nx-tab-btn').catch(() => page.click('.nx-tab[data-tab-id="' + id + '"]').catch(() => {})); await page.waitForTimeout(400); };
    T.check('the scenario named for its flow once it went on (Journey — Order Workbench → Order), its tab too', /^SC-0001 · Journey — Order Workbench → Order$/.test(await tabTitle())
      && (await page.inputValue('#scName')) === 'Journey — Order Workbench → Order', await tabTitle());
    await tab('Flow');
    await page.waitForSelector('#scJourney .nx-sc-jpage', { timeout: 10000 });
    const jchips = await page.$$eval('#scJourney .nx-sc-jpage', (a) => a.map((x) => ({ page: x.getAttribute('data-page'), t: x.textContent.replace(/\s+/g, ' ').trim(),
      unlink: !!x.querySelector('.nx-sc-junlink'), tab: !!x.querySelector('.nx-sc-jtab'), apis: !!x.querySelector('.nx-sc-japis'), title: x.getAttribute('title') || '' })));
    T.check('the flow bar in the Flow tab: 1 Order Workbench → 2 Order, each with its steps and how they ran; an APIs icon on both',
      jchips.length === 2 && jchips[0].page === LIST && jchips[1].page === DETAIL && /^1 Order Workbench 1 step · passed/.test(jchips[0].t) && /^2 Order 1 step · passed/.test(jchips[1].t) && jchips.every((x) => x.apis), JSON.stringify(jchips));
    T.check('…only the linked page has Open in a tab, Reconnect and Remove the link (the main page is where it starts); when and by whom it was linked, on hover',
      !jchips[0].unlink && !jchips[0].tab && jchips[1].unlink && jchips[1].tab && /linked/i.test(jchips[1].title), jchips[1].title);
    const ph = await page.$$eval('#scSteps .nx-sc-pagehead', (a) => a.map((x) => ({ apis: !!x.querySelector('.nx-sc-papis'), unlink: !!x.querySelector('.nx-sc-punlink'), relink: !!x.querySelector('.nx-sc-prelink'), tab: !!x.querySelector('.nx-sc-ptab') })));
    T.check('…the same on Order\'s heading over its steps (the Flow tab holds only the pages after the main one)', ph.length === 1 && ph[0].apis && ph[0].unlink && ph[0].relink && ph[0].tab, JSON.stringify(ph));
    await env.shot('api-scenarios-journey-head.png');
    // the APIs dialog of the linked page
    await page.click('#scSteps .nx-sc-pagehead .nx-sc-papis');
    await page.waitForSelector('#scJApis #scJaList .nx-sc-jaapi', { timeout: 15000 });
    const jaSeq = await page.$$eval('#scJaSeq .nx-sc-jaq', (a) => a.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    const jaList = await page.$$eval('#scJaList .nx-sc-jaapi', (a) => a.map((x) => ({ key: x.getAttribute('data-key'), t: x.textContent.replace(/\s+/g, ' ').trim(), add: !!x.querySelector('[data-act="jAdd"]') })));
    T.check('the APIs icon: a dialog — page 2 of the flow, Order, its path; its calls in this scenario in the order they run (getOrderById, step 2, passed)',
      /Page 2 of the journey/.test(await text(page, '#scJApis .nx-kicker')) && (await text(page, '#scJaTitle')) === 'Order' && /shop\/orders\/order-detail/.test(await text(page, '#scJApis .nx-sub'))
      && jaSeq.length === 1 && /^1 GET .*shopApi\/getOrderById.*Step 2$/.test(jaSeq[0]) && /passed/.test(jaSeq[0]), jaSeq.join(' | '));
    T.check('…and every API of the page in the order the page makes them, each marked with its step here (none to add)',
      jaList.length === 1 && jaList[0].key === 'shopApi/getOrderById' && /Step 2$/.test(jaList[0].t) && !jaList[0].add && /Every API of the page \(1\)/.test(await text(page, '#scJApis')), JSON.stringify(jaList));
    T.check('…with Open in a tab (a linked page)', !!(await page.$('#scJaTab')));
    await env.shot('api-scenarios-journey-apis.png');
    await page.click('#scJaSeq .nx-sc-jaq button[data-act="jGo"]');
    await page.waitForTimeout(250);
    T.check('Step 2 in the dialog: it closes and takes you to that step (flashed)', !(await page.$('#scJApis')) && !!(await page.$('#scSteps .nx-sc-step--flash')));
    // the main page's dialog: its own API, step 1 — Step 1 takes you to the Main scenario tab
    await page.click('#scJourney .nx-sc-jpage[data-page="' + LIST + '"] .nx-sc-japis');
    await page.waitForSelector('#scJApis #scJaList .nx-sc-jaapi', { timeout: 15000 });
    const listApis = await page.$$eval('#scJaList .nx-sc-jaapi', (a) => a.map((x) => ({ key: x.getAttribute('data-key'), t: x.textContent.replace(/\s+/g, ' ').trim() })));
    T.check('the main page\'s APIs: "The page the scenario starts on", getOrders as step 1, no Open in a tab',
      /The page the scenario starts on/.test(await text(page, '#scJApis .nx-kicker')) && listApis.some((x) => x.key === 'shopApi/getOrders' && /Step 1$/.test(x.t)) && !(await page.$('#scJaTab')), JSON.stringify(listApis));
    await page.click('#scJaSeq .nx-sc-jaq button[data-act="jGo"]');
    await page.waitForSelector('#scTabMain.nx-sc-tab--on', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    T.check('…its Step 1: the Main scenario tab, that step flashed', !!(await page.$('#scTabMain.nx-sc-tab--on')) && !!(await page.$('#scSteps .nx-sc-step--flash')) && !(await page.$('#scJApis')));
    await tab('Flow');

    // the linked page's own scenarios, in a tab of their own
    await page.click('#scJourney .nx-sc-jpage[data-page="' + DETAIL + '"] .nx-sc-jtab');
    await page.waitForSelector('.nx-tab[data-tab-id="api-scenarios-page:' + DETAIL + '"]', { timeout: 10000 });
    await page.waitForFunction(() => Array.prototype.slice.call(document.querySelectorAll('#scListPage')).some((x) => x.offsetParent !== null), null, { timeout: 15000 }).catch(() => {});
    T.check('Open in a tab: Order\'s own scenarios in a tab (API · Order) — the list on that page: none test it yet, + New scenario for it',
      /API · Order/.test(await tabTitle()) && /^Page: Order\b/.test(await vis('#scListPage')) && /No scenario tests Order yet/.test(await vis('#scNoMatch')), await tabTitle() + ' / ' + await vis('#scListPage') + ' / ' + await vis('#scNoMatch'));
    await page.click('.nx-tab[data-tab-id="api-scenarios-page:' + DETAIL + '"] .nx-tab-close');
    await page.waitForTimeout(400);
    await goTab(sc1Tab);
    await page.waitForSelector('#scJourney', { state: 'visible', timeout: 10000 });

    // take the link out (the confirm says what goes)
    asked = '';
    await page.click('#scJourney .nx-sc-jpage[data-page="' + DETAIL + '"] .nx-sc-junlink');
    await page.waitForFunction(() => !document.getElementById('scJourney'), null, { timeout: 10000 });
    await page.waitForTimeout(400);
    T.check('Remove the link: asked first (Order, 1 step goes), then the flow bar and Order\'s step go (Flow (0))',
      /Remove the link to Order\?/.test(asked) && /1 step\(s\)/.test(asked) && (await page.$$('#scSteps .nx-sc-call')).length === 0 && /Flow — expected pages \(0\)/.test(await text(page, '#scTabFlow')), asked + ' / ' + await text(page, '#scTabFlow'));
    T.check('…said so, the scenario named for the one page again (its tab too), Order offered again to continue to',
      /Link removed: Order \(1 step\(s\)\)/.test(await result()) && (await page.inputValue('#scName')) === 'Happy path — Order Workbench' && /^SC-0001 · Happy path — Order Workbench$/.test(await tabTitle())
      && /→ Order\b/.test(await text(page, '#scNext')), await result() + ' / ' + await tabTitle());
    // link it again, then Reconnect: its steps read fresh
    await page.click('#scNext button[data-key="' + DETAIL + '"]');
    await page.waitForSelector('#scJourney .nx-sc-jpage[data-page="' + DETAIL + '"]', { timeout: 10000 });
    await page.waitForTimeout(300);
    const relBox = await page.$('#scSteps oj-text-area[data-field="params"] textarea');
    await relBox.fill('id = 999'); await relBox.press('Tab'); await page.waitForTimeout(300);
    asked = '';
    await page.click('#scSteps .nx-sc-pagehead .nx-sc-prelink');
    await page.waitForFunction(() => /Reconnected/.test((document.querySelector('.nx-flib-result') || {}).textContent || ''), null, { timeout: 10000 });
    await page.waitForTimeout(300);
    T.check('linked again; Reconnect (asked first) puts its step back as the page makes it — a broken value read fresh: id = {{id}}',
      /Reconnect Order\?/.test(asked) && /^id = \{\{id\}\}$/.test((await page.$eval('#scSteps oj-text-area[data-field="params"] textarea', (t) => t.value)).trim())
      && (await page.$$eval('#scSteps .nx-sc-call', (a) => a.map((x) => x.textContent.trim()))).join() === 'shopApi/getOrderById' && /Reconnected Order: 1 step\(s\)/.test(await result()), asked + ' / ' + await result());
    await runWith('#scRunFlow');
    res = await results();
    T.check('…▶ Run the whole flow: it passes again', res.length === 1 && res[0].state === 'ok' && /The whole flow passed/.test(await result()), JSON.stringify(res));
    await env.shot('api-scenarios-journey.png');

    T.section('the flow map: every page the main page leads to, tested when every page has passed');
    await page.waitForSelector('#scFlow #scFlowCols .nx-sc-fnode', { timeout: 15000 });
    await page.waitForFunction(() => /2 tested/.test((document.getElementById('scFlowSum') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    const fcols = await page.$$eval('#scFlowCols .nx-sc-flowcol', (a) => a.map((c) => ({ t: (c.querySelector('.nx-sc-flowcolt') || {}).textContent.trim(),
      nodes: Array.prototype.map.call(c.querySelectorAll('.nx-sc-fnode'), (x) => ({ page: x.getAttribute('data-page'), cls: x.className, t: x.textContent.replace(/\s+/g, ' ').trim() })) })));
    T.check('the main page, then the pages it leads to (Order Workbench → Order, reached by a row click)',
      fcols.length === 2 && /This page/i.test(fcols[0].t) && /It leads to/i.test(fcols[1].t) && fcols[0].nodes[0].page === LIST && fcols[1].nodes[0].page === DETAIL
      && /from Order Workbench · row click/.test(fcols[1].nodes[0].t) && /also goes to Order Workbench/.test(fcols[1].nodes[0].t), JSON.stringify(fcols));
    T.check('…each page with its APIs and how far the scenarios tested it (both passed)',
      /1 API · 1 passed/.test(fcols[1].nodes[0].t) && /tested: every API passed · \d+ scenario/.test(fcols[1].nodes[0].t) && /nx-sc-fnode--ok/.test(fcols[0].nodes[0].cls) && /nx-sc-fnode--ok/.test(fcols[1].nodes[0].cls), fcols[1].nodes[0].t);
    T.check('…the headline: 2 pages · 2 tested · 2 of 2 APIs passed — the flow\'s testing complete, marked so',
      /^2 pages · 2 tested · 2 of 2 APIs passed$/.test(await text(page, '#scFlowSum')) && /testing is complete/.test(await text(page, '#scFlowLeft')) && !!(await page.$('#scFlow.nx-sc-flow--done')), await text(page, '#scFlowSum') + ' / ' + await text(page, '#scFlowLeft'));
    await env.shot('api-scenarios-flow.png');

    T.section('a second scenario on the same page: Continue anyway, then a page of the map added to the flow');
    await closeSc();
    await newSc(LIST);
    await page.fill('#scName', 'Open an order from the list');
    await page.press('#scName', 'Tab');
    await page.waitForTimeout(300);
    await draft();
    T.check('its own ID (SC-0002) and the name you gave it, kept by the draft', (await text(page, '#scCode')) === 'SC-0002' && /^SC-0002 · Open an order from the list$/.test(await tabTitle()), await tabTitle());
    await tab('Flow');
    const gated = await page.$eval('#scFlowCols .nx-sc-fnode[data-page="' + DETAIL + '"] .nx-sc-fpath', (b) => b.disabled).catch(() => null);
    await page.click('#scGateSkip');
    await page.waitForTimeout(300);
    const opened = await page.$eval('#scFlowCols .nx-sc-fnode[data-page="' + DETAIL + '"] .nx-sc-fpath', (b) => b.disabled).catch(() => null);
    T.check('not run yet: the flow waits — "Continue anyway" opens it (Add to the flow enabled, the pages to continue to offered)', gated === true && opened === false && !(await page.$('#scGateSkip'))
      && /→ Order\b/.test(await text(page, '#scNext')), gated + ' → ' + opened);
    await page.click('#scFlowCols .nx-sc-fnode[data-page="' + DETAIL + '"] .nx-sc-fpath');
    await page.waitForFunction(() => /The flow goes on to Order/.test((document.querySelector('.nx-flib-result') || {}).textContent || ''), null, { timeout: 15000 });
    await page.waitForTimeout(300);
    T.check('Add to the flow on Order: the path to it added (its step under its page in Flow), the name kept as you gave it',
      (await page.$$eval('#scSteps .nx-sc-call', (a) => a.map((x) => x.textContent.trim()))).join() === 'shopApi/getOrderById' && (await page.$$('#scJourney .nx-sc-jpage')).length === 2
      && (await page.inputValue('#scName')) === 'Open an order from the list' && /Flow — expected pages \(1\)/.test(await text(page, '#scTabFlow')), await result());
    await page.click('#scSave');
    await page.waitForTimeout(600);
    await closeSc();

    T.section('the list: every scenario with its ID, page, status, last tested and by whom');
    await toList();
    const rows = await page.$$eval('#scGrid .nx-sc-grow:not(.nx-sc-grow--head)', (a) => a.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    T.check('both scenarios, newest ID first: SC-0002 (not run), SC-0001 (passed, tested by you, its flow to Order)', rows.length === 2 && /^SC-0002 Open an order from the list Happy path · 1 step · flow: Order Order Workbench.* Not run/.test(rows[0])
      && /^SC-0001 Journey — Order Workbench → Order .* Passed .*priya\.raman/.test(rows[1]), rows.join(' | '));
    const chips = await page.$$eval('#scList .nx-sc-listbar .nx-sc-chip', (a) => a.map((x) => x.textContent.trim()));
    T.check('…status chips with counts (All 2 · Passed 1 · Not run 1)', chips.join() === 'All 2,Passed 1,Not run 1', chips.join());
    await page.click('#scList .nx-sc-chip[data-key="passed"]');
    await page.waitForTimeout(250);
    const passedOnly = (await page.$$('#scGrid .nx-sc-grow:not(.nx-sc-grow--head)')).length;
    await page.click('#scList .nx-sc-chip[data-key="all"]');
    await page.fill('#scListQ', 'open an');
    await page.waitForTimeout(300);
    const found = await page.$$eval('#scGrid .nx-sc-grow:not(.nx-sc-grow--head) .nx-sc-gopen', (a) => a.map((x) => x.textContent.trim()));
    await page.fill('#scListQ', 'zzz');
    await page.waitForTimeout(300);
    const none = await text(page, '#scNoMatch');
    await page.fill('#scListQ', '');
    await page.waitForTimeout(300);
    T.check('…a chip filters (Passed: 1), Find searches ID, name and page ("open an" → SC-0002; nothing → said)', passedOnly === 1 && found.join() === 'SC-0002' && /No scenario matches/.test(none), passedOnly + ' / ' + found.join() + ' / ' + none);
    await env.shot('api-scenarios-list.png');
    // ▶ Run from the list: the whole flow, the row's status follows
    await page.click('#scGrid .nx-sc-grow[data-id] .nx-btn');
    await page.waitForFunction(() => /Passed/.test((document.querySelector('#scGrid .nx-sc-grow:not(.nx-sc-grow--head)') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
    T.check('▶ Run on a row (SC-0002): run there — the whole flow — and the row says Passed, tested by you', /^SC-0002 .* Passed .*priya\.raman/.test(await text(page, '#scGrid .nx-sc-grow:not(.nx-sc-grow--head)')), await text(page, '#scGrid .nx-sc-grow:not(.nx-sc-grow--head)'));
    // the ID opens the scenario in its tab (the one open already is focused, not doubled)
    await page.click('#scGrid .nx-sc-grow:not(.nx-sc-grow--head) .nx-sc-gopen');
    await page.waitForSelector('#scHeader', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(400);
    T.check('its ID opens it in a tab of its own: SC-0002 · Open an order from the list, Passed, its run under Runs', /^SC-0002 · Open an order from the list$/.test(await tabTitle()) && /^Passed$/.test(await text(page, '#scStatus')) && /Runs \(1\)/.test(await text(page, '#scTabRuns')), await tabTitle() + ' / ' + await text(page, '#scStatus'));
    await closeSc();

    T.section('a value the page gets from the screen before it');
    await newSc(DETAIL);
    await draft();
    const dataNow = await page.$eval('#scData textarea', (t) => t.value);
    T.check('the draft (SC-0003) asks for it under Data (a header, an empty row) and says so in the notes', (await text(page, '#scCode')) === 'SC-0003' && /^id\s*$/.test(dataNow.trim())
      && /Give id under Data/.test(await page.$eval('#scNotes textarea', (t) => t.value)), JSON.stringify(dataNow));
    await saveRun();
    res = await results();
    T.check('run without it: the step says which value and where to give it; the header says Failed (main page)', res[0].state === 'fail' && /no value for id — give it under Data/.test(res[0].note)
      && /Failed \(main page\)/.test(await text(page, '#scStatus')), JSON.stringify(res));
    await tab('Flow');
    T.check('…the flow stays shut while a main-page API fails ("1 failed")', /The main page first: 0 of its 1 APIs passed, 1 failed/.test(await text(page, '#scGateText')), await text(page, '#scGateText'));
    await tab('Main');
    await page.fill('#scData textarea', 'id\n41');
    await page.press('#scData textarea', 'Tab');
    await page.waitForTimeout(300);
    await saveRun();
    res = await results();
    T.check('given (id = 41): sent with it, passed', res[0].state === 'ok' && env.calls.some((c) => c === 'GET /shop/v1/orders/41') && /^✓ /.test(await text(page, '#scRun h2')) && /Passed \(main page\)/.test(await text(page, '#scStatus')), JSON.stringify(res));
    await closeSc();

    T.section('BI Publisher where the page calls it; writes held');
    await newSc(CREATE);
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
    await tab('Flow');
    T.check('…a change of data held back counts as done: the main page is done, its flow open', /The main page is done: all 3 of its APIs ran \(1 change data, held back\)/.test(await text(page, '#scGateText')), await text(page, '#scGateText'));
    await tab('Main');

    T.section('a list of values: searched and picked as on the page, here and in the steps that send it');
    const s1 = '#scSteps .nx-sc-step:first-child';
    const lovInfo = await text(page, s1 + ' .nx-sc-lovinfo');
    T.check('the Customer dropdown found in the code: its step says so (what it keeps, the value it hands on)', /^List of values: Customer/.test(await page.$eval(s1 + ' .nx-sc-stepname', (e) => e.value))
      && /Customer on the page: .*keeps id → hands it on as \{\{customer\}\}/.test(lovInfo), lovInfo);
    T.check('each step shows its API in full (method, the backend this PC reaches, the path)', /^GET http:\/\/127\.0\.0\.1:\d+\/shop\/v1\/customers$/.test(await text(page, s1 + ' .nx-sc-api'))
      && /^REPORT \/Custom\/Shop\/CUSTOMERS_RP\.xdo/.test(await text(page, '#scSteps .nx-sc-step:nth-child(2) .nx-sc-api')), await text(page, s1 + ' .nx-sc-api'));
    await page.click(s1 + ' .nx-sc-trybtn');
    await page.waitForSelector(s1 + ' .nx-sc-tried', { timeout: 15000 });
    T.check('▶ Run: the API run on its own — what was sent, 200, its values, its answer', /^200 · \d+ ms/.test(await text(page, s1 + ' .nx-sc-tried b'))
      && /Sent: GET http:\/\/127\.0\.0\.1:\d+\/shop\/v1\/customers/.test(await text(page, s1 + ' .nx-sc-tried .nx-sc-sent')) && /2 value\(s\): Acme Tools, Blue River/.test(await text(page, s1 + ' .nx-sc-tried .nx-sc-resvalues'))
      && /"Blue River"/.test(await text(page, s1 + ' .nx-sc-tried pre')), await text(page, s1 + ' .nx-sc-tried'));
    const pBox2 = (await page.$$('#scSteps oj-text-area[data-field="params"] textarea'))[1];
    await pBox2.fill('P_CUSTOMER_ID = {{customer}}'); await pBox2.press('Tab'); await page.waitForTimeout(500);
    const repStep = '#scSteps .nx-sc-step:nth-child(2)';
    T.check('a step that sends {{customer}}: the list right there, the same component the page uses', (await page.$$(repStep + ' .nx-sc-picker oj-select-single')).length === 1);
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

    T.section('another page for the same scenario (asked first), then a search as you type');
    asked = '';
    await page.selectOption('#scPageSel', PICK);
    await page.waitForFunction(() => !document.querySelector('#scSteps .nx-sc-step'), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(400);
    T.check('a page picked for a scenario with steps: asked first, each page named by its path when both have one title (its steps are cleared), ready to draft',
      /Test New Order \(shop\/customers\/customer-pick\) instead of New Order \(shop\/orders\/order-create\)\?/.test(asked) && /cleared/.test(asked) && (await page.$$('#scSteps .nx-sc-step')).length === 0 && /^Happy path — New Order$/.test(await page.inputValue('#scName'))
      && /^SC-0004/.test(await text(page, '#scCode')), asked.split('\n')[0] + ' / ' + await page.inputValue('#scName'));
    await draft();
    const t1 = '#scSteps .nx-sc-step:first-child';
    T.check('the Customer search found in the code: its report, the text typed as P_SEARCH, the fixed value as written', /^List of values: Customer — report CUST_LOV_RP \(a search as you type\)/.test(await page.$eval(t1 + ' .nx-sc-stepname', (e) => e.value))
      && /P_SEARCH = the text typed/.test(await text(page, t1 + ' .nx-sc-lovinfo')) && /P_SEARCH_BY = ALL/.test(await page.$eval(t1 + ' oj-text-area[data-field="params"] textarea', (t) => t.value)), await text(page, t1 + ' .nx-sc-lovinfo'));
    T.check('the page as: Customer Type, Internal chosen (as the page starts); the External-only Customer not on the page', /The page as\s*Customer Type\s*Internal\s*External/.test(await text(page, '#scChoices'))
      && (await text(page, '#scChoices .nx-sc-chip--on')) === 'Internal' && (await page.$$('#scSteps .nx-sc-step--off')).length === 1
      && /Not on the page as chosen \(Customer Type is Internal\): skipped when run/.test(await text(page, '#scSteps .nx-sc-step--off .nx-sc-when')), await text(page, '#scChoices'));
    await page.click(t1 + ' .nx-sc-picker oj-select-single input');
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
    await page.click('#scSteps .nx-sc-step--off .nx-sc-trybtn');
    await page.waitForSelector('#scSteps .nx-sc-step--off .nx-sc-tried', { timeout: 15000 });
    T.check('▶ Run on a step not on the page as chosen: sent all the same, said why', /^200 · \d+ ms/.test(await text(page, '#scSteps .nx-sc-step--off .nx-sc-tried b'))
      && /not on the page as chosen \(Customer Type is External\): run because you asked/.test(await text(page, '#scSteps .nx-sc-step--off .nx-sc-tried')), await text(page, '#scSteps .nx-sc-step--off .nx-sc-tried'));
    T.check('the choices say how the page starts', /As on your screen/.test(await text(page, '#scChoices')), await text(page, '#scChoices'));
    await env.shot('api-scenarios-search.png');
    await page.click('#scSave'); await page.waitForTimeout(600);
    await closeSc();

    T.section('built by you from the page\'s APIs, the order suggested; deleted');
    await newSc(CREATE);
    await page.click('#scApisBtn');
    await page.waitForSelector('#scApiList .nx-sc-apirow', { timeout: 15000 });
    const apiKeys = await page.$$eval('#scApiList .nx-sc-apirow', (a) => a.map((x) => x.getAttribute('data-key')));
    await page.waitForSelector('#scApiOverview', { timeout: 10000 });
    T.check('the page\'s counts as Application pages shows them (3 REST calls with BI Publisher\'s own, 1 BI report); its backends', /3 REST calls/.test(await text(page, '#scApiOverview'))
      && /1 BI reports/.test(await text(page, '#scApiOverview')) && /Oracle BI Publisher \(SOAP\)/.test(await text(page, '#scApiOverview')), await text(page, '#scApiOverview'));
    T.check('another page with the same title: named, with its counts', /Another page has this title: shop\/customers\/customer-pick — \d+ REST calls, 1 BI reports/.test(await text(page, '#scApiTwin')), await text(page, '#scApiTwin'));
    T.check('BI Publisher\'s own service listed with the reports it runs (no Test of its own)', /Runs the reports below: CUSTOMERS_RP/.test(await text(page, '#scApiList .nx-sc-apirow[data-key="bipService/runBIPReport"]'))
      && !(await page.$('#scApiList .nx-sc-apirow[data-key="bipService/runBIPReport"] .nx-sc-apitry')));
    T.check('Add from the page\'s APIs: every API of the page — its list, BI Publisher\'s service, its report, its create; building the new scenario', apiKeys.join() === 'shopApi/getCustomers,bipService/runBIPReport,report:CUSTOMERS_RP,shopApi/createOrder'
      && /a list of values/.test(await text(page, '#scApiList .nx-sc-apirow[data-key="shopApi/getCustomers"] .nx-sc-apiwhere')) && /Building: Happy path — New Order · 0 step/.test(await text(page, '#scApiBar')), apiKeys.join() + ' / ' + await text(page, '#scApiBar'));
    await page.click('#scApiList .nx-sc-apirow[data-key="shopApi/getCustomers"] .nx-sc-apitry');
    await page.waitForSelector('#scApiList .nx-sc-apirow[data-key="shopApi/getCustomers"] .nx-sc-tried', { timeout: 15000 });
    T.check('▶ Test: that API alone — 200, its values, what was sent', /^200 · \d+ ms/.test(await text(page, '#scApiList .nx-sc-apirow[data-key="shopApi/getCustomers"] .nx-sc-tried b'))
      && /2 value\(s\): Acme Tools, Blue River/.test(await text(page, '#scApiList .nx-sc-apirow[data-key="shopApi/getCustomers"] .nx-sc-resvalues')), await text(page, '#scApiList .nx-sc-apirow[data-key="shopApi/getCustomers"] .nx-sc-tried'));
    await env.shot('api-scenarios-apis.png');
    for (const k of ['shopApi/createOrder', 'report:CUSTOMERS_RP', 'shopApi/getCustomers']) { await page.click('#scApiList .nx-sc-apirow[data-key="' + k + '"] .nx-sc-apiadd'); await page.waitForTimeout(200); }
    T.check('+ Add to scenario: three steps in the order added', /Building: Happy path — New Order · 3 step\(s\) \(not saved yet\)/.test(await text(page, '#scApiBar'))
      && /In the scenario/.test(await text(page, '#scApiList .nx-sc-apirow[data-key="shopApi/createOrder"] .nx-sc-apiadd')), await text(page, '#scApiBar'));
    await page.click('#scApiGo');
    await page.waitForSelector('#scSteps .nx-sc-step', { timeout: 10000 });
    T.check('Done adding: the APIs fold away, the three steps in Main scenario', !(await page.$('#scApiList')) && (await page.$$('#scSteps .nx-sc-step')).length === 3 && /Main scenario \(3\)/.test(await text(page, '#scTabMain')));
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
    await page.click('#scSave');
    await page.waitForFunction(() => /^SC-\d+$/.test(((document.getElementById('scCode') || {}).textContent || '').trim()), null, { timeout: 10000 });
    await page.waitForTimeout(300);
    T.check('Save: its ID given (SC-0005), on the tab too', (await text(page, '#scCode')) === 'SC-0005' && /^SC-0005 · Happy path — New Order$/.test(await tabTitle()), await tabTitle());
    await closeSc();
    // one that misses a value: the report alone, sending {{customer}}
    await newSc(CREATE);
    await page.click('#scApisBtn');
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
    await page.click('#scSave');
    await page.waitForFunction(() => /^SC-\d+$/.test(((document.getElementById('scCode') || {}).textContent || '').trim()), null, { timeout: 10000 });
    await page.waitForTimeout(300);
    // delete: this one from its header (its tab closes), then one from the list
    const tabsBefore = (await page.$$('.nx-tab')).length;
    asked = '';
    await page.click('#scDelete');
    await page.waitForFunction((n) => document.querySelectorAll('.nx-tab').length === n - 1, tabsBefore, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(300);
    T.check('Delete in the header: asked first (SC-0006), deleted, its tab closed', /Delete the scenario SC-0006/.test(asked) && (await page.$$('.nx-tab')).length === tabsBefore - 1, asked + ' / ' + (await page.$$('.nx-tab')).length);
    await toList();
    const ids0 = await page.$$eval('#scGrid .nx-sc-gopen', (a) => a.map((x) => x.textContent.trim()));
    asked = '';
    await page.click('#scGrid .nx-sc-grow[data-id] .nx-sc-carddel');
    await page.waitForFunction((n) => document.querySelectorAll('#scGrid .nx-sc-gopen').length === n - 1, ids0.length, { timeout: 10000 }).catch(() => {});
    const ids1 = await page.$$eval('#scGrid .nx-sc-gopen', (a) => a.map((x) => x.textContent.trim()));
    T.check('🗑 on a row: asked, that scenario deleted (SC-0005); the others stay', ids0.join() === 'SC-0005,SC-0004,SC-0003,SC-0002,SC-0001' && /Delete the scenario SC-0005/.test(asked) && ids1.join() === 'SC-0004,SC-0003,SC-0002,SC-0001', ids0.join() + ' → ' + ids1.join());
    await env.shot('api-scenarios-build.png');

    T.section('opened on a page from Application pages');
    await env.open('/?open=app-pages');
    await page.waitForSelector('#pgRows .nx-pg-row', { timeout: 30000 });
    await page.click('.nx-pg-apibtn[data-key="' + DETAIL + '"]');
    await page.waitForFunction(() => Array.prototype.slice.call(document.querySelectorAll('#scListPage')).some((x) => x.offsetParent !== null), null, { timeout: 15000 });
    await page.waitForTimeout(400);
    // grid rows are display: contents — a row shows when its first cell does
    const shownRows = () => page.$$eval('#scGrid .nx-sc-grow:not(.nx-sc-grow--head)', (a) => a.filter((x) => x.firstElementChild && x.firstElementChild.offsetParent !== null).map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    const r1 = await shownRows();
    T.check('the API button beside a page opens the list on its scenarios: SC-0003 tests Order, passed', /^Page: Order\b/.test(await vis('#scListPage'))
      && r1.length === 1 && /^SC-0003 .* Passed/.test(r1[0]), await vis('#scListPage') + ' / ' + r1.join(' | '));
    await env.shot('api-scenarios-from-pages.png');
    await page.evaluate(() => { const b = Array.prototype.slice.call(document.querySelectorAll('#scListPage .nx-sc-pagechipx')).filter((x) => x.offsetParent !== null)[0]; if (b) b.click(); });
    await page.waitForTimeout(300);
    T.check('…× on the page chip: every scenario again', (await shownRows()).length === 4, (await shownRows()).join(' | '));

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
