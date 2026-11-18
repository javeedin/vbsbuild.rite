#!/usr/bin/env node
'use strict';
/*
 * Integrations, in a browser: Application → Integrations scans your working folder's app (the sample shop) and shows
 * every system it talks to and every call it makes — figures, the integration landscape, calls by system; between
 * systems, not page by page (System flows): the app ⇄ each system by business object, the interfaces (each opens its
 * rows in the data sheet), system → system and the cross-system flows (an action calling two systems, in order); the
 * integration data sheet (source page → target system, set off by, method, endpoint, direction) with a search, a system,
 * a flow and a direction; the endpoints; the systems (base URL, sign-in, services); the diagrams (landscape, a system,
 * a page) and Save SVG; the Excel workbook and a real PDF (Chromium, as the desktop app prints with Electron).
 * Needs `npm run build`. Run: node tests/e2e/integrations.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const settle = (page, ms) => page.waitForTimeout(ms || 400);
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const count = (page, sel) => page.$$eval(sel, (l) => l.length).catch(() => 0);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-int-e2e-'));
  const pg = await E.pagesSandbox();
  const { chromium } = require('playwright');
  const printer = await chromium.launch();
  const htmlToPdf = async (html) => { const p = await printer.newPage(); try { await p.setContent(html, { waitUntil: 'load' }); return await p.pdf({ format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true }); } finally { await p.close(); } };
  const env = await E.start({ port: 19984, pagesStore: pg.store, htmlToPdf });
  const page = env.page;
  page.on('dialog', (d) => d.accept());
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('the scan');
    await env.open('/?open=integrations');
    await page.waitForSelector('#intKpis', { timeout: 30000 });
    T.check('Integrations under Application', !!(await page.$('[data-nav-id="integrations"]')));
    const head = await text(page, '#intBar');
    T.check('the app scanned: shop, when, pages read', /shop/.test(head) && /Scanned .* · 6 pages read/.test(head), head);
    const kpis = await env.text('#intKpis');
    T.check('figures: 2 systems, 4 interfaces, 1 cross-system flow, 6 endpoints, 7 calls, 5 / 6 pages, reads, writes, a BI Publisher report; nothing unresolved', /2 systems it talks to/.test(kpis) && /4 interfaces \(system × object\)/.test(kpis) && /1 cross-system flow\b/.test(kpis) && /6 endpoints/.test(kpis) && /7 calls/.test(kpis)
      && /5 \/ 6 pages with integrations/.test(kpis) && /5 reads/.test(kpis) && /1 write \(changes data\)/.test(kpis) && /1 BI Publisher report\b/.test(kpis) && !/not in services/.test(kpis), kpis);
    const land = (await page.getAttribute('#intLand', 'srcdoc')) || '';
    T.check('the landscape: the flows (source) → the systems (target), as an SVG in a frame where nothing runs', /<svg/.test(land) && /customers/.test(land) && /orders/.test(land) && /shop/.test(land) && /BI Publisher/.test(land)
      && (await page.getAttribute('#intLand', 'sandbox')) === 'allow-same-origin', land.slice(0, 160));
    const bars = await text(page, '#intBySystem');
    T.check('calls by system: each with its kind and reads / writes / reports in words', /The shop's REST backend/.test(bars) && /REST/.test(bars) && /Oracle BI Publisher/.test(bars) && /reads/.test(bars) && /writes/.test(bars) && /reports/.test(bars), bars);
    await env.shot('integrations-overview.png');

    T.section('between systems, not page by page');
    await page.click('#intTabFlows');
    await page.waitForSelector('#intIfGrid', { timeout: 10000 });
    const sum = await env.text('#intFlowsSummary');
    T.check('the summary: 4 interfaces with 2 systems, which way the data goes, 1 cross-system flow', /^4 interfaces with 2 systems: the app reads from 2 systems and sends data to 1 system\. 1 cross-system flow — 1 action calling two or more systems one after the other\.$/.test(sum), sum);
    const sfd = (await page.getAttribute('#intSysDia', 'srcdoc')) || '';
    T.check('the flow between systems: the app ⇄ each system — what it sends, what comes back, the reports — by business object', /<svg/.test(sfd) && />Sends<\/tspan> Orders</.test(sfd) && />Returns 3<\/tspan> Orders · Customers · Invoices</.test(sfd)
      && />Reports<\/tspan> Customers report \(CUSTOMERS_RP\)</.test(sfd), sfd.slice(0, 160));
    T.check('interfaces: one per system and business object (4), counted', (await count(page, '#intIfGrid .nx-int-row:not(.nx-int-row--head)')) === 4 && /^4 shown of 4/.test(await env.text('#intIfCount')));
    const if1 = await env.text('#intIfGrid .nx-int-row[data-id="IF-001"]');
    T.check('IF-001: shop ⇄ the REST backend, Orders, read and write, GET and POST, set off by the Submit button and 3 pages opening, 3 endpoints · 4 calls · 4 pages', /shop ⇄ The shop's REST backend/.test(if1) && /Orders/.test(if1)
      && /Read/.test(if1) && /Write/.test(if1) && /GET, POST/.test(if1) && /"Submit" button · when 3 pages open/.test(if1) && /3 endpoints · 4 calls · 4 pages/.test(if1), if1);
    T.check('…a report: BI Publisher → shop, the customers report', /Oracle BI Publisher \(SOAP\) → shop/.test(await env.text('#intIfGrid .nx-int-row[data-id="IF-004"]')) && /Customers report \(CUSTOMERS_RP\)/.test(await env.text('#intIfGrid .nx-int-row[data-id="IF-004"]')));
    await page.fill('#intSq', 'invoices');
    await settle(page);
    T.check('find: invoices — one interface', (await count(page, '#intIfGrid .nx-int-row:not(.nx-int-row--head)')) === 1 && /Invoices/.test(await env.text('#intIfGrid')));
    await page.fill('#intSq', '');
    await page.selectOption('#intSSystem', 'bipService');
    await settle(page);
    T.check('a system: BI Publisher — its one interface, its cross-system flow still shown', (await count(page, '#intIfGrid .nx-int-row:not(.nx-int-row--head)')) === 1 && !!(await page.$('#intJList .nx-int-journey[data-id="SF-01"]')));
    await page.selectOption('#intSSystem', '');
    await settle(page);
    const ho = await env.text('#intHandoffs');
    T.check('system to system: the shop → BI Publisher, 1 action, customers from the first, the report to the second, on New Order', /The shop's REST backend/.test(ho) && /Oracle BI Publisher \(SOAP\)/.test(ho) && /1 action/.test(ho) && /Customers/.test(ho) && /New Order/.test(ho), ho);
    const j1 = await env.text('#intJList .nx-int-journey[data-id="SF-01"]');
    T.check('SF-01: 1. the shop (read: Customers) → 2. BI Publisher (report), on New Order when the page opens', /SF-01/.test(j1) && /1\. The shop's REST backend read: Customers/.test(j1) && /2\. Oracle BI Publisher \(SOAP\) report: Customers report \(CUSTOMERS_RP\)/.test(j1)
      && j1.indexOf('1. The shop') < j1.indexOf('2. Oracle') && /New Order — when the page opens/.test(j1), j1);
    await env.shot('integrations-flows.png');
    await page.$eval('#intIfaces', (e) => e.scrollIntoView());
    await env.shot('integrations-flows-interfaces.png');
    await page.$eval('#intJourneys', (e) => e.scrollIntoView());
    await env.shot('integrations-flows-cross.png');
    const [sfs] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#intSysSvg')]);
    T.check('Save SVG: the flow between systems', sfs.suggestedFilename() === 'integrations-shop-flow-between-systems.svg', sfs.suggestedFilename());
    // the detailed flow is kept beside the summary: the flows → the systems, and each system's pages → its endpoints
    T.check('Summary / Detailed: the summary first', /Summary — by business object/.test(await env.text('#intSfChips .nx-sc-chip--on')) && !!(await page.$('#intSysDia')) && !(await page.$('#intSysLand')));
    await page.click('#intSfChips [data-key="detailed"]');
    await page.waitForSelector('#intSysLand', { timeout: 5000 });
    const land2 = (await page.getAttribute('#intSysLand', 'srcdoc')) || '';
    const det = (await page.getAttribute('#intSysDetail', 'srcdoc')) || '';
    T.check('Detailed: the app\'s flows → the systems (customers, orders), as before', /<svg/.test(land2) && />customers</.test(land2) && />orders</.test(land2) && /A line.s thickness: the number of calls/.test(land2) && !(await page.$('#intSysDia')));
    T.check('…and each system in detail: the shop — the pages that call it → its 5 endpoints → it', /Pages that call it/.test(det) && /Its endpoints \(5\)/.test(det) && />Order Workbench</.test(det) && (await page.$eval('#intSfSystem', (e) => e.value)) === 'shop', det.slice(0, 160));
    await page.selectOption('#intSfSystem', 'bipService');
    await settle(page);
    T.check('…another system: BI Publisher in detail', /Its endpoints \(1\)/.test((await page.getAttribute('#intSysDetail', 'srcdoc')) || '') && />New Order</.test((await page.getAttribute('#intSysDetail', 'srcdoc')) || ''));
    const [dsv] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#intSfSystemSvg')]);
    const [lsv] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#intSysSvg')]);
    T.check('…Save SVG: that system\'s detail, and the flows → systems', /^integrations-shop-oracle-bi-publisher-soap\.svg$/.test(dsv.suggestedFilename()) && lsv.suggestedFilename() === 'integrations-shop-landscape.svg', dsv.suggestedFilename() + ' ' + lsv.suggestedFilename());
    await page.$eval('#intSysFlow', (e) => e.scrollIntoView());
    await env.shot('integrations-flows-detailed.png');
    await page.click('#intSfChips [data-key="summary"]');
    await page.waitForSelector('#intSysDia', { timeout: 5000 });
    await page.click('#intJChips [data-key="diagram"]');
    await page.waitForSelector('#intJDia', { timeout: 5000 });
    T.check('Cross-system flows as a diagram: SF-01, its systems in order', /SF-01/.test((await page.getAttribute('#intJDia', 'srcdoc')) || '') && /1\. The shop/.test((await page.getAttribute('#intJDia', 'srcdoc')) || '') && !(await page.$('#intJList')));
    await page.click('#intJChips [data-key="steps"]');
    await page.waitForSelector('#intJList', { timeout: 5000 });
    await page.click('#intIfGrid .nx-int-row[data-id="IF-001"] [data-act="sheetIf"]');
    await page.waitForSelector('#intGrid', { timeout: 10000 });
    T.check('"Its rows": the data sheet with IF-001\'s rows only — Orders on the shop (4), said in a chip', (await count(page, '#intGrid .nx-int-row:not(.nx-int-row--head)')) === 4 && /Interface IF-001 · Orders/.test(await env.text('#intObjChip'))
      && (await page.$eval('#intFSystem', (e) => e.value)) === 'shop' && /Orders/.test(await env.text('#intGrid')), await env.text('#intSheetCount'));
    await page.click('#intObjChip');
    await settle(page);
    T.check('…the chip clears it: every object of the shop again', !(await page.$('#intObjChip')) && (await count(page, '#intGrid .nx-int-row:not(.nx-int-row--head)')) === 6);
    await page.selectOption('#intFSystem', '');
    await settle(page);

    T.section('the integration data sheet');
    await page.click('#intTabSheet');
    await page.waitForSelector('#intGrid', { timeout: 10000 });
    const rows = await count(page, '#intGrid .nx-int-row:not(.nx-int-row--head)');
    T.check('one row per page × endpoint: 7, counted', rows === 7 && /7 shown of 7/.test(await text(page, '#intSheetCount')), String(rows));
    const first = await text(page, '#intGrid .nx-int-row[data-id="INT-0001"]');
    T.check('a row: its ID, the source page and flow, what sets it off, the target system, the method, the endpoint, the direction', /INT-0001/.test(first) && /(GET|POST|PATCH|PUT|DELETE)/.test(first) && /(Read|Write|Report)/.test(first)
      && /(when the page opens|\(button\)|run by)/.test(first), first);
    T.check('the direction chips: All 7 · Read 5 · Write 1 · Report 1', /All 7/.test(await text(page, '#intDirChips')) && /Read 5/.test(await text(page, '#intDirChips')) && /Write 1/.test(await text(page, '#intDirChips')) && /Report 1/.test(await text(page, '#intDirChips')));
    await page.click('#intDirChips [data-key="Write"]');
    await settle(page);
    const w = await text(page, '#intGrid');
    T.check('Write: only the call that changes data', (await count(page, '#intGrid .nx-int-row:not(.nx-int-row--head)')) === 1 && /Write/.test(w) && !/\bRead\b(?!s)/.test(w.replace(/^.*?Direction/, '')), w);
    await page.click('#intDirChips [data-key="all"]');
    await page.selectOption('#intFSystem', 'bipService');
    await settle(page);
    T.check('a system: BI Publisher — its report, nothing else', (await count(page, '#intGrid .nx-int-row:not(.nx-int-row--head)')) === 1 && /Report/.test(await text(page, '#intGrid')), await text(page, '#intGrid'));
    await page.selectOption('#intFSystem', '');
    await page.fill('#intQ', 'order');
    await settle(page);
    const q = await count(page, '#intGrid .nx-int-row:not(.nx-int-row--head)');
    T.check('a search (every word matches): fewer rows, still counted', q > 0 && q < 7 && new RegExp(q + ' shown of ' + q + ' \\(of 7 in all\\)').test(await text(page, '#intSheetCount')), await text(page, '#intSheetCount'));
    await page.fill('#intQ', '');
    await page.selectOption('#intFFlow', 'customers');
    await settle(page);
    const cust = await text(page, '#intGrid');
    T.check('a flow: customers — only its pages', (await count(page, '#intGrid .nx-int-row:not(.nx-int-row--head)')) > 0 && !/order-list|Order Workbench/i.test(cust), cust.slice(0, 200));
    await page.selectOption('#intFFlow', '');
    await settle(page);
    await env.shot('integrations-sheet.png');

    T.section('endpoints and systems');
    await page.click('#intTabEndpoints');
    await page.waitForSelector('#intEpGrid', { timeout: 10000 });
    T.check('each endpoint once (6), with the pages that call it', (await count(page, '#intEpGrid .nx-int-row:not(.nx-int-row--head)')) === 6 && /shopApi\//.test(await text(page, '#intEpGrid')), await text(page, '#intEpGrid'));
    await page.click('#intTabSystems');
    await page.waitForSelector('#intSystems', { timeout: 10000 });
    const sys = await text(page, '#intSystems .nx-int-card[data-id="shop"]');
    T.check('a system card: name, kind, base URL, sign-in, calls, pages, services', /The shop's REST backend/.test(sys) && /Base URL/.test(sys) && /Signs in/.test(sys) && /Calls/.test(sys) && /Pages/.test(sys) && /shopApi/.test(sys), sys);
    T.check('…one card per system (2)', (await count(page, '#intSystems .nx-int-card')) === 2);
    await env.shot('integrations-systems.png');
    await page.click('#intSystems .nx-int-card[data-id="bipService"] [data-act="sheetFor"]');
    await page.waitForSelector('#intGrid', { timeout: 10000 });
    T.check('"Its rows in the data sheet": the data sheet filtered to that system', (await count(page, '#intGrid .nx-int-row:not(.nx-int-row--head)')) === 1 && (await page.$eval('#intFSystem', (e) => e.value)) === 'bipService');
    await page.selectOption('#intFSystem', '');
    await settle(page);

    T.section('the diagrams');
    await page.click('#intTabSystems');
    await page.waitForSelector('#intSystems', { timeout: 10000 });
    await page.click('#intSystems .nx-int-card[data-id="shop"] [data-act="showSystem"]');
    await page.waitForSelector('#intDia', { timeout: 10000 });
    const sd = (await page.getAttribute('#intDia', 'srcdoc')) || '';
    T.check('"Its diagram": a system — the pages that call it, its endpoints, and it', /System: The shop's REST backend/.test(await text(page, '#intDiaTitle')) && /<svg/.test(sd) && /shopApi|\/shop\/v1|…\//.test(sd), await text(page, '#intDiaTitle'));
    await env.shot('integrations-diagram-system.png');
    await page.click('#intDiaChips [data-key="page"]');
    await page.waitForSelector('#intDiaPage', { timeout: 5000 });
    await page.selectOption('#intDiaPage', 'shop/orders/order-list');
    await settle(page, 600);
    const pd = (await page.getAttribute('#intDia', 'srcdoc')) || '';
    T.check('a page: what it calls and where', /^Page: .* — what it calls and where$/.test(await text(page, '#intDiaTitle')) && /<svg/.test(pd) && !!(await page.$('#intDiaPage')), await text(page, '#intDiaTitle'));
    T.check('the frame keeps the diagram\'s proportions', /aspect-ratio/.test((await page.getAttribute('#intDia', 'style')) || ''));
    await env.shot('integrations-diagram-page.png');
    const [svg] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#intSvg')]);
    const svgFile = path.join(dir, 'page.svg');
    await svg.saveAs(svgFile);
    T.check('Save SVG: the diagram as a file', /^integrations-shop-.*\.svg$/.test(svg.suggestedFilename()) && /^<svg[\s\S]*<\/svg>\s*$/.test(fs.readFileSync(svgFile, 'utf8').trim()), svg.suggestedFilename());
    await page.click('#intDiaChips [data-key="systems"]');
    await settle(page);
    T.check('Between systems, in Diagrams too', /^Between systems:/.test(await text(page, '#intDiaTitle')) && />Returns 3<\/tspan>/.test((await page.getAttribute('#intDia', 'srcdoc')) || ''));
    await page.click('#intDiaChips [data-key="journeys"]');
    await settle(page);
    T.check('…and the cross-system flows', /^Cross-system flows:/.test(await text(page, '#intDiaTitle')) && /SF-01/.test((await page.getAttribute('#intDia', 'srcdoc')) || ''));
    await page.click('#intDiaChips [data-key="landscape"]');
    await settle(page);
    T.check('the landscape again', /flows \(the source\)/.test(await text(page, '#intDiaTitle')));

    T.section('Excel and PDF');
    const [xl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#intExcel')]);
    const xlFile = path.join(dir, 'int.xlsx');
    await xl.saveAs(xlFile);
    const xlBytes = fs.readFileSync(xlFile);
    T.check('Excel: a workbook (zip) with the summary, systems, integrations, endpoints, flows × systems', /^integrations-shop-.*\.xlsx$/.test(xl.suggestedFilename()) && xlBytes.slice(0, 2).toString() === 'PK'
      && ['Summary', 'Interfaces', 'Cross-system flows', 'System to system', 'Systems', 'Integrations', 'Endpoints', 'Flows x systems'].every((n) => xlBytes.indexOf(n) !== -1), xl.suggestedFilename());
    const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#intPdf')]);
    const pdfFile = path.join(dir, 'int.pdf');
    await pdf.saveAs(pdfFile);
    const pdfBytes = fs.readFileSync(pdfFile);
    T.check('PDF: a real PDF (several KB) — the report with its diagrams', /^integrations-shop-.*\.pdf$/.test(pdf.suggestedFilename()) && pdfBytes.slice(0, 5).toString() === '%PDF-' && pdfBytes.length > 20000, pdf.suggestedFilename() + ' ' + pdfBytes.length);
    await page.waitForSelector('#intResult', { timeout: 5000 }).catch(() => {});
    T.check('…said so, with its size', /Saved integrations-shop-.*\.pdf \(\d+ KB\)/.test(await text(page, '#intResult')), await text(page, '#intResult'));

    T.section('scan again');
    await page.click('#intRescan');
    await page.waitForFunction(() => /Scanned: 2 systems, 6 endpoints, 7 calls/.test((document.getElementById('intResult') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
    T.check('Scan again: read again, said what it found', /Scanned: 2 systems, 6 endpoints, 7 calls/.test(await text(page, '#intResult')), await text(page, '#intResult'));
    T.check('no errors in the page', errs().length === 0, errs().join(' | '));
  } catch (e) {
    T.check('no exception: ' + (e && e.message), false);
  } finally {
    await env.close();
    await printer.close();
    pg.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  T.report();
})();
