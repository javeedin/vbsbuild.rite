#!/usr/bin/env node
'use strict';
/*
 * Tools → Fusion SQL → Fusion Setups, in a browser, against a stand-in Fusion pod (tests/fakeFusionPod.js) whose setup
 * tables hold made-up rows: the starter checklist by module (KPI tiles, module list with counts); Check one task → Done
 * with its count, Not done below the minimum, Error with the pod's words; the filters and search; Records → its rows
 * in a dialog (search, sort), Open in the SQL tab; Add task (Test the SQL, Ask AI to write it — a stand-in AI —, Save,
 * Check); Edit (its result dropped), Remove; Check the n shown (one after another, a confirm, the totals follow); another
 * pod has results of its own.
 * Needs `npm run build`. Run: node tests/e2e/fusion-setups.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const Pod = require('../fakeFusionPod');
const F = require('../../desktop/lib/fusionSql');
const S = require('../../desktop/lib/fusionSetups');

const T = H.makeAsserter();
const settle = (page, ms) => page.waitForTimeout(ms || 400);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-fsu-e2e-'));
  // made-up setup rows: two legal entities, three business units, no ledger, three payment terms
  const data = {
    XLE_ENTITY_PROFILES: [{ LEGAL_ENTITY_ID: '300000001', NAME: 'Northwind Trading Ltd', LEGAL_ENTITY_IDENTIFIER: 'NW-01' }, { LEGAL_ENTITY_ID: '300000002', NAME: 'Contoso Rentals', LEGAL_ENTITY_IDENTIFIER: 'CR-02' }],
    FUN_ALL_BUSINESS_UNITS_V: [{ BU_ID: '1', BU_NAME: 'North BU' }, { BU_ID: '2', BU_NAME: 'South BU' }, { BU_ID: '3', BU_NAME: 'East BU' }],
    GL_LEDGERS: [],
    AP_TERMS_TL: [{ TERM_ID: '10', NAME: 'Net 30' }, { TERM_ID: '11', NAME: 'Net 60' }, { TERM_ID: '12', NAME: 'Immediate' }],
  };
  const pod = await Pod.start({ runner: true, data });
  const pod2 = await Pod.start({ runner: true, data });
  const store = F.open({ file: path.join(dir, 'fusion-sql.json'), cacheDir: path.join(dir, 'cache'), encrypt: (t) => Buffer.from('sealed:' + Buffer.from(t).toString('base64')),
    decrypt: (b) => Buffer.from(String(b).replace(/^sealed:/, ''), 'base64').toString(), fetch: (u, i) => fetch(u, i), allowHttp: true });
  const p1 = store.savePod({ name: 'TEST', url: pod.url, login: 'own', username: pod.user, password: pod.password });
  const p2 = store.savePod({ name: 'UAT', url: pod2.url, login: 'own', username: pod2.user, password: pod2.password });
  store.setActive(p1.id);
  const setups = S.open({ file: path.join(dir, 'fusion-setups.json'), run: (x) => store.execute(x) });
  // a stand-in AI: writes the payment-terms check
  const asked = [];
  const aiStore = {
    settings: () => ({ active: 'anthropic', providers: { anthropic: { ready: true } }, features: [], uses: {} }),
    chat: async (b) => { asked.push(b); return { ok: true, provider: 'Claude (Anthropic)', text: 'Payment terms in the base table.\n```sql\nSELECT term_id, name FROM ap_terms_tl\n```' }; },
  };
  const env = await E.start({ port: 19994, fusionSqlStore: store, fusionSetupsStore: setups, aiStore });
  const page = env.page;
  page.on('dialog', (d) => d.accept());
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const text = (sel) => env.text(sel).catch(() => '');
  const task = (code) => '#fsuList .nx-fsu-task[data-code="' + code + '"]';
  const pill = (code) => text(task(code) + ' .nx-fsu-pill');
  const waitPill = (code, re) => page.waitForFunction(([sel, src]) => { const el = document.querySelector(sel); return el && new RegExp(src).test(el.textContent); }, [task(code) + ' .nx-fsu-pill', re.source], { timeout: 15000 });
  try {
    T.section('the checklist');
    await env.open('/');
    await page.click('.nx-nav-item[data-nav-id="fusion-sql"]');
    await page.waitForSelector('#fsqlTab-setups', { timeout: 30000 });
    await page.click('#fsqlTab-setups');
    await page.waitForSelector('#fsuList .nx-fsu-task', { timeout: 15000 });
    T.check('the starter checklist: 0 of 83 done, on the pod in use', /0 \/ 83/.test(await text('#fsuDone')) && /on TEST/.test(await text('#fsuDone')));
    T.check('the modules: All + 13, each with done / total', (await page.$$('#fsuModules .nx-fsu-mod')).length === 14 && /Enterprise Structures\s*0\/6/.test(await text('#fsuMod-COMMON')));
    T.check('every task, grouped under its module, not checked yet', (await page.$$('#fsuList .nx-fsu-task')).length === 83 && (await page.$$('#fsuList .nx-fsu-modhead')).length === 13 && /Not checked/.test(await pill('COMMON_LEGAL_ENTITIES')));
    await page.click('#fsuMod-COMMON');
    await settle(page);
    T.check('a module: only its tasks, no heading', (await page.$$('#fsuList .nx-fsu-task')).length === 6 && (await page.$$('#fsuList .nx-fsu-modhead')).length === 0);
    T.check('…and Check names how many', /Check the 6 shown/.test(await text('#fsuCheckShown')));

    T.section('a check: Done, Not done, Error');
    await page.click(task('COMMON_LEGAL_ENTITIES') + ' .nx-fsu-check');
    await waitPill('COMMON_LEGAL_ENTITIES', /Done/);
    T.check('Done, with its count and when', /2 rows/.test(await text(task('COMMON_LEGAL_ENTITIES') + ' .nx-fsu-meta')) && /just now/.test(await text(task('COMMON_LEGAL_ENTITIES') + ' .nx-fsu-meta')));
    T.check('it ran as COUNT(*) on the pod', pod.sql.some((s) => /COUNT\(\*\) AS CNT FROM \(\nSELECT legal_entity_id, name, legal_entity_identifier FROM xle_entity_profiles\n\)/.test(s)));
    await page.click(task('COMMON_REF_DATA_SETS') + ' .nx-fsu-check');
    await waitPill('COMMON_REF_DATA_SETS', /Error/);
    T.check('Error, with what the pod said', /ORA-00942/.test(await text(task('COMMON_REF_DATA_SETS') + ' .nx-fsu-error')));
    await page.click('#fsuMod-GL');
    await page.waitForSelector(task('GL_LEDGERS'), { timeout: 5000 });
    await page.click(task('GL_LEDGERS') + ' .nx-fsu-check');
    await waitPill('GL_LEDGERS', /Not done/);
    T.check('Not done: no row on the pod', /0 rows/.test(await text(task('GL_LEDGERS') + ' .nx-fsu-meta')));
    T.check('the tiles and the module list follow', /1 \/ 83/.test(await text('#fsuDone')) && /1/.test(await text('#fsuKpiMissing')) && /1/.test(await text('#fsuKpiErrors')) && /General Ledger\s*0\/9/.test(await text('#fsuMod-GL')));

    T.section('filters and search');
    await page.click('#fsuMod-ALL');
    await page.click('#fsuF-error');
    await settle(page);
    T.check('Errors: only that task', (await page.$$('#fsuList .nx-fsu-task')).length === 1 && !!(await page.$(task('COMMON_REF_DATA_SETS'))));
    await page.click('#fsuKpiMissing');
    await settle(page);
    T.check('the Not done tile filters too', (await page.$$('#fsuList .nx-fsu-task')).length === 1 && !!(await page.$(task('GL_LEDGERS'))));
    await page.click('#fsuF-all');
    await page.fill('#fsuSearch', 'business units');
    await settle(page);
    T.check('search: every word, in the name, FSM task or description', (await page.$$('#fsuList .nx-fsu-task')).length >= 1 && !!(await page.$(task('COMMON_BUSINESS_UNITS'))));
    await page.fill('#fsuSearch', '');
    await settle(page);

    T.section('the records behind a task');
    await page.click(task('COMMON_LEGAL_ENTITIES') + ' .nx-fsu-data');
    await page.waitForSelector('#fsuGrid .nx-sql-row:not(.nx-sql-row--head)', { timeout: 15000 });
    T.check('its rows, read on the pod (ids kept as text)', (await page.$$('#fsuGrid .nx-sql-row:not(.nx-sql-row--head)')).length === 2 && /Northwind Trading Ltd/.test(await text('#fsuGrid')) && /300000001/.test(await text('#fsuGrid')));
    T.check('how many, how long', /2 records/.test(await text('#fsuDataText')));
    await page.fill('#fsuDataQ', 'contoso');
    await settle(page);
    T.check('search the rows', (await page.$$('#fsuGrid .nx-sql-row:not(.nx-sql-row--head)')).length === 1 && /1 of 2 records/.test(await text('#fsuDataText')));
    await page.click('#fsuDataSql');
    await page.waitForSelector('#fsqlGrid', { timeout: 15000 });
    T.check('Open in the SQL tab: its SQL in the editor, run there', /xle_entity_profiles/.test(await page.inputValue('#fsqlEditor')) && /2 rows/.test(await text('#fsqlCount')));

    T.section('your own task');
    await page.click('#fsqlTab-setups');
    await page.waitForSelector('#fsuAdd', { timeout: 5000 });
    await page.click('#fsuAdd');
    await page.waitForSelector('#fsuDlg', { timeout: 5000 });
    await page.fill('#fsuModule', 'AP');
    await page.fill('#fsuName', 'Payment terms in use');
    await page.fill('#fsuFsm', 'Manage Payment Terms');
    await page.fill('#fsuMin', '3');
    await page.click('#fsuAi');
    await page.waitForFunction(() => /ap_terms_tl/.test((document.getElementById('fsuSql') || {}).value || ''), null, { timeout: 15000 });
    T.check('Ask AI to write it: the SQL in the box, checked on the pod', /checked it on the pod/.test(await text('#fsuTest')) && /Payment terms in use/.test(asked[asked.length - 1].user));
    await page.click('#fsuTestBtn');
    await page.waitForFunction(() => /rows/.test((document.getElementById('fsuTest') || {}).textContent || ''), null, { timeout: 15000 });
    T.check('Test the SQL: its rows on the pod, and whether it would be Done', /3 rows/.test(await text('#fsuTest')) && /would be DONE/.test(await text('#fsuTest')) && /TERM_ID, NAME/.test(await text('#fsuTest')));
    await page.click('#fsuSave');
    await page.waitForSelector('#fsuDlg', { state: 'detached', timeout: 10000 });
    const own = setups.list(p1.id).tasks.filter((t) => t.name === 'Payment terms in use')[0];
    T.check('saved: in its module, marked yours', !!own && own.module === 'AP' && /yours/i.test(await text(task(own.code))) && /needs 3/.test(await text(task(own.code))));
    await page.click(task(own.code) + ' .nx-fsu-check');
    await waitPill(own.code, /Done/);
    T.check('checked: Done (3 of 3)', /3 rows/.test(await text(task(own.code) + ' .nx-fsu-meta')));
    await page.click(task(own.code) + ' .nx-fsu-edit');
    await page.waitForSelector('#fsuDlg', { timeout: 5000 });
    T.check('Edit: the task as saved', (await page.inputValue('#fsuName')) === 'Payment terms in use' && (await page.inputValue('#fsuMin')) === '3');
    await page.fill('#fsuMin', '4');
    await page.click('#fsuSave');
    await page.waitForSelector('#fsuDlg', { state: 'detached', timeout: 10000 });
    await settle(page);
    T.check('changed: its old result dropped', /Not checked/.test(await pill(own.code)));
    await page.click(task(own.code) + ' .nx-fsu-check');
    await waitPill(own.code, /Not done/);
    T.check('…now Not done, 3 of the 4 needed', /needs 4/.test(await text(task(own.code) + ' .nx-fsu-meta')));
    await page.click(task(own.code) + ' .nx-fsu-del');
    await settle(page, 700);
    T.check('Remove: gone', !(await page.$(task(own.code))) && !setups.list(p1.id).tasks.some((t) => t.code === own.code));

    T.section('check the shown ones');
    await page.click('#fsuMod-COMMON');
    await settle(page);
    await page.click('#fsuCheckShown');
    await page.waitForSelector('#fsuStop', { timeout: 5000 });
    await page.waitForSelector('#fsuCheckShown', { timeout: 30000 });
    T.check('every COMMON task checked, one after another', (await page.$$eval('#fsuList .nx-fsu-pill', (l) => l.filter((x) => /Not checked/.test(x.textContent)).length)) === 0);
    T.check('the totals: legal entities + business units done', /2 \/ 83/.test(await text('#fsuDone')) && /Enterprise Structures\s*2\/6/.test(await text('#fsuMod-COMMON')));
    await env.shot('fusion-setups.png');

    T.section('another pod: its own results');
    await page.selectOption('#fsqlPod', p2.id);
    await page.waitForFunction(() => /0 \/ 83/.test((document.getElementById('fsuDone') || {}).textContent || ''), null, { timeout: 15000 });
    T.check('switched to UAT: nothing checked there yet', /on UAT/.test(await text('#fsuDone')) && /Not checked/.test(await pill('COMMON_LEGAL_ENTITIES')));
    await page.selectOption('#fsqlPod', p1.id);
    await page.waitForFunction(() => /2 \/ 83/.test((document.getElementById('fsuDone') || {}).textContent || ''), null, { timeout: 15000 });
    T.check('back on TEST: its results again', /Done/.test(await pill('COMMON_LEGAL_ENTITIES')));
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    await env.close();
    await pod.close();
    await pod2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  T.report();
})();
