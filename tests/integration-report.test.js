#!/usr/bin/env node
'use strict';
/**
 * Integration diagrams and the report (webApps/buildrite/resources/js/integrationDiagram.js, integrationReport.js), on
 * the sample app's scan: the landscape (flows → systems, a line per flow × system, its thickness the calls, each box
 * naming its kind, a legend), a system's diagram (its pages → its endpoints → it; the folders every path shares said
 * once), a page's diagram (the page → what it calls → the systems); the PDF document (cover and figures, the landscape,
 * systems, the data sheet, endpoints, flows × systems, a page per system, page diagrams asked for, what is not resolved;
 * text escaped); between systems — the app ⇄ each system by business object (sends / returns / reports), the
 * cross-system flows (an action calling two systems, in order), their PDF sections and Excel sheets; the file name.
 */
const fs = require('fs');
const path = require('path');
const H = require('./_harness');
const I = require('../desktop/lib/integrations');

const T = H.makeAsserter();
const JS = path.join(__dirname, '..', 'webApps', 'buildrite', 'resources', 'js');
let D = null, R = null;
new Function('define', fs.readFileSync(path.join(JS, 'integrationDiagram.js'), 'utf8'))((deps, f) => { D = f(); });
new Function('define', fs.readFileSync(path.join(JS, 'integrationReport.js'), 'utf8'))((deps, f) => { R = f(D); });
const m = I.scan(path.join(__dirname, 'fixtures', 'vb-sample'));

T.section('the landscape');
const land = D.landscape(m);
T.check('an SVG of its size: the app\'s flows (customers, orders) and its systems (named, their kind, host, figures)', /^<svg [^>]*width="1100" height="\d+"/.test(land.svg) && land.h > 200
  && />customers</.test(land.svg) && />orders</.test(land.svg) && />The shop&#39;s REST backend<|>The shop's REST backend</.test(land.svg) && /REST service · shop\.example\.com/.test(land.svg)
  && /6 calls · 5 reads · 1 write · 5 endpoints/.test(land.svg), land.svg.slice(0, 200));
T.check('…a line per flow × system (3), each with a tooltip saying its calls; the legend names the kinds', (land.svg.match(/<path d="M[^"]* C/g) || []).length === 3 && /<title>orders → The shop.s REST backend: 4 calls · 3 reads · 1 write<\/title>/.test(land.svg)
  && /REST service<\/text>/.test(land.svg) && /Oracle BI Publisher<\/text>/.test(land.svg) && /A line.s thickness: the number of calls\./.test(land.svg));

T.section('a system, a page');
const sys = D.system(m, 'shop');
T.check('the shop: its pages → its endpoints (method badge, path, pages) → it; the shared folders said once (under /shop/v1)', /Pages that call it/.test(sys.svg) && /Its endpoints \(5\)/.test(sys.svg) && /under \/shop\/v1/.test(sys.svg)
  && />…\/orders\/\{id\}</.test(sys.svg) && />GET</.test(sys.svg) && />POST</.test(sys.svg) && />Order Workbench</.test(sys.svg), sys.svg.slice(0, 300));
T.eq('…the common prefix: two or more folders only', [D.commonPrefix(['/a/b/c/x', '/a/b/c/y']), D.commonPrefix(['/a/x', '/a/y']), D.commonPrefix(['/x'])].join(' | '), '/a/b/c |  | ');
const pg = D.page(m, 'shop/orders/order-create');
T.check('New Order: the page → its 3 calls → 2 systems; set off by in the tooltips', /What it calls \(3\)/.test(pg.svg) && />New Order</.test(pg.svg) && /set off by &quot;Submit&quot; \(button\)|set off by "Submit" \(button\)/.test(pg.svg)
  && />Oracle BI Publisher \(SO…<|>Oracle BI Publisher \(SOAP\)</.test(pg.svg), pg.svg.slice(0, 200));
T.check('…no such system: nothing; a page with no call says so', D.system(m, 'nope').svg === '' && /This page calls no web service\./.test(D.page(m, 'shop//shell').svg));
T.eq('text is escaped', D.esc('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');

T.section('between systems, not page by page');
const sf = D.systemFlow(m);
T.check('the app ⇄ each system: the shop returns Orders, Customers, Invoices and is sent Orders; BI Publisher runs the customers report', /^<svg [^>]*width="1100"/.test(sf.svg) && sf.title === 'Flow between systems'
  && /<tspan font-weight="700" fill="#a8461b">Sends<\/tspan> Orders</.test(sf.svg) && /<tspan font-weight="700" fill="#1d4f91">Returns 3<\/tspan> Orders · Customers · Invoices</.test(sf.svg)
  && /<tspan font-weight="700" fill="#11704b">Reports<\/tspan> Customers report \(CUSTOMERS_RP\)</.test(sf.svg) && /3 interfaces · 6 calls/.test(sf.svg) && /4 interfaces · 2 systems/.test(sf.svg), sf.svg.slice(0, 300));
T.check('…which way, by the arrow and in words (sends: the app writes; returns: the system returns)', /Sends: the app sends \(writes\)/.test(sf.svg) && /Returns: the system returns \(reads\)/.test(sf.svg) && (sf.svg.match(/marker-end="url\(#ar[0-2]\)"/g) || []).length >= 6);
const jd = D.journeys(m);
T.check('cross-system flows: SF-01 — New Order reads customers from the shop, then runs the report in BI Publisher, in that order', /SF-01/.test(jd.svg) && /1\. The shop.s REST backend/.test(jd.svg) && /2\. Oracle BI Publisher/.test(jd.svg)
  && jd.svg.indexOf('1. The shop') < jd.svg.indexOf('2. Oracle BI') && /e\.g\. New Order — when the page opens \(LoadCustomersChain\)/.test(jd.svg), jd.svg.slice(0, 300));
T.check('…none: said so', /No single action calls more than one system/.test(D.journeys({ journeys: [] }).svg));
T.eq('a list cut to fit, the rest counted', [D.listFit(['Orders', 'Customers', 'Invoices'], 400, 12), D.listFit(['A long object name here', 'B long object name here', 'C long object name here'], 166, 11)].join(' | '), 'Orders · Customers · Invoices | A long object … +2 more');
T.eq('which way an interface\'s data goes', m.interfaces.map((x) => R.flowText(x, 'app')).join(' | '), 'app ⇄ The shop\'s REST backend | The shop\'s REST backend → app | The shop\'s REST backend → app | Oracle BI Publisher (SOAP) → app');

T.section('the report: PDF document, Excel sheets');
const html = R.html(m, { by: 'priya.raman', pages: ['shop/orders/order-create'] });
T.check('the cover: the app, when, by whom, the figures and the contents', /^<!doctype html>/.test(html) && /<h1>shop<\/h1>/.test(html) && /by priya\.raman/.test(html) && /<b>2<\/b><span>systems<\/span>/.test(html) && /<b>4<\/b><span>interfaces \(system × object\)<\/span>/.test(html) && /<b>1<\/b><span>cross-system flows<\/span>/.test(html) && /<b>7<\/b><span>calls \(page × endpoint\)<\/span>/.test(html) && /<b>5 \/ 6<\/b>/.test(html));
T.check('…then the landscape, between systems, interfaces, cross-system flows, systems, data sheet (INT-0001…), endpoints, flows × systems, a section per system, the page asked for', /1\. Integration landscape[\s\S]*<svg/.test(html)
  && /2\. Flow between systems[\s\S]*Flow between systems[\s\S]*System to system/.test(html) && /3\. Interfaces[\s\S]*IF-001[\s\S]*IF-004/.test(html) && /4\. Cross-system flows[\s\S]*SF-01/.test(html) && /5\. Systems/.test(html)
  && /6\. Integration data sheet[\s\S]*INT-0001[\s\S]*INT-0007/.test(html) && /7\. Endpoints/.test(html) && /8\. Flows × systems/.test(html) && /9\.1 The shop.s REST backend/.test(html) && /9\.2 Oracle BI Publisher \(SOAP\)/.test(html) && /Page: New Order/.test(html) && !/Not resolved/.test(html));
T.check('…an interface line: which way, the object, both directions, its methods, what sets it off', /shop ⇄ The shop.s REST backend<\/td><td><b>Orders<\/b><\/td><td><span class="dir dir-read">Read<\/span> <span class="dir dir-write">Write<\/span><\/td><td class="mono">GET, POST<\/td><td>&quot;Submit&quot; button · when 3 pages open<\/td>/.test(html), (html.match(/IF-001[\s\S]{0,500}/) || [''])[0]);
T.check('…a cross-system flow: the systems in order with what each does', /1\. The shop.s REST backend \(read: Customers\) → 2\. Oracle BI Publisher \(SOAP\) \(report: Customers report \(CUSTOMERS_RP\)\)/.test(html));
T.check('…A4 landscape, page breaks, rows kept whole, the direction as a word', /@page\{size:A4 landscape/.test(html) && /class="brk"/.test(html) && /tr\{page-break-inside:avoid\}/.test(html) && /class="dir dir-write">Write</.test(html));
const sh = R.sheets(m);
T.eq('the Excel sheets and their rows', sh.map((s) => s.name + ':' + s.rows.length).join(' '), 'Summary:13 Interfaces:4 Cross-system flows:1 System to system:1 Systems:2 Integrations:7 Endpoints:6 Flows x systems:3');
const shI = sh.filter((s) => s.name === 'Integrations')[0];
T.check('…the integrations sheet: source → target columns, the business object, values joined', shI.columns.map((c) => c.label).slice(0, 10).join('|') === 'ID|App|Source flow|Source page|Page id|Set off by|Via (chains)|Target system|Target kind|Business object' && shI.rows.filter((r) => r.pageLabel === 'My Billing')[0].params === 'customer');
const shF = sh.filter((s) => s.name === 'Interfaces')[0].rows[0], shJ = sh.filter((s) => s.name === 'Cross-system flows')[0].rows[0];
T.check('…the interfaces sheet (from → to, object, direction, set off by, counts) and the cross-system flows sheet', shF.id === 'IF-001' && shF.data === 'shop ⇄ The shop\'s REST backend' && shF.object === 'Orders' && shF.direction === 'Read & write' && shF.endpoints === 3 && shF.calls === 4
  && shJ.path === 'The shop\'s REST backend → Oracle BI Publisher (SOAP)' && /New Order — when the page opens \(LoadCustomersChain\)/.test(shJ.where), JSON.stringify([shF, shJ]));
T.check('the file name: app and day', /^integrations-shop-\d{4}-\d{2}-\d{2}\.pdf$/.test(R.fileName(m, 'pdf')) && /\.xlsx$/.test(R.fileName(m, 'xlsx')));
T.report();
