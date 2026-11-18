#!/usr/bin/env node
'use strict';
/*
 * Integrations, in a browser: Application → Integrations scans your working folder's app (the sample shop) and shows
 * every system it talks to and every call it makes — figures, the integration landscape, calls by system; the
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
    T.check('figures: 2 systems, 6 endpoints, 7 calls, 5 / 6 pages, reads, writes, a BI Publisher report; nothing unresolved', /2 systems it talks to/.test(kpis) && /6 endpoints/.test(kpis) && /7 calls/.test(kpis)
      && /5 \/ 6 pages with integrations/.test(kpis) && /5 reads/.test(kpis) && /1 write \(changes data\)/.test(kpis) && /1 BI Publisher report\b/.test(kpis) && !/not in services/.test(kpis), kpis);
    const land = (await page.getAttribute('#intLand', 'srcdoc')) || '';
    T.check('the landscape: the flows (source) → the systems (target), as an SVG in a frame where nothing runs', /<svg/.test(land) && /customers/.test(land) && /orders/.test(land) && /shop/.test(land) && /BI Publisher/.test(land)
      && (await page.getAttribute('#intLand', 'sandbox')) === 'allow-same-origin', land.slice(0, 160));
    const bars = await text(page, '#intBySystem');
    T.check('calls by system: each with its kind and reads / writes / reports in words', /The shop's REST backend/.test(bars) && /REST/.test(bars) && /Oracle BI Publisher/.test(bars) && /reads/.test(bars) && /writes/.test(bars) && /reports/.test(bars), bars);
    await env.shot('integrations-overview.png');

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
    await page.click('#intDiaChips [data-key="landscape"]');
    await settle(page);
    T.check('the landscape again', /flows \(the source\)/.test(await text(page, '#intDiaTitle')));

    T.section('Excel and PDF');
    const [xl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#intExcel')]);
    const xlFile = path.join(dir, 'int.xlsx');
    await xl.saveAs(xlFile);
    const xlBytes = fs.readFileSync(xlFile);
    T.check('Excel: a workbook (zip) with the summary, systems, integrations, endpoints, flows × systems', /^integrations-shop-.*\.xlsx$/.test(xl.suggestedFilename()) && xlBytes.slice(0, 2).toString() === 'PK'
      && ['Summary', 'Systems', 'Integrations', 'Endpoints', 'Flows x systems'].every((n) => xlBytes.indexOf(n) !== -1), xl.suggestedFilename());
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
