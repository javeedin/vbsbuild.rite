#!/usr/bin/env node
'use strict';
/*
 * Tools → Fusion SQL, in a browser, against a stand-in Fusion pod (tests/fakeFusionPod.js: BI Publisher's ReportService
 * and CatalogService over SOAP): no pod yet → Add a pod (a Fusion user of its own; the password never comes back);
 * Save and test fails (no runner on the pod) → Deploy the runner (folder, data model, report) → it answers; the schema
 * browser (FUSION tables, filter, Search Fusion, an object's columns, indexes, foreign keys, SELECT *); Run → the grid
 * (ids as text, numbers with separators, NULL, special characters), sort, search, a capped run; a {{PLACEHOLDER}} asked;
 * an Oracle error said; DELETE refused before any call; Save → Saved queries → Run; Ask AI (a stand-in AI): it looks a
 * table up, its first SQL is refused by the pod, the fixed one is checked → Use and run; API calls with the password ***.
 * Needs `npm run build`. Run: node tests/e2e/fusion-sql.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const Pod = require('../fakeFusionPod');
const F = require('../../desktop/lib/fusionSql');

const T = H.makeAsserter();
const settle = (page, ms) => page.waitForTimeout(ms || 400);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-fsql-e2e-'));
  const pod = await Pod.start({ tables: Array.from({ length: 30 }, (_, i) => 'XX_EXTRA_' + String(i).padStart(2, '0')) });
  const store = F.open({ file: path.join(dir, 'fusion-sql.json'), cacheDir: path.join(dir, 'cache'), encrypt: (t) => Buffer.from('sealed:' + Buffer.from(t).toString('base64')),
    decrypt: (b) => Buffer.from(String(b).replace(/^sealed:/, ''), 'base64').toString(), fetch: (u, i) => fetch(u, i), allowHttp: true });
  // a stand-in AI: looks the table up, writes SQL the pod refuses, then fixes it
  const asked = [];
  const aiStore = {
    settings: () => ({ active: 'anthropic', providers: { anthropic: { ready: true } }, features: [], uses: {} }),
    chat: async (b) => {
      asked.push(b);
      const n = asked.length;
      if (n === 1) return { ok: true, provider: 'Claude (Anthropic)', text: '```lookup\n[{"tool":"describe","name":"AP_INVOICES_ALL"},{"tool":"search_columns","column":"VENDOR_ID"}]\n```' };
      if (n === 2) return { ok: true, provider: 'Claude (Anthropic)', text: 'Here it is.\n```sql\nSELECT invoice_num, bad_col FROM ap_invoices_all\n```' };
      return { ok: true, provider: 'Claude (Anthropic)', text: 'Invoices of one supplier, biggest first.\n```sql\nSELECT invoice_id, invoice_num, invoice_amount FROM ap_invoices_all WHERE vendor_id = {{VENDOR_ID}}\n```\n- Joins: none needed.' };
    },
  };
  const env = await E.start({ port: 19990, fusionSqlStore: store, aiStore });
  const page = env.page;
  page.on('dialog', (d) => d.accept());
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const text = (sel) => env.text(sel).catch(() => '');
  try {
    T.section('the screen, no pod yet');
    await env.open('/');
    await page.click('.nx-nav-item[data-nav-id="fusion-sql"]');
    await page.waitForSelector('#fsqlTitle', { timeout: 30000 });
    await page.waitForSelector('#fsqlStart', { timeout: 15000 });
    T.check('Tools → Fusion SQL: no pod yet, says what to do', /Connect a Fusion pod first/.test(await text('#fsqlStart')));

    T.section('a pod: Save and test, then Deploy the runner');
    await page.click('#fsqlStartBtn');
    await page.waitForSelector('#fsqlPodForm', { timeout: 10000 });
    T.check('the form: a Fusion user of its own (no app login on this PC)', await page.isChecked('#fsqlLoginOwn'));
    await page.fill('#fsqlFName', 'TEST');
    await page.fill('#fsqlFUrl', pod.url);
    await page.fill('#fsqlFUser', pod.user);
    await page.fill('#fsqlFPassword', pod.password);
    await page.click('#fsqlTest');
    await page.waitForSelector('#fsqlConnResult', { timeout: 15000 });
    T.check('Save and test: the pod has no runner yet — said, with what to do', /The test failed/.test(await text('#fsqlConnResult')) && /not found/.test(await text('#fsqlConnResult')) && /Deploy the runner/.test(await text('#fsqlConnResult')), await text('#fsqlConnResult'));
    const saved = fs.readFileSync(path.join(dir, 'fusion-sql.json'), 'utf8');
    T.check('…the pod saved on this PC, its password sealed (never in clear in the file)', /"name": "TEST"/.test(saved) && saved.indexOf(pod.password) === -1 && /"password": "/.test(saved));
    await page.click('#fsqlDeploy');
    await page.waitForFunction(() => /runner is on the pod|deploy stopped/.test((document.getElementById('fsqlConnResult') || {}).textContent || ''), null, { timeout: 20000 });
    const dep = await text('#fsqlConnResult');
    T.check('Deploy the runner: folder, data model, report uploaded, then the test answers', /✓ The runner is on the pod and answers/.test(dep) && /Folder made: \/Custom\/BuildRite/.test(dep) && /Data model uploaded/.test(dep) && /Report uploaded/.test(dep) && /test query answered/.test(dep), dep);
    const dm = pod.catalog['/Custom/BuildRite/QueryRunnerDM.xdm'] || {};
    T.check('…the data model on the pod: DBMS_XMLGEN over the base64 P_QRY_STMT, data source ApplicationDB_FSCM', dm.entry === '_datamodel.xdm' && /DBMS_XMLGEN\.getxml/.test(dm.xml) && /P_QRY_STMT/.test(dm.xml) && /ApplicationDB_FSCM/.test(dm.xml));
    T.check('…the pods list: TEST in use, its user, the runner deployed', /TEST/.test(await text('#fsqlPods')) && /In use/i.test(await text('#fsqlPods')) && /BI\.TESTER/.test(await text('#fsqlPods')) && /runner deployed/.test(await text('#fsqlPods')));
    const st = await page.evaluate(() => fetch('/__fsql/settings', { headers: { 'X-Build-Rite-FSQL': '1' } }).then((r) => r.text()));
    T.check('the page is never sent the password', st.indexOf(pod.password) === -1 && /"hasPassword":true/.test(st));

    T.section('the schema browser');
    await page.click('#fsqlTab-sql');
    await page.waitForFunction(() => document.querySelectorAll('#fsqlObjects .nx-fsql-obj').length > 5, null, { timeout: 15000 }).catch(() => {});
    T.check('FUSION tables listed, said how many', (await page.$$('#fsqlObjects .nx-fsql-obj')).length === 39 && /39 tables/.test(await text('#fsqlSchemaNote')), await text('#fsqlSchemaNote'));
    await page.fill('#fsqlFilter', 'ap inv');
    await page.dispatchEvent('#fsqlFilter', 'input');
    await settle(page);
    const names = await page.$$eval('#fsqlObjects .nx-fsql-obj', (l) => l.map((x) => x.getAttribute('data-name')));
    T.eq('the filter: every word typed', names.join(), 'AP_INVOICES_ALL,AP_INVOICE_LINES_ALL');
    await page.click('#fsqlSearch');
    await page.waitForFunction(() => /found in Fusion/.test((document.getElementById('fsqlSchemaNote') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('Search Fusion: the dictionary asked', /found in Fusion/.test(await text('#fsqlSchemaNote')) && pod.sql.some((s) => /UPPER\(object_name\) LIKE '%AP INV%'/i.test(s)));
    await page.fill('#fsqlFilter', 'AP_INVOICES_ALL');
    await page.dispatchEvent('#fsqlFilter', 'input');
    await settle(page);
    await page.click('#fsqlObjects .nx-fsql-obj[data-name="AP_INVOICES_ALL"] .nx-fsql-objbtn');
    await page.waitForSelector('#fsqlCols .nx-fsql-col', { timeout: 10000 });
    const det = await text('#fsqlDetail');
    T.check('an object opened: its comment, columns with types, indexes, foreign keys', /Payables invoices/.test(det) && /INVOICE_ID\s*NUMBER\(18\) ·NN/.test(det) && /AP_INVOICES_U1 unique/.test(det) && /VENDOR_ID → FUSION\.POZ_SUPPLIERS/.test(det), det);
    await page.click('#fsqlSelectStar');
    const ed = await page.inputValue('#fsqlEditor');
    T.check('SELECT * writes the select with its columns', /^SELECT\n  INVOICE_ID,\n  INVOICE_NUM,/.test(ed) && /FROM AP_INVOICES_ALL$/.test(ed), ed);

    T.section('Run');
    await page.click('#fsqlRun');
    await page.waitForSelector('#fsqlGrid', { timeout: 15000 });
    const head = await page.$$eval('#fsqlGrid .nx-sql-row--head .nx-sql-c', (c) => c.map((x) => x.textContent.trim()));
    const cells = await page.$$eval('#fsqlGrid .nx-sql-row:not(.nx-sql-row--head)', (rows) => rows.map((r) => Array.prototype.map.call(r.querySelectorAll('.nx-sql-c'), (c) => c.textContent)));
    T.check('the grid: every column, in the SELECT\'s order', head.join('|') === '#|INVOICE_ID|INVOICE_NUM|VENDOR_ID|INVOICE_AMOUNT|DESCRIPTION|INVOICE_DATE', head.join('|'));
    T.check('…ids as text (no separators, 20 digits kept), amounts with separators, a NULL blank, special characters kept', cells[0][1] === '300000012345678' && cells[3][1] === '12345678901234567890'
      && cells[0][4] === '12,500.5' && cells[1][5] === '' && cells[0][5] === 'Steel <rods> & "bolts"\nline two' && cells[2][2] === '0042', JSON.stringify(cells.slice(0, 3)));
    T.check('…the count, the pod, how long', /4 rows · 6 columns · \d+ ms · TEST/.test(await text('#fsqlCount')), await text('#fsqlCount'));
    T.check('…sent capped: SELECT * FROM (…) WHERE ROWNUM <= 100', /^SELECT \* FROM \(\nSELECT\n  INVOICE_ID[\s\S]*\n\) WHERE ROWNUM <= 100$/.test(pod.sql[pod.sql.length - 1]));
    await page.click('#fsqlGrid .nx-fsql-sort[data-value="INVOICE_AMOUNT"]');
    await page.click('#fsqlGrid .nx-fsql-sort[data-value="INVOICE_AMOUNT"]');
    const firstAmt = await page.$eval('#fsqlGrid .nx-sql-row:not(.nx-sql-row--head) .nx-sql-c:nth-child(5)', (c) => c.textContent);
    T.eq('sort: a header twice = biggest first', firstAmt, '15,000');
    await page.fill('#fsqlGridQ', 'crane');
    await page.dispatchEvent('#fsqlGridQ', 'input');
    await settle(page);
    T.check('search the rows', (await page.$$('#fsqlGrid .nx-sql-row:not(.nx-sql-row--head)')).length === 1 && /1 of 4 rows/.test(await text('#fsqlCount')));
    await page.fill('#fsqlLimit', '2');
    await page.dispatchEvent('#fsqlLimit', 'change');
    await page.click('#fsqlRun');
    await page.waitForSelector('#fsqlCapped', { timeout: 15000 });
    T.check('Rows 2: two rows, "Capped at 2"', /Capped at 2/.test(await text('#fsqlCapped')) && /2 rows/.test(await text('#fsqlCount')));
    await page.fill('#fsqlLimit', '100');
    await page.dispatchEvent('#fsqlLimit', 'change');

    T.section('placeholders, errors, read-only');
    await page.fill('#fsqlEditor', 'SELECT invoice_num, invoice_amount FROM ap_invoices_all WHERE vendor_id = {{VENDOR_ID}}');
    await page.dispatchEvent('#fsqlEditor', 'input');
    await page.click('#fsqlRun');
    await page.waitForSelector('#fsqlParams', { timeout: 5000 });
    T.check('a {{PLACEHOLDER}}: its value asked first', !!(await page.$('#fsqlParam-VENDOR_ID')));
    await page.fill('#fsqlParam-VENDOR_ID', '5001');
    await page.click('#fsqlParamsRun');
    await page.waitForSelector('#fsqlGrid', { timeout: 15000 });
    T.check('…substituted as a number: that supplier\'s 2 invoices', /vendor_id = 5001\n/.test(pod.sql[pod.sql.length - 1]) && /2 rows/.test(await text('#fsqlCount')));
    await page.fill('#fsqlEditor', 'SELECT bad_col FROM ap_invoices_all');
    await page.dispatchEvent('#fsqlEditor', 'input');
    await page.click('#fsqlRun');
    await page.waitForSelector('#fsqlError', { timeout: 15000 });
    T.check('an Oracle error: ORA-00904 said as Fusion said it', /ORA-00904: "BAD_COL": invalid identifier/.test(await text('#fsqlError')));
    const before = pod.calls.length;
    await page.fill('#fsqlEditor', 'DELETE FROM ap_invoices_all');
    await page.dispatchEvent('#fsqlEditor', 'input');
    await page.click('#fsqlRun');
    await page.waitForFunction(() => /read-only/.test((document.getElementById('fsqlError') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('DELETE: refused here, before any call to the pod', /Only SELECT and WITH statements run here: Fusion SQL is read-only/.test(await text('#fsqlError')) && pod.calls.length === before);
    await page.click('#fsqlRtab-logs');
    T.check('Logs: each run, rows or the error', (await page.$$('#fsqlLogs .nx-fsql-log')).length >= 5 && /ERROR: Only SELECT/.test(await text('#fsqlLogs')) && /4 rows in \d+ ms/.test(await text('#fsqlLogs')));
    await page.click('#fsqlRtab-history');
    T.check('History: the statements as written (placeholder kept)', /\{\{VENDOR_ID\}\}/.test(await text('#fsqlHistory')));
    await page.click('#fsqlRtab-result');

    T.section('saved queries');
    await page.fill('#fsqlEditor', 'SELECT invoice_num, invoice_amount FROM ap_invoices_all WHERE vendor_id = {{VENDOR_ID}}');
    await page.dispatchEvent('#fsqlEditor', 'input');
    await page.click('#fsqlSave');
    await page.waitForSelector('#fsqlSaveDlg', { timeout: 5000 });
    await page.fill('#fsqlSaveName', 'Invoices of a supplier');
    await page.fill('#fsqlSaveDesc', 'By vendor id');
    await page.click('#fsqlSaveGo');
    await page.waitForSelector('#fsqlSaveDlg', { state: 'detached', timeout: 5000 });
    await page.click('#fsqlTab-queries');
    await page.waitForSelector('#fsqlQList .nx-fsql-q', { timeout: 5000 });
    T.check('Save: listed in Saved queries (name, what it shows, its SQL)', /Invoices of a supplier/.test(await text('#fsqlQList')) && /By vendor id/.test(await text('#fsqlQList')) && /\(1\)/.test(await text('#fsqlTab-queries')));
    await page.click('#fsqlQList .nx-fsql-q [data-op="run"]');
    await page.waitForSelector('#fsqlParams', { timeout: 5000 });
    T.check('Run from the list: back on SQL, the value remembered', (await page.inputValue('#fsqlParam-VENDOR_ID')) === '5001');
    await page.click('#fsqlParamsRun');
    await page.waitForSelector('#fsqlGrid', { timeout: 15000 });

    T.section('Ask AI');
    await page.click('#fsqlAskBtn');
    await page.waitForSelector('#fsqlAiQ', { timeout: 5000 });
    await page.fill('#fsqlAiQ', 'invoices of one supplier, biggest first');
    await page.click('#fsqlAiGo');
    await page.waitForSelector('#fsqlAiMsgs .nx-fsql-aisql', { timeout: 30000 });
    const card = await text('#fsqlAiMsgs .nx-fsql-msg--assistant');
    T.check('the answer: its SQL, checked on the pod after the first was refused', /✓ Checked on the pod/.test(card) && /vendor_id = \{\{VENDOR_ID\}\}/.test(card) && /2 look-ups in the data dictionary/.test(card) && asked.length === 3, card);
    T.check('the question box emptied once asked', (await page.inputValue('#fsqlAiQ')) === '');
    T.check('…the AI was given the look-ups (columns of AP_INVOICES_ALL) and the pod\'s refusal (ORA-00904)', /FUSION\.AP_INVOICES_ALL \(TABLE\): Payables invoices/.test(asked[1].user) && /INVOICE_AMOUNT NUMBER/.test(asked[1].user)
      && /Fusion answered:[\s\S]*ORA-00904/.test(asked[2].user) && asked[0].feature === 'sql' && /```lookup/.test(asked[0].system));
    T.check('…checked as SELECT * FROM (…) WHERE 1 = 0 with the placeholder as NULL', pod.sql.some((s) => /vendor_id = NULL\n\) WHERE 1 = 0$/.test(s)));
    await page.click('#fsqlAiMsgs .nx-fsql-msg--assistant [data-op="useRun"]');
    await page.waitForSelector('#fsqlParams', { timeout: 5000 });
    await page.click('#fsqlParamsRun');
    await page.waitForSelector('#fsqlGrid', { timeout: 15000 });
    T.check('Use and run: in the editor, run (its placeholder asked)', /invoice_amount FROM ap_invoices_all WHERE vendor_id = \{\{VENDOR_ID\}\}/.test(await page.inputValue('#fsqlEditor')) && /2 rows/.test(await text('#fsqlCount')));
    await env.shot('fusion-sql.png');

    T.section('API calls');
    await page.click('#fsqlTab-calls');
    await page.waitForSelector('#fsqlCalls .nx-fsql-call', { timeout: 5000 });
    await page.locator('#fsqlCalls .nx-fsql-call .nx-fsql-callhead').first().click();
    const call = await text('#fsqlCalls .nx-fsql-callbody');
    T.check('the last SOAP calls: runReport, the request with the password as ***, the decoded answer', /runReport \(xml\)/.test(await text('#fsqlCalls')) && /<v2:password>\*\*\*<\/v2:password>/.test(call) && call.indexOf(pod.password) === -1 && /reportBytes, decoded/i.test(call));
    await env.shot('fusion-sql-calls.png');
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
