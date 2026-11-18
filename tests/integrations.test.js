#!/usr/bin/env node
'use strict';
/**
 * Integrations (desktop/lib/integrations.js): the sample app scanned — its systems (from services/catalog.json and each
 * service: name, kind, host, how it signs in), one data-sheet row per page × endpoint (and per BI Publisher report),
 * numbered INT-0001… in a stable order, each with its source (page, flow, what sets it off: the page opening, a button)
 * and target (system, method, path, URL, direction Read / Write / Report, pattern, the values sent); each endpoint once
 * with its pages; flow × system; the totals; a call to an endpoint not in services/ listed as unresolved; the app with
 * the most pages chosen when none is asked.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const I = require('../desktop/lib/integrations');

const T = H.makeAsserter();
const FIX = path.join(__dirname, 'fixtures', 'vb-sample');
const copyDir = (from, to) => { fs.mkdirSync(to, { recursive: true }); fs.readdirSync(from).forEach((f) => { const a = path.join(from, f), b = path.join(to, f); if (fs.statSync(a).isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b); }); };

const m = I.scan(FIX);
T.section('the systems the app talks to');
T.check('the shop app chosen; 2 systems, the busiest first', m.ok && m.app === 'shop' && m.systems.map((s) => s.id).join() === 'shop,bipService', JSON.stringify(m.systems.map((s) => s.id)));
const shop = m.systems[0], bip = m.systems[1];
T.check('the shop\'s REST backend: named from its description, a REST service, its host, anonymous through the VB proxy; 6 calls (5 reads, 1 write) from 5 pages',
  shop.name === 'The shop\'s REST backend' && shop.kind === 'rest' && shop.host === 'shop.example.com' && shop.auth === 'Anonymous' && /VB proxy/.test(shop.proxy) && shop.calls === 6 && shop.reads === 5 && shop.writes === 1 && shop.pages.length === 5, JSON.stringify(shop));
T.check('BI Publisher: Oracle\'s name, its kind, signs in with Basic; 1 report', bip.name === 'Oracle BI Publisher (SOAP)' && bip.kind === 'bip' && /^Basic/.test(bip.auth) && bip.reports === 1, JSON.stringify(bip));

T.section('the data sheet: one row per page × endpoint, source → target');
T.eq('numbered in order (flow, page, system, endpoint)', m.rows.map((r) => r.id + ' ' + r.pageLabel + ' → ' + r.method + ' ' + r.path).join(' | '),
  'INT-0001 Customer Dashboard → GET /shop/v1/orders | INT-0002 My Billing → GET /shop/v1/invoices | INT-0003 New Order → POST /xmlpserver/services/ExternalReportWSSService | INT-0004 New Order → POST /shop/v1/orders | INT-0005 New Order → GET /shop/v1/customers | INT-0006 Order → GET /shop/v1/orders/{id} | INT-0007 Order Workbench → GET /shop/v1/orders');
const sub = m.rows.filter((r) => r.method === 'POST' && r.system === 'shop')[0];
T.check('a row: its source (flow, page, the chain, set off by the Submit button) and target (system, endpoint, URL, Write, REST)', sub.flow === 'orders' && sub.page === 'shop/orders/order-create' && sub.via.join() === 'SubmitChain'
  && sub.trigger === '"Submit" (button)' && sub.systemName === 'The shop\'s REST backend' && sub.endpoint === 'shopApi/createOrder' && sub.url === 'https://shop.example.com/api/shop/v1/orders' && sub.direction === 'Write' && /^REST · synchronous/.test(sub.pattern), JSON.stringify(sub));
const rep = m.rows.filter((r) => r.direction === 'Report')[0];
T.check('…a BI Publisher call: a Report, its report named, SOAP, set off when the page opens', rep.report === 'CUSTOMERS_RP' && /^SOAP · BI Publisher report/.test(rep.pattern) && rep.trigger === 'when the page opens');
T.check('…the values the page sends (My Billing: customer)', m.rows.filter((r) => r.pageLabel === 'My Billing')[0].params.join() === 'customer');

T.section('endpoints, flows, totals');
const orders = m.endpoints.filter((e) => e.endpoint === 'shopApi/getOrders')[0];
T.check('each endpoint once, with the pages that call it (getOrders: 2 pages)', m.endpoints.length === 6 && orders.pages.length === 2 && orders.pageLabels.sort().join() === 'Customer Dashboard,Order Workbench', JSON.stringify(orders));
T.eq('flow × system', m.matrix.map((x) => x.flow + '→' + x.system + ' ' + x.calls).join(', '), 'customers→shop 2, orders→bipService 1, orders→shop 4');
T.check('the totals: 6 pages, 5 with calls, 2 systems, 6 endpoints, 7 calls (5 reads, 1 write, 1 report), nothing unresolved', JSON.stringify(m.totals) === JSON.stringify({ pages: 6, pagesWith: 5, systems: 2, endpoints: 6, calls: 7, reads: 5, writes: 1, reports: 1, unresolved: 0 }), JSON.stringify(m.totals));

T.section('kinds by name and address; an endpoint not in services/');
T.eq('kinds', ['fusion|https://x.fa.oraclecloud.com', 'ics|https://oic.example.com/ic/api', 'bipService|https://x/xmlpserver', 'ords|https://h/ords/x', 'jira|https://acme.atlassian.net', 'stripe|https://api.stripe.com'].map((x) => I.kindOf(x.split('|')[0], x.split('|')[1]).kind).join(','),
  'fusion,oic,bip,ords,jira,rest');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'br-int-'));
try {
  copyDir(FIX, tmp);
  const chain = path.join(tmp, 'webApps/shop/flows/orders/pages/order-create-page-chains/SubmitChain.js');
  fs.writeFileSync(chain, fs.readFileSync(chain, 'utf8').replace("'shopApi/createOrder'", "'missingApi/createThing'"));
  const m2 = I.scan(tmp);
  T.check('a call whose endpoint is not in services/: its row says so, listed as unresolved', m2.totals.unresolved === 1 && m2.unresolved[0].endpoint === 'missingApi/createThing'
    && m2.rows.some((r) => r.endpoint === 'missingApi/createThing' && /Not in services|missingApi/.test(r.systemName)), JSON.stringify(m2.unresolved));
  T.check('…no app: said so', !I.scan(path.join(tmp, 'nothing')).ok);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
T.report();
