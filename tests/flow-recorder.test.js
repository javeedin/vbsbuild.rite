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
T.check('unmatched URLs are skipped and counted', r.skipped === 1);
T.check('a repeat visit with a newer screenshot updates the step', R.buildSteps([{ url: nav[1].url }, { url: nav[1].url, shot: 'data:image/png;base64,ZZZ' }], PAGES).steps[0].shot.data === 'data:image/png;base64,ZZZ');
T.check('nothing recorded / no pages: empty, nothing thrown', R.buildSteps([], PAGES).steps.length === 0 && R.buildSteps(nav, []).steps.length === 0 && R.buildSteps(null, null).skipped === 0);

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
