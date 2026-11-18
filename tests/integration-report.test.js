#!/usr/bin/env node
'use strict';
/**
 * Integration diagrams and the report (webApps/buildrite/resources/js/integrationDiagram.js, integrationReport.js), on
 * the sample app's scan: the landscape (flows → systems, a line per flow × system, its thickness the calls, each box
 * naming its kind, a legend), a system's diagram (its pages → its endpoints → it; the folders every path shares said
 * once), a page's diagram (the page → what it calls → the systems); the PDF document (cover and figures, the landscape,
 * systems, the data sheet, endpoints, flows × systems, a page per system, page diagrams asked for, what is not resolved;
 * text escaped); the Excel sheets; the file name.
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

T.section('the report: PDF document, Excel sheets');
const html = R.html(m, { by: 'priya.raman', pages: ['shop/orders/order-create'] });
T.check('the cover: the app, when, by whom, the figures and the contents', /^<!doctype html>/.test(html) && /<h1>shop<\/h1>/.test(html) && /by priya\.raman/.test(html) && /<b>2<\/b><span>systems<\/span>/.test(html) && /<b>7<\/b><span>calls \(page × endpoint\)<\/span>/.test(html) && /<b>5 \/ 6<\/b>/.test(html));
T.check('…then the landscape, systems, data sheet (INT-0001…), endpoints, flows × systems, a section per system, the page asked for', /1\. Integration landscape[\s\S]*<svg/.test(html) && /2\. Systems/.test(html) && /3\. Integration data sheet[\s\S]*INT-0001[\s\S]*INT-0007/.test(html)
  && /4\. Endpoints/.test(html) && /5\. Flows × systems/.test(html) && /6\.1 The shop.s REST backend/.test(html) && /6\.2 Oracle BI Publisher \(SOAP\)/.test(html) && /Page: New Order/.test(html) && !/Not resolved/.test(html));
T.check('…A4 landscape, page breaks, rows kept whole, the direction as a word', /@page\{size:A4 landscape/.test(html) && /class="brk"/.test(html) && /tr\{page-break-inside:avoid\}/.test(html) && /class="dir dir-write">Write</.test(html));
const sh = R.sheets(m);
T.eq('the Excel sheets and their rows', sh.map((s) => s.name + ':' + s.rows.length).join(' '), 'Summary:10 Systems:2 Integrations:7 Endpoints:6 Flows x systems:3');
T.check('…the integrations sheet: source → target columns, values joined', sh[2].columns.map((c) => c.label).slice(0, 8).join('|') === 'ID|App|Source flow|Source page|Page id|Set off by|Via (chains)|Target system' && sh[2].rows.filter((r) => r.pageLabel === 'My Billing')[0].params === 'customer');
T.check('the file name: app and day', /^integrations-shop-\d{4}-\d{2}-\d{2}\.pdf$/.test(R.fileName(m, 'pdf')) && /\.xlsx$/.test(R.fileName(m, 'xlsx')));
T.report();
