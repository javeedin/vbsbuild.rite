/*
 * A page's lists of values (lib/pageScan.js lovsOf) and the values it sends with its calls (callParamsOf): each dropdown,
 * the field it fills, what it shows and keeps, the page value it sets, and the call that fills it — read the ways VB
 * apps write it (a ServiceDataProvider; an array a chain fills from a call's answer, directly, through Promise.all, or
 * through the chain's own names; values written in the code). Then API Scenarios' draft: a list of values as a step that
 * hands on the value picked, a later step sending it.
 *
 * Run:  node tests/page-lovs.test.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const S = require('../desktop/lib/pageScan');
const SC = require('../desktop/lib/apiScenarios');

const T = H.makeAsserter();
const FIXTURE = path.join(__dirname, 'fixtures', 'vb-sample');

// a made-up VB app written the ways real apps are
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'br-lovs-'));
const app = path.join(root, 'webApps', 'depot');
const pages = path.join(app, 'flows', 'main', 'pages');
const chains = path.join(pages, 'new-request-page-chains');
fs.mkdirSync(chains, { recursive: true });
fs.writeFileSync(path.join(app, 'app-flow.json'), '{ "id": "depot" }');
fs.writeFileSync(path.join(pages, 'new-request-page.html'), `
<div>
  <oj-select-single label-hint="Customer Name" data="[[ $variables.customersADP ]]" item-text="customerName"
    value="{{ $variables.form.customerRefId }}"></oj-select-single>
  <oj-select-single label-hint="Contact" data="[[ $variables.contactsADP ]]" item-text="contactName" value="{{ $variables.form.contactId }}"></oj-select-single>
  <oj-select-single label-hint="Agreement" data="[[ $variables.agreementsADP ]]" item-text="label" value="{{ $variables.form.agreementId }}"></oj-select-single>
  <oj-select-single label-hint="Yard" data="[[ $variables.yardsSDP ]]" item-text="yardName" value="{{ $variables.form.yardId }}"></oj-select-single>
  <oj-select-single label-hint="Priority" data="[[ $variables.priorityADP ]]" item-text="label" value="{{ $variables.form.priority }}"></oj-select-single>
  <oj-select-single label-hint="Priority" data="[[ $variables.priorityADP ]]" item-text="label" value="{{ $variables.form.priority }}"></oj-select-single>
</div>`);
fs.writeFileSync(path.join(pages, 'new-request-page.json'), JSON.stringify({ variables: {
  customersADP: { type: 'vb/ArrayDataProvider2', defaultValue: { keyAttributes: 'id', data: '{{ $page.variables.customersArray }}' } },
  contactsADP: { type: 'vb/ArrayDataProvider2', defaultValue: { keyAttributes: 'id', data: '{{ $page.variables.contactsArray }}' } },
  agreementsADP: { type: 'vb/ArrayDataProvider2', defaultValue: { keyAttributes: 'value', data: '{{ $variables.agreementOptions }}' } },
  yardsSDP: { type: 'vb/ServiceDataProvider', defaultValue: { endpoint: 'depot-v1/getYards', keyAttributes: 'yardId', itemsPath: 'data',
    uriParameters: { activeFlag: 'Y', customerId: '{{ $variables.form.customerRefId }}' } } },
  priorityADP: { type: 'vb/ArrayDataProvider2', defaultValue: { keyAttributes: 'value', data: [{ value: 'H', label: 'High' }, { value: 'L', label: 'Low' }] } },
} }));
fs.writeFileSync(path.join(chains, 'InitChain.js'), `define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';
  class InitChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const [custResp, usersResp] = await Promise.all([
        Actions.callRest(context, { endpoint: 'depot-v1/getCustomerRefs' }),
        Actions.callRest(context, { endpoint: 'depot-v1/getPortalUsers', uriParams: { status: 'ACTIVE', limit: 200 } })
      ]);
      $page.variables.customersArray = (custResp && custResp.ok) ? custResp.body.data
        .filter(c => c != null && c.id != null)
        .map(c => ({ id: Number(c.id), customerName: c.customerName || ('Customer ' + c.id) })) : [];
      $page.variables.contactsArray = usersResp.ok ? usersResp.body.items.map(u => ({ id: u.userId, contactName: u.displayName })) : [];
    }
  }
  return InitChain;
});`);
fs.writeFileSync(path.join(chains, 'LoadAgreementsChain.js'), `define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';
  class LoadAgreementsChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const [headersResp, namesResp] = await Promise.all([
        Actions.callRest(context, { endpoint: 'depot-v1/getAgreementHeaders', uriParams: { pageSize: 500, customerId: $page.variables.form.customerRefId } }),
        Actions.callRest(context, { endpoint: 'depot-v1/getCustomerRefs' })
      ]);
      const names = namesResp.ok ? namesResp.body.data : [];
      const headers = headersResp.ok ? headersResp.body.data : [];
      const options = headers
        .filter(function (h) { return h && h.id != null; })
        .map(function (h) {
          return { value: Number(h.id), label: (h.agreementNumber || ('Agreement ' + h.id)) + ' — ' + names.length };
        });
      $page.variables.agreementOptions = options;
      await Actions.callRest(context, { endpoint: 'depot-v1/findProjects', uriParams: { q: 'ProjectId=' + $page.variables.form.projectId, fields: 'ProjectId,ProjectName', onlyData: true } });
    }
  }
  return LoadAgreementsChain;
});`);

// a search as you type, as real apps write it: a provider in the page module fires an event, a chain runs a report with the text
fs.writeFileSync(path.join(pages, 'pick-customer-page.html'), `<oj-select-single aria-label="Customer"
  value="[[ $page.variables.sel && $page.variables.sel.CustomerId != null ? String($page.variables.sel.CustomerId) : null ]]"
  data="[[ $functions.customerSuggestionsProvider() ]]" item-text="Customer">
  <template slot="itemTemplate"><span><oj-bind-text value="[[ $current.data.Customer ]]"></oj-bind-text></span><span><oj-bind-text value="[[ $current.data.CustomerNumber ]]"></oj-bind-text></span></template>
</oj-select-single>`);
fs.writeFileSync(path.join(pages, 'pick-customer-page.json'), JSON.stringify({ variables: { sel: { type: 'any' } }, events: { customerSearchRequested: {} },
  eventListeners: { customerSearchRequested: { chains: [{ chain: 'CustomerTypeaheadChain', parameters: { searchValue: '[[ $event.text ]]' } }] } } }));
fs.writeFileSync(path.join(pages, 'pick-customer-page.js'), `define([], () => {
  'use strict';
  class PageModule {
    constructor(context) {
      var self = this;
      this._custDP = new ReportSuggestProvider(function (text) { self._emitSearch('customerSearchRequested', text, self._custDP); }, 'CustomerId');
    }
    customerSuggestionsProvider() {
      return this._custDP;
    }
  }
  return PageModule;
});`);
fs.mkdirSync(path.join(pages, 'pick-customer-page-chains'), { recursive: true });
fs.writeFileSync(path.join(pages, 'pick-customer-page-chains', 'CustomerTypeaheadChain.js'), `define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/bipLov'], (ActionChain, Actions, bipLov) => {
  'use strict';
  class CustomerTypeaheadChain extends ActionChain {
    async run(context, params) {
      const text = (params && params.searchValue != null) ? String(params.searchValue).trim() : '';
      const soapBody = bipLov.buildSoapBody('/Custom/Depot/DEPOT_CUSTOMERS_LOV_RP.xdo', [
        { name: 'P_SEARCH', value: xmlEscape(text) },
        { name: 'P_SEARCH_BY', value: 'ALL' },
      ]);
      const response = await Actions.callRest(context, { endpoint: 'bipService/runBIPReport', body: soapBody });
      const found = bipLov.decodeReportRows(response.body, 'G_1', 'CUSTOMERID', 'CUSTOMER', 'CUSTOMERNUMBER');
      const rows = found.map((r) => ({ CustomerId: r.CUSTOMERID, CustomerNumber: r.CUSTOMERNUMBER, Customer: r.CUSTOMER }));
      $page.functions.deliverCustomers(text, rows);
    }
  }
  return CustomerTypeaheadChain;
});`);

T.section('the sample app: a dropdown filled in a chain from a call');
const oc = S.analyze(FIXTURE, 'shop/orders/order-create').integrations.lovs;
T.check('Customer: getCustomers (its answer\'s items), keeps id, sets customer, in LoadCustomersChain', oc.length === 1 && oc[0].field === 'Customer' && oc[0].endpoint === 'shopApi/getCustomers'
  && oc[0].itemsPath === 'items' && oc[0].key === 'id' && oc[0].target === 'customer' && oc[0].source === 'chain' && oc[0].via === 'LoadCustomersChain', JSON.stringify(oc));

T.section('a made-up app written the ways real apps are');
const f = S.analyze(root, 'depot/main/new-request');
const L = {};
f.integrations.lovs.forEach((l) => { L[l.field] = l; });
T.check('every dropdown once (the same one shown twice counted once)', f.integrations.lovs.map((l) => l.field).join() === 'Customer Name,Contact,Agreement,Yard,Priority', f.integrations.lovs.map((l) => l.field).join());
T.check('Customer Name: from Promise.all\'s first answer, its data; shows customerName, keeps id (the answer\'s own fields), sets customerRefId',
  L['Customer Name'].endpoint === 'depot-v1/getCustomerRefs' && L['Customer Name'].itemsPath === 'data' && L['Customer Name'].keyFrom === 'id' && L['Customer Name'].textFrom === 'customerName'
  && L['Customer Name'].target === 'customerRefId' && L['Customer Name'].via === 'InitChain', JSON.stringify(L['Customer Name']));
T.check('Contact: the second answer, its items; mapped from userId / displayName', L.Contact.endpoint === 'depot-v1/getPortalUsers' && L.Contact.itemsPath === 'items'
  && L.Contact.keyFrom === 'userId' && L.Contact.textFrom === 'displayName', JSON.stringify(L.Contact));
T.check('Agreement: followed back through the chain\'s own names (options ← headers ← headersResp), not the other call', L.Agreement.endpoint === 'depot-v1/getAgreementHeaders'
  && L.Agreement.itemsPath === 'data' && L.Agreement.keyFrom === 'id' && L.Agreement.textFrom === 'agreementNumber', JSON.stringify(L.Agreement));
T.check('Yard: a ServiceDataProvider — its endpoint, items path, key; a value as written stays, a page value becomes {{name}}', L.Yard.source === 'service' && L.Yard.endpoint === 'depot-v1/getYards'
  && L.Yard.itemsPath === 'data' && L.Yard.key === 'yardId' && L.Yard.params.activeFlag === 'Y' && L.Yard.params.customerId === '{{customerRefId}}', JSON.stringify(L.Yard));
T.check('Priority: values written in the code, shown as they are', L.Priority.source === 'static' && JSON.stringify(L.Priority.values) === '[{"key":"H","text":"High"},{"key":"L","text":"Low"}]', JSON.stringify(L.Priority));
const sent = {};
f.integrations.rest.forEach((r) => { if (r.params) sent[r.endpoint] = r.params; });
T.check('the values a chain sends: literals as they are, a page value as {{name}}', JSON.stringify(sent['depot-v1/getPortalUsers']) === '{"status":"ACTIVE","limit":"200"}'
  && JSON.stringify(sent['depot-v1/getAgreementHeaders']) === '{"pageSize":"500","customerId":"{{customerRefId}}"}', JSON.stringify(sent));
T.check('…a value joined from text and a page value: "ProjectId={{projectId}}"; a list of fields kept whole', sent['depot-v1/findProjects'].q === 'ProjectId={{projectId}}'
  && sent['depot-v1/findProjects'].fields === 'ProjectId,ProjectName' && sent['depot-v1/findProjects'].onlyData === 'true', JSON.stringify(sent['depot-v1/findProjects']));

T.section('a search as you type: the provider, its event, the chain, the report and the text it sends');
const sl = S.analyze(root, 'depot/main/pick-customer').integrations.lovs[0] || {};
T.check('followed from $functions.customerSuggestionsProvider() → customerSearchRequested → CustomerTypeaheadChain → its report', sl.source === 'report' && sl.report === 'DEPOT_CUSTOMERS_LOV_RP'
  && sl.reportPath === '/Custom/Depot/DEPOT_CUSTOMERS_LOV_RP.xdo' && sl.via === 'CustomerTypeaheadChain' && sl.rowTag === 'G_1', JSON.stringify(sl));
T.check('…the text typed sent as P_SEARCH, the fixed value as written; shows CUSTOMER with CUSTOMERNUMBER under it, keeps CUSTOMERID, sets CustomerId',
  sl.search === 'P_SEARCH' && JSON.stringify(sl.params) === '{"P_SEARCH":"","P_SEARCH_BY":"ALL"}' && sl.textFrom === 'CUSTOMER' && sl.subFrom === 'CUSTOMERNUMBER' && sl.keyFrom === 'CUSTOMERID' && sl.target === 'CustomerId', JSON.stringify(sl));

T.section('API Scenarios: a list of values as a step; the value picked handed on');
const store = SC.open({ api: null, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'br-lovs-sc-')) });
const d = store.draft('depot/main/new-request', f, 'jane.doe');
const st = {};
d.scenario.steps.forEach((s) => { st[s.endpoint] = s; });
const cust = st['depot-v1/getCustomerRefs'];
T.check('the Customer Name list: a step named for it, its list kept (shows customerName, keeps id), the first value handed on as customerRefId',
  /^List of values: Customer Name/.test(cust.name) && cust.lov.target === 'customerRefId' && cust.lov.key === 'id' && cust.lov.text === 'customerName'
  && cust.extract.some((e) => e.var === 'customerRefId' && e.from === 'data[0].id'), JSON.stringify(cust));
T.check('a step that sends it: the page\'s own values, {{customerRefId}} from the list', st['depot-v1/getAgreementHeaders'].params.customerId === '{{customerRefId}}'
  && st['depot-v1/getAgreementHeaders'].params.pageSize === '500', JSON.stringify(st['depot-v1/getAgreementHeaders'].params));
T.check('a value the page gets from the screen (projectId) asked for under Data; the notes name the lists', JSON.stringify(d.scenario.data) === '[{"projectId":""}]'
  && /Customer Name, Contact, Agreement, Yard are lists of values on the page/.test(d.scenario.notes), JSON.stringify(d.scenario.data) + ' ' + d.scenario.notes);

T.section('comments are not code');
T.check('a report or call only named in a comment is not the page\'s; a // inside a string stays', JSON.stringify(S.scanCode("// This used to call OLD_LOV_RP and endpoint: 'x/old'\nconst u = 'http://h//p'; run('NEW_LOV_RP'); /* BLOCK_RP */ callRest({ endpoint: 'shop/getIt' });"))
  === JSON.stringify(Object.assign(S.scanCode("run('NEW_LOV_RP'); callRest({ endpoint: 'shop/getIt' });"), {})), JSON.stringify(S.scanCode("// OLD_LOV_RP\nrun('NEW_LOV_RP');").reports));

T.section('reading a value picked');
const ans = { status: 200, json: { data: [{ id: 5, customerName: 'Acme' }, { id: 7, customerName: 'Blue River' }] }, rows: null };
T.check('[n] the nth row, [field=value] the row picked, gone → nothing', SC.readPath(ans, 'data[0].id') === 5 && SC.readPath(ans, 'data[id=7].customerName') === 'Blue River' && SC.readPath(ans, 'data[id=9].id') === undefined);

try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* tmp */ }
T.report();
