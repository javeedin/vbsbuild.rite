#!/usr/bin/env node
'use strict';
/* desktop/lib/flowRecorder.js: map the URLs a person walked through in the real app back to its own pages, and build the
 * ordered process-flow steps (consecutive repeats collapsed, unmatched URLs skipped). Run: node tests/flow-recorder.test.js */
const H = require('./_harness');
const R = require('../desktop/lib/flowRecorder');

const T = H.makeAsserter();

// a route-based app (customer-portal) and a tab-shell app (shop), as the catalog slims them
const PAGES = [
  { id: 'portalapp/customer-portal/project-create-request', app: 'portalapp', flow: 'customer-portal', page: 'project-create-request', label: 'Create Equipment Request', route: { url: '/vp/shell/customer-portal/project-create-request' } },
  { id: 'portalapp/customer-portal/request-list', app: 'portalapp', flow: 'customer-portal', page: 'request-list', label: 'My Requests', route: { url: '/vp/shell/customer-portal/request-list' } },
  { id: 'shop/orders/order-list', app: 'shop', flow: 'orders', page: 'order-list', label: 'Order Workbench', route: { url: '/?open=orders-order-list' } },
  { id: 'shop/orders/order-detail', app: 'shop', flow: 'orders', page: 'order-detail', label: 'Order', route: { url: '/?open=orders-order-detail' } },
];

T.section('matchPage');
T.check('route-based: a full URL path maps to its page', (R.matchPage('https://host/vp/shell/customer-portal/request-list', PAGES) || {}).id === 'portalapp/customer-portal/request-list');
T.check('route-based: extra path/query/hash still matches by the flow/page tail', (R.matchPage('https://host/app/vp/shell/customer-portal/project-create-request?x=1#y', PAGES) || {}).id === 'portalapp/customer-portal/project-create-request');
T.check('tab-shell: the ?open= tab maps to its page', (R.matchPage('https://host/shop/webApps/shop/index.html?open=orders-order-detail', PAGES) || {}).id === 'shop/orders/order-detail');
T.check('a URL that is no app page (login / shell home) matches nothing', R.matchPage('https://host/vp/shell/', PAGES) === null && R.matchPage('https://login.example/oauth', PAGES) === null);

T.section('buildSteps');
const nav = [
  { url: 'https://host/oauth?code=1' },                                            // login — skipped
  { url: 'https://host/vp/shell/customer-portal/request-list', shot: 'data:image/png;base64,AAA' },
  { url: 'https://host/vp/shell/customer-portal/request-list' },                   // same page again — collapsed
  { url: 'https://host/vp/shell/customer-portal/project-create-request', shot: 'data:image/png;base64,BBB' },
  { url: 'https://host/vp/shell/customer-portal/request-list', shot: 'data:image/png;base64,CCC' },  // back to list (a new step)
];
const r = R.buildSteps(nav, PAGES);
T.eq('the distinct pages, in the order walked', r.steps.map((s) => s.name).join(' → '), 'My Requests → Create Equipment Request → My Requests');
T.check('each step carries the catalog page id and renumbered ids', r.steps.map((s) => s.id).join(',') === 'p1,p2,p3' && r.steps[1].page === 'portalapp/customer-portal/project-create-request');
T.check('the screenshot of a visit is kept as a page shot', r.steps[0].shot && r.steps[0].shot.src === 'page' && /^data:image\//.test(r.steps[0].shot.data));
T.check('the sign-in / oauth screen is dropped and counted', r.skipped === 1);
// a screen the person walked that is NOT in the catalog is still kept (named from its URL), never silently dropped
const rKeep = R.buildSteps([{ url: 'https://host/vp/shell/customer-portal/request-list' }, { url: 'https://host/vp/shell/fleet/depot-overview' }], PAGES);
T.check('an app screen not in the catalog is still a step (named from its URL), not dropped', rKeep.steps.length === 2 && rKeep.steps[1].name === 'Depot Overview' && rKeep.steps[1].page === '', JSON.stringify(rKeep.steps.map((s) => s.name + '/' + s.page)));
T.check('only sign-in / oauth is dropped, other unknown screens are kept', R.buildSteps([{ url: 'https://host/oauth?c=1' }, { url: 'https://host/vp/shell/fleet/depot-overview' }], PAGES).skipped === 1 && R.buildSteps([{ url: 'https://host/vp/shell/fleet/depot-overview' }], PAGES).skipped === 0);
T.check('a repeat visit with a newer screenshot updates the step', R.buildSteps([{ url: nav[1].url }, { url: nav[1].url, shot: 'data:image/png;base64,ZZZ' }], PAGES).steps[0].shot.data === 'data:image/png;base64,ZZZ');
T.check('nothing recorded: empty, nothing thrown', R.buildSteps([], PAGES).steps.length === 0 && R.buildSteps(null, null).skipped === 0);
T.check('even with no catalog, the walked app screens are kept (login dropped)', R.buildSteps(nav, []).steps.length === 3);

T.section('screens and dialogs (in-page screens the URL never changes for)');
const navS = [
  { url: 'https://host/vp/shell/customer-portal/request-list', title: 'My Requests', kind: 'page', screen: 'view:My Requests', shot: 'data:image/png;base64,AAA' },
  { url: 'https://host/vp/shell/customer-portal/request-list', title: 'Cancel request', kind: 'dialog', screen: 'dialog:Cancel request', shot: 'data:image/png;base64,BBB' }, // same URL, a dialog on it
  { url: 'https://host/vp/shell/customer-portal/request-list', title: 'Cancel request', kind: 'dialog', screen: 'dialog:Cancel request' }, // same dialog again — collapsed
  { url: 'https://host/vp/shell/customer-portal/project-create-request', title: 'New Equipment Request', kind: 'page', screen: 'view:New Equipment Request' },
];
const rs = R.buildSteps(navS, PAGES);
T.eq('a page and a dialog on the same URL are two steps, named by what was on screen', rs.steps.map((s) => s.name).join(' → '), 'My Requests → Cancel request → New Equipment Request');
T.check('each step records its url and whether it is a page or a dialog', rs.steps[0].kind === 'page' && rs.steps[1].kind === 'dialog' && rs.steps[0].url === rs.steps[1].url && /request-list$/.test(rs.steps[1].url) && rs.steps[2].kind === 'page' && rs.steps[2].page === 'portalapp/customer-portal/project-create-request', JSON.stringify(rs.steps.map((s) => s.kind + ' ' + s.url)));
T.check('the same dialog in a row is collapsed, the page id kept for context (so its APIs still resolve)', rs.steps.length === 3 && rs.steps[1].page === 'portalapp/customer-portal/request-list');
T.check('entries without a screen behave as before (no kind noise beyond the page default)', R.buildSteps([{ url: navS[0].url }], PAGES).steps[0].kind === 'page' && R.buildSteps([{ url: navS[0].url }], PAGES).steps[0].name === 'My Requests');
// pressing "Capture this screen" is deliberate: six captures of the same screen are six steps, not collapsed to one
const navM = [];
for (let i = 0; i < 6; i++) navM.push({ url: navS[0].url, title: 'My Requests', kind: 'page', screen: 'view:My Requests', manual: true });
T.check('every manual capture is its own step (consecutive repeats are NOT collapsed)', R.buildSteps(navM, PAGES).steps.length === 6);
T.check('auto repeats still collapse, so auto + manual mix keeps the manual ones', R.buildSteps([{ url: navS[0].url, screen: 'view:A', title: 'A' }, { url: navS[0].url, screen: 'view:A', title: 'A' }, { url: navS[0].url, screen: 'view:A', title: 'A', manual: true }], PAGES).steps.length === 2 && !('manual' in R.buildSteps(navM, PAGES).steps[0]));

T.section('captured API calls per step');
const nav2 = [
  { url: 'https://host/vp/shell/customer-portal/request-list', shot: 'data:image/png;base64,AAA' },
  { url: 'https://host/vp/shell/customer-portal/project-create-request', shot: 'data:image/png;base64,BBB' },
];
const calls = [
  { pageUrl: 'https://host/vp/shell/customer-portal/request-list', method: 'get', url: 'https://host/crm/v1/requests?q=open', body: '', status: 200, response: '{"items":[]}' },
  { pageUrl: 'https://host/vp/shell/customer-portal/project-create-request', method: 'POST', url: 'https://host/crm/v1/requests', body: '{"name":"New"}', status: 201, response: '{"id":7}' },
  { pageUrl: 'https://host/nowhere', method: 'GET', url: 'https://host/x', status: 200 }, // page matches nothing → dropped
];
const r2 = R.buildSteps(nav2, PAGES, calls);
T.check('calls are attached to the step whose page was open when they fired', (r2.steps[0].calls || []).length === 1 && r2.steps[0].calls[0].url.indexOf('/crm/v1/requests') !== -1 && (r2.steps[1].calls || []).length === 1 && r2.steps[1].calls[0].method === 'POST', JSON.stringify((r2.steps[0].calls || []).map((c) => c.method + ' ' + c.path)));
T.check('a call trims to method/url/path/query/body/status/response within the cap', r2.steps[0].calls[0].path === '/crm/v1/requests' && r2.steps[0].calls[0].query === 'q=open' && r2.steps[1].calls[0].body === '{"name":"New"}' && r2.steps[1].calls[0].status === 201 && r2.steps[1].calls[0].response === '{"id":7}');

T.section('callForApi');
const stepCalls = r2.steps[1].calls.concat(r2.steps[0].calls);
T.check('matches a catalog API to the captured call by method + path pattern', (R.callForApi({ method: 'POST', path: '/crm/v1/requests' }, stepCalls) || {}).body === '{"name":"New"}');
T.check('path pattern with {id} matches a concrete URL', R.pathMatches('/crm/v1/requests/{id}', '/crm/v1/requests/7') && !R.pathMatches('/crm/v1/requests/{id}', '/crm/v1/other/7'));
T.check('no match for a different method or path → null', R.callForApi({ method: 'DELETE', path: '/crm/v1/requests' }, stepCalls) === null && R.callForApi({ method: 'GET', path: '/crm/v1/none' }, stepCalls) === null);

T.report();
