#!/usr/bin/env node
'use strict';
/*
 * Tools → BIP Reporting, in a browser, against a stand-in Fusion pod with a BI Publisher catalog (tests/fakeFusionPod.js):
 * the catalog (folders, crumbs, from Fusion then from this PC), a favourite, Index the catalog and search it; a report's
 * form (dates, a multiple choice with All), Run → rows (the parameters as BIP wants them), search the rows; date buckets
 * (a plan, one run per month, joined with a BUCKET column); a PDF kept as a file (downloaded); the SQL behind it → Fusion
 * SQL's editor; Add to dashboard (sum of a column, dates that move with today) → Run all; History (open a run, delete one);
 * Settings saved.
 * Needs `npm run build`. Run: node tests/e2e/bip.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const Pod = require('../fakeFusionPod');
const F = require('../../desktop/lib/fusionSql');
const B = require('../../desktop/lib/bipReports');
const KIT = require('../../webApps/buildrite/resources/js/bipKit.js');

const T = H.makeAsserter();
const settle = (page, ms) => page.waitForTimeout(ms || 400);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-bip-e2e-'));
  const rowsOf = (from, to, bu) => {
    const out = [];
    for (let d = KIT.toDate(from); d <= KIT.toDate(to); d = KIT.addDays(d, 1)) out.push([KIT.iso(d).replace(/-/g, ''), KIT.iso(d), bu, (d.getDate() * 10).toFixed(2)]);
    return out;
  };
  const DM = '<dataModel xmlns="http://xmlns.oracle.com/oxp/xmlp" defaultDataSourceRef="ApplicationDB_FSCM"><dataSets><dataSet name="Q_ORDERS" type="simple"><sql dataSourceRef="ApplicationDB_FSCM"><![CDATA[SELECT order_id, order_date FROM doo_headers_all WHERE order_date BETWEEN :P_FROM_DATE AND :P_TO_DATE]]></sql></dataSet></dataSets></dataModel>';
  const bip = {
    folders: {
      '/': [{ absolutePath: '/Custom', type: 'Folder' }, { absolutePath: '/Shared Folders', type: 'Folder' }],
      '/Custom': [{ absolutePath: '/Custom/Sales', type: 'Folder' }, { absolutePath: '/Custom/Finance', type: 'Folder' }],
      '/Custom/Sales': [{ absolutePath: '/Custom/Sales/Orders by day.xdo', displayName: 'Orders by day', type: 'Report' }, { absolutePath: '/Custom/Sales/Orders DM.xdm', displayName: 'Orders DM', type: 'DataModel' }],
      '/Custom/Finance': [{ absolutePath: '/Custom/Finance/Invoice print.xdo', displayName: 'Invoice print', type: 'Report' }],
      '/Shared Folders': [],
    },
    reports: {
      '/Custom/Sales/Orders by day.xdo': {
        def: { reportName: 'Orders by day', defaultOutputFormat: 'csv', dataModelURL: '/Custom/Sales/Orders DM.xdm', templates: [{ id: 'Data', formats: [['CSV', 'csv'], ['Data', 'xml'], ['PDF', 'pdf']] }],
          params: [{ name: 'P_FROM_DATE', label: 'From date', dataType: 'Date', dateFormatString: 'MM-dd-yyyy', default: '11-01-2026' }, { name: 'P_TO_DATE', label: 'To date', dataType: 'Date', dateFormatString: 'MM-dd-yyyy' },
            { name: 'P_BU', label: 'Business unit', dataType: 'String', values: ['N', 'S'], lovLabels: ['North BU', 'South BU'], multi: true, all: true }] },
        run: (fmt, p) => {
          const rows = rowsOf(KIT.parse(p.P_FROM_DATE[0], 'MM-dd-yyyy'), KIT.parse(p.P_TO_DATE[0], 'MM-dd-yyyy'), (p.P_BU || ['*']).join('+'));
          return fmt === 'pdf' ? '%PDF-1.4 orders' : 'ORDER_ID,ORDER_DATE,BU,AMOUNT\r\n' + rows.map((r) => r.join(',')).join('\r\n') + '\r\n';
        },
      },
      '/Custom/Finance/Invoice print.xdo': {
        def: { reportName: 'Invoice print', defaultOutputFormat: 'pdf', templates: [{ id: 'Invoice', formats: [['PDF', 'pdf']] }], params: [{ name: 'P_INVOICE', label: 'Invoice', dataType: 'String' }] },
        run: () => '%PDF-1.4 invoice',
      },
    },
    dataModels: { '/Custom/Sales/Orders DM.xdm': DM },
  };
  const pod = await Pod.start({ bip });
  const fq = F.open({ file: path.join(dir, 'fusion-sql.json'), cacheDir: path.join(dir, 'cache'), encrypt: (t) => Buffer.from('sealed:' + Buffer.from(t).toString('base64')),
    decrypt: (b) => Buffer.from(String(b).replace(/^sealed:/, ''), 'base64').toString(), fetch: (u, i) => fetch(u, i), allowHttp: true });
  fq.savePod({ name: 'TEST', url: pod.url, login: 'own', username: pod.user, password: pod.password });
  const bipStore = B.open({ dir: path.join(dir, 'bip'), fq });
  const env = await E.start({ port: 19998, fusionSqlStore: fq, bipStore });
  const page = env.page;
  page.on('dialog', (d) => d.accept());
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const text = (sel) => env.text(sel).catch(() => '');
  const item = (p) => '#bipCatalog .nx-bip-item[data-path="' + p + '"]';
  const lastRun = () => pod.calls.filter((c) => c.op === 'runReport').slice(-1)[0];
  const waitText = (sel, re, ms) => page.waitForFunction(([s, src]) => { const el = document.querySelector(s); return el && new RegExp(src).test(el.textContent); }, [sel, re.source], { timeout: ms || 15000 });
  try {
    T.section('the catalog');
    await env.open('/');
    await page.click('.nx-nav-item[data-nav-id="bip"]');
    await page.waitForSelector('#bipTitle', { timeout: 30000 });
    await page.waitForSelector(item('/Custom'), { timeout: 15000 });
    T.check('the root folder, read from Fusion as the pod\'s user', /From Fusion/.test(await text('#bipSrc')) && !!(await page.$(item('/Shared Folders'))) && /as BI\.TESTER/.test(await text('#bipPodBar')));
    await page.click(item('/Custom') + ' .nx-bip-name');
    await page.waitForSelector(item('/Custom/Sales'), { timeout: 10000 });
    await page.click(item('/Custom/Sales') + ' .nx-bip-name');
    await page.waitForSelector(item('/Custom/Sales/Orders by day.xdo'), { timeout: 10000 });
    T.check('a folder: its crumbs, a report with Run, a data model', /Catalog\s*Custom\s*Sales/.test(await text('.nx-bip-crumbs')) && !!(await page.$(item('/Custom/Sales/Orders by day.xdo') + ' .nx-bip-runit'))
      && /Data model/.test(await text(item('/Custom/Sales/Orders DM.xdm'))));
    await page.click('.nx-bip-crumb:nth-child(2)');
    await page.waitForSelector(item('/Custom/Sales'), { timeout: 10000 });
    T.check('a crumb goes back up; the folder comes from this PC now', /From this PC/.test(await text('#bipSrc')));
    await page.click(item('/Custom/Sales') + ' .nx-bip-name');
    await page.waitForSelector(item('/Custom/Sales/Orders by day.xdo'), { timeout: 10000 });
    await page.click(item('/Custom/Sales/Orders by day.xdo') + ' .nx-bip-star');
    await page.waitForSelector('.nx-bip-fav', { timeout: 5000 });
    T.check('a favourite: starred, listed on the left', /Orders by day/.test(await text('.nx-bip-side')) && !!(await page.$(item('/Custom/Sales/Orders by day.xdo') + ' .nx-bip-star--on')));

    T.section('index and search');
    await page.click('#bipIndex');
    await waitText('#bipSrc', /Index: 7 items in 5 folders/);
    T.check('Index the catalog: every folder walked, then Update', /Update the index/.test(await text('#bipIndex')));
    await page.fill('#bipSearch', 'invoice');
    await waitText('#bipSrc', /1 found for/);
    T.check('search: the whole catalog, with where it is', /Invoice print/.test(await text('#bipCatalog')) && /\/Custom\/Finance/.test(await text('#bipCatalog')));
    await page.fill('#bipSearch', '');

    T.section('a report: its form, Run');
    await page.click('.nx-bip-fav');
    await page.waitForSelector('#bipParams .nx-bip-param', { timeout: 15000 });
    T.check('the Run tab: its name, the formats, the data model', /Orders by day/.test(await text('#bipRepName')) && /Default output CSV/.test(await text('#bipDefNote')) && /CSV \(default\)/.test(await text('#bipFormat')));
    T.check('a date starts with its default (shown as a date)', (await page.inputValue('input[data-name="P_FROM_DATE"]')) === '2026-11-01');
    T.check('a multiple choice: All, then the labels', /All\s*North BU\s*South BU/.test(await text('select[data-name="P_BU"]')));
    await page.fill('input[data-name="P_TO_DATE"]', '2026-11-03');
    await page.selectOption('select[data-name="P_BU"]', ['N']);
    await page.click('#bipRun');
    await page.waitForSelector('#bipGrid .nx-sql-row:not(.nx-sql-row--head)', { timeout: 20000 });
    T.eq('the parameters as BIP wants them (dates in the report\'s format)', JSON.stringify(lastRun().params), JSON.stringify({ P_FROM_DATE: ['11-01-2026'], P_TO_DATE: ['11-03-2026'], P_BU: ['N'] }));
    T.check('rows: Done, 3 rows, kept on this PC', /Done/.test(await text('#bipStatus')) && /3 rows/.test(await text('#bipCount')) && (await page.$$('#bipGrid .nx-sql-row:not(.nx-sql-row--head)')).length === 3);
    await page.fill('#bipGridQ', '2026-11-02');
    await settle(page);
    T.check('search the rows', (await page.$$('#bipGrid .nx-sql-row:not(.nx-sql-row--head)')).length === 1 && /1 of 3 rows/.test(await text('#bipCount')));
    await page.fill('#bipGridQ', '');

    T.section('buckets');
    await page.selectOption('#bipBucketBy', 'month');
    await page.waitForSelector('#bipPlan', { timeout: 5000 });
    await page.fill('input[data-name="P_FROM_DATE"]', '2026-09-29');
    await page.fill('input[data-name="P_TO_DATE"]', '2026-11-02');
    await waitText('#bipPlan', /3 runs/);
    T.check('the plan: one run per month, joined', /3 runs \(2026-09-29 → 2026-09-30 … 2026-11-01 → 2026-11-02\)/.test(await text('#bipPlan')));
    await page.click('#bipRun');
    await waitText('#bipCount', /35 rows/, 20000);
    T.check('3 buckets run, their rows joined with a BUCKET column', /3 buckets/.test(await text('#bipCount')) && /BUCKET/.test(await text('#bipGrid .nx-sql-row--head')));
    await page.evaluate(() => { const el = document.getElementById('bipTitle'); if (el) el.scrollIntoView(); });
    await env.shot('bip-run.png');
    await page.selectOption('#bipBucketBy', 'none');

    T.section('the SQL behind it → Fusion SQL');
    await page.click('#bipDm');
    await page.waitForSelector('#bipDmDlg .nx-bip-ds', { timeout: 15000 });
    T.check('its data model: the data set and its SQL', /Q_ORDERS/.test(await text('#bipDmDlg')) && /doo_headers_all/.test(await text('#bipDmDlg')));
    await page.click('#bipDmDlg .nx-bip-dmfsql');
    await page.waitForSelector('#fsqlEditor', { timeout: 30000 });
    await page.waitForFunction(() => /doo_headers_all/.test((document.getElementById('fsqlEditor') || {}).value || ''), null, { timeout: 10000 });
    T.check('Open in Fusion SQL: in its editor, not run', true);
    await page.click('.nx-nav-item[data-nav-id="bip"]');
    await page.waitForSelector('#bipRepName', { timeout: 15000 });

    T.section('a PDF');
    await page.click('#bipTab-catalog');
    await page.fill('#bipSearch', 'invoice');
    await page.waitForSelector(item('/Custom/Finance/Invoice print.xdo'), { timeout: 10000 });
    await page.click(item('/Custom/Finance/Invoice print.xdo') + ' .nx-bip-runit');
    await page.waitForSelector('input[data-name="P_INVOICE"]', { timeout: 15000 });
    T.check('its default output: PDF', /PDF \(default\)/.test(await text('#bipFormat')));
    await page.fill('input[data-name="P_INVOICE"]', 'INV-1');
    await page.click('#bipRun');
    await page.waitForSelector('#bipFileOnly', { timeout: 20000 });
    const rid = (await page.getAttribute('#bipDownload', 'data-id'));
    const pdf = await page.evaluate((u) => fetch(u).then((r) => r.text()), '/__bip/run/file?id=' + rid);
    T.check('kept as a file, downloaded as it came', /PDF is kept on this PC/.test(await text('#bipFileOnly')) && pdf === '%PDF-1.4 invoice');

    T.section('the dashboard');
    await page.click('#bipTab-catalog');
    await page.click('.nx-bip-fav');
    await page.waitForSelector('#bipAddCard:not([disabled])', { timeout: 15000 });
    await page.click('#bipAddCard');
    await page.waitForSelector('#bipCardDlg', { timeout: 5000 });
    await page.selectOption('#bipCardMode', 'sum');
    await page.fill('#bipCardCol', 'AMOUNT');
    await page.fill('#bipCardDays', '6');
    T.check('Add to dashboard: dates that move with today, on the date pair', /From date → To date/.test(await text('#bipCardDlg')) && await page.isChecked('#bipCardRolling'));
    await page.click('#bipCardSave');
    await page.waitForSelector('#bipCardDlg', { state: 'detached', timeout: 10000 });
    await page.click('#bipTab-dashboard');
    await page.waitForSelector('#bipCards .nx-bip-card', { timeout: 5000 });
    await page.click('#bipRunAll');
    await page.waitForFunction(() => /rows/.test((document.querySelector('#bipCards .nx-bip-card') || {}).textContent || '') && !/Running/.test(document.querySelector('#bipCards .nx-bip-card').textContent), null, { timeout: 20000 });
    const val = Number((await text('#bipCards .nx-bip-cardval')).replace(/[^\d.]/g, ''));
    T.check('Run all: the sum of AMOUNT over the last 7 days, the rows, a preview', val > 0 && /7 rows/.test(await text('#bipCards .nx-bip-card')) && (await page.$$('#bipCards .nx-bip-minic')).length > 0);
    const today = new Date();
    T.check('…the card asked for the last 6 days to today', JSON.stringify(lastRun().params.P_TO_DATE) === JSON.stringify([KIT.format(today, 'MM-dd-yyyy')]));
    await env.shot('bip-dashboard.png');

    T.section('history');
    await page.click('#bipTab-history');
    await page.waitForSelector('#bipHistory .nx-bip-hrow', { timeout: 5000 });
    const n = (await page.$$('#bipHistory .nx-bip-hrow')).length;
    T.check('every run on this PC, newest first', n === 4 && /Orders by day/.test(await text('#bipHistory .nx-bip-hrow')));
    const bucketRow = '#bipHistory .nx-bip-hrow:nth-of-type(' + 1 + ')';
    await page.click('#bipHistory .nx-bip-hrow .nx-bip-hopen');
    await page.waitForSelector('#bipGrid', { timeout: 15000 });
    T.check('Open: its rows in the Run tab again', /7 rows/.test(await text('#bipCount')));
    await page.click('#bipTab-history');
    await page.waitForSelector('#bipHistory .nx-bip-hrow', { timeout: 5000 });
    await page.click('#bipHistory .nx-bip-hrow .nx-bip-hdel');
    await page.waitForFunction((m) => document.querySelectorAll('#bipHistory .nx-bip-hrow').length === m, n - 1, { timeout: 10000 });
    T.check('Delete: gone from this PC', bipStore.runs().runs.length === n - 1 && !!bucketRow);

    T.section('settings');
    await page.click('#bipTab-settings');
    await page.waitForSelector('#bipPChunk', { timeout: 5000 });
    await page.fill('#bipPChunk', '4');
    await page.click('#bipPSave');
    for (let i = 0; i < 25 && bipStore.settings().prefs.chunkMb !== 4; i++) await settle(page, 200);
    T.check('saved on this PC', bipStore.settings().prefs.chunkMb === 4);
    await page.click('#bipTab-catalog');
    await env.shot('bip.png');
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    await env.close();
    await pod.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  T.report();
})();
