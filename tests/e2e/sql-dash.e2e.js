#!/usr/bin/env node
'use strict';
/*
 * SQL worksheet → infolets + dashboards, in a browser. Connect (over the fake Oracle driver), run a query, "Save as
 * infolet" (a chart) with a live preview, switch to Dashboards, create one, add the infolet, see it render a chart by
 * running its SQL, make it wider, then remove it. Needs `npm run build`. Run: node tests/e2e/sql-dash.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const SV = require('../../desktop/lib/savedSql');
const { fakeOracle } = require('./fake-oracle');

const T = H.makeAsserter();
const settle = (page, ms) => page.waitForTimeout(ms || 250);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-sqldash-e2e-'));
  const savedSqlStore = SV.open({ root: dir });
  savedSqlStore.saveQuery({ name: 'Employees', sql: 'select ename, sal from emp', conn: 'devdb' }, 'rite.user'); // a saved query, for the Saved reports tab
  savedSqlStore.saveQuery({ name: 'By request', sql: 'select ename, sal from emp where empno = :empno', conn: 'devdb', binds: { empno: '7369' } }, 'rite.user'); // a saved report with a bind value
  const enc = (t) => Buffer.from('ENC:' + Buffer.from(t).toString('base64'));
  const dec = (b) => Buffer.from(b.toString().slice(4), 'base64').toString();
  const sqlStore = await require('../../desktop/lib/oracleSql').open({ file: path.join(dir, 'conns.json'), driver: fakeOracle({ password: 'secret' }), encrypt: enc, decrypt: dec });
  // a fake LLM (Anthropic shape): a dashboard plan when the system prompt carries the planner marker, else SQL.
  const aiFetch = async (url, init) => {
    const body = (init && init.body) || '';
    const json = (b) => ({ ok: true, status: 200, text: async () => JSON.stringify(b) });
    if (/\/v1\/models/.test(url)) return json({ data: [{ id: 'model-a', display_name: 'Model A' }] });
    if (/\/v1\/messages/.test(url)) {
      if (/BUILDRITE_DASHBOARD_PLAN/.test(body)) {
        return json({ content: [{ type: 'text', text: '```json\n[{"title":"Salaries","question":"salary by name"},{"title":"Headcount","question":"count of employees"}]\n```' }] });
      }
      return json({ content: [{ type: 'text', text: '```sql\nselect ename, sal from emp\n```\nnames and salaries.' }] });
    }
    return { ok: false, status: 404, text: async () => '{}' };
  };
  const aiStore = await require('../../desktop/lib/aiSql').open({ file: path.join(dir, 'ai.json'), encrypt: enc, decrypt: dec, fetch: aiFetch });
  const env = await E.start({ port: 19741, sqlStore, aiStore, savedSqlStore, username: 'rite.user' });
  const page = env.page;
  page.on('dialog', (d) => d.accept());
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('connect, and run a query');
    await env.open('/');
    await page.click('.nx-nav-item[data-nav-id="sql"]');
    await page.waitForSelector('#sqlNewConn', { timeout: 30000 });
    await page.click('#sqlNewConn');
    await page.waitForSelector('#sqlDialog');
    await page.fill('#sqlName', 'devdb');
    await page.fill('#sqlUser', 'shopapp');
    await page.fill('#sqlPassword', 'secret');
    await page.fill('#sqlHost', '10.1.2.3');
    await page.fill('#sqlService', 'devdb');
    await page.click('#sqlDlgSave');
    await page.waitForFunction(() => /Saved/.test((document.getElementById('sqlDlgStatus') || {}).innerText || ''), null, { timeout: 10000 });
    await page.click('#sqlDlgConnect');
    await page.waitForSelector('#sqlConnected', { timeout: 10000 });
    // set up Ask AI (so the AI infolet / AI dashboard can draft)
    await page.click('#sqlAiWho');
    await page.waitForSelector('#sqlAiProviders', { timeout: 10000 });
    await page.click('#sqlAiProviders [data-value="anthropic"]');
    await page.waitForSelector('#sqlAiF-key');
    await page.fill('#sqlAiF-key', 'sk-ant-TEST');
    await page.click('#sqlAiLoad');
    await page.waitForSelector('#sqlAiModels [data-value="model-a"]', { timeout: 10000 });
    await page.click('#sqlAiModels [data-value="model-a"]');
    await page.waitForFunction(() => (document.getElementById('sqlAiModel') || {}).value === 'model-a', null, { timeout: 5000 }).catch(() => {});
    await page.click('#sqlAiSave');
    await page.waitForSelector('#sqlAiDialog', { state: 'detached', timeout: 10000 });
    await page.fill('#sqlEditor', 'select ename, sal from emp');
    await page.click('#sqlRun');
    await page.waitForFunction(() => { const b = document.getElementById('sqlSaveInfolet'); return b && !b.disabled; }, null, { timeout: 10000 });
    T.check('a query ran, so "Save as infolet" is enabled', !(await page.getAttribute('#sqlSaveInfolet', 'disabled')));

    T.section('Save as infolet, with a live preview');
    await page.click('#sqlSaveInfolet');
    await page.waitForSelector('#sqlInfModal', { timeout: 10000 });
    await page.fill('#sqlInfName', 'Salary by name');
    await page.selectOption('#sqlInfLabel', 'ENAME');
    await page.selectOption('#sqlInfValue', 'SAL');
    await page.waitForFunction(() => /nx-if-bars/.test((document.getElementById('sqlInfPreview') || {}).innerHTML || ''), null, { timeout: 10000 });
    T.check('the dialog previews the chart as you build it', /nx-if-bars/.test(await page.innerHTML('#sqlInfPreview')));
    await page.click('#sqlInfShare'); // untick share (no git in the test)
    await page.click('#sqlInfGo');
    await page.waitForFunction(() => !document.getElementById('sqlInfModal'), null, { timeout: 10000 });
    const infs = savedSqlStore.listInfolets();
    T.check('the infolet is saved (name, kind, sql)', infs.length === 1 && infs[0].name === 'Salary by name' && infs[0].kind === 'bar' && savedSqlStore.getInfolet(infs[0].id).spec.value === 'SAL', JSON.stringify(infs[0] || {}));
    const infId = infs[0].id;

    T.section('Dashboards: create one and add the infolet');
    await page.click('#sqlModeDash');
    await page.waitForSelector('#sqlDashNew', { timeout: 10000 });
    T.check('the page header follows the mode (title + New dashboard action)', (await env.text('#sqlTitle')) === 'Dashboards' && !!(await page.$('#sqlNewDashTop')) && !(await page.$('#sqlNewConn')));
    await page.click('#sqlDashNew');
    await page.waitForSelector('#sqlBoardModal', { timeout: 10000 });
    await page.fill('#sqlBoardName', 'Ops overview');
    await page.click('#sqlBoardShare'); // untick share
    await page.click('#sqlBoardGo');
    await page.waitForSelector('#sqlSlotAdd', { timeout: 10000 });
    T.check('the board opens on an empty grid', !!(await page.$('#sqlBoardEmpty')));
    await page.click('#sqlSlotAdd');
    await page.waitForSelector('#sqlAddInfModal .nx-sql-infpick', { timeout: 10000 });
    T.check('the picker lists the saved infolet', /Salary by name/.test(await env.text('#sqlAddInfModal')));
    await page.click('#sqlAddInfModal .nx-sql-infpick');
    await page.waitForFunction((id) => { const el = document.getElementById('sqlSlot-' + id); return el && /nx-if-bars/.test(el.innerHTML); }, infId, { timeout: 15000 });
    T.check('the slot renders a bar chart by running its SQL on the connection', /nx-if-bars/.test(await page.innerHTML('#sqlSlot-' + infId)));
    const dbs = savedSqlStore.listDashboards();
    T.check('the dashboard is saved with the slot', dbs.length === 1 && savedSqlStore.dashboardWith(dbs[0].id).slots.length === 1, JSON.stringify(dbs[0] || {}));

    T.section('make it wider, then remove it');
    const spanBefore = await page.$eval('.nx-sql-slot', (el) => el.style.gridColumn);
    await page.click('.nx-sql-slot .nx-sql-slotbtn:nth-child(2)'); // the "+" (wider)
    await page.waitForFunction((b) => { const el = document.querySelector('.nx-sql-slot'); return el && el.style.gridColumn !== b; }, spanBefore, { timeout: 10000 });
    T.check('the slot grows a column span', (await page.$eval('.nx-sql-slot', (el) => el.style.gridColumn)) !== spanBefore);
    await page.click('.nx-sql-slot .nx-sql-slotbtn--x');
    await page.waitForFunction(() => !document.querySelector('.nx-sql-slot'), null, { timeout: 10000 });
    await settle(page, 500); // let the layout save round-trip to disk
    T.check('removing the slot empties the dashboard (in the grid and the store)', !!(await page.$('#sqlBoardEmpty')) && savedSqlStore.dashboardWith(dbs[0].id).slots.length === 0);

    T.section('AI infolet: drafted, previewed, added to the board');
    await page.click('#sqlInfNewAi');
    await page.waitForSelector('#sqlInfModal', { timeout: 10000 });
    await page.fill('#sqlInfGoal', 'staff pay list');
    await page.click('#sqlInfAiGo');
    await page.waitForFunction(() => /nx-if-bars/.test((document.getElementById('sqlInfPreview') || {}).innerHTML || ''), null, { timeout: 15000 });
    T.check('AI wrote the SQL, ran it, and previewed a chart', /nx-if-bars/.test(await page.innerHTML('#sqlInfPreview')));
    await page.click('#sqlInfShare');
    await page.click('#sqlInfGo');
    await page.waitForFunction(() => !document.getElementById('sqlInfModal'), null, { timeout: 10000 });
    await page.waitForFunction(() => { const s = document.querySelector('.nx-sql-slot'); return s && /nx-if-bars/.test(s.innerHTML); }, null, { timeout: 15000 });
    T.check('the AI infolet is saved and rendered on the board', savedSqlStore.listInfolets().some((x) => /staff pay list/i.test(x.name)) && (await page.$$('.nx-sql-slot')).length === 1);

    T.section('AI dashboard: several infolets from one description');
    await page.click('#sqlBoardAi');
    await page.waitForSelector('#sqlBoardAiModal', { timeout: 10000 });
    await page.fill('#sqlBoardAiGoal', 'an overview of staff');
    await page.click('#sqlBoardAiGo');
    await page.waitForFunction(() => !document.getElementById('sqlBoardAiModal'), null, { timeout: 25000 });
    await page.waitForFunction(() => document.querySelectorAll('.nx-sql-slot').length >= 3, null, { timeout: 20000 });
    T.check('the plan became several infolets on the board', (await page.$$('.nx-sql-slot')).length >= 3 && savedSqlStore.listInfolets().some((x) => x.name === 'Salaries') && savedSqlStore.listInfolets().some((x) => x.name === 'Headcount'));

    T.section('Saved reports: queries AND infolets are listed; open each as a tab');
    await page.click('#sqlModeReports');
    await page.waitForSelector('.nx-sql-replist', { timeout: 10000 });
    T.check('the worksheet is hidden in reports mode (no overlap)', !(await page.$('#sqlEditor')));
    T.check('the header reads "Saved reports" in reports mode', (await env.text('#sqlTitle')) === 'Saved reports');
    const repText = await env.text('.nx-sql-replistul');
    T.check('both a saved query and an infolet are listed as reports', /Employees/.test(repText) && /Staff pay list/.test(repText));
    await page.click('.nx-sql-reprow:has-text("Employees")');
    await page.waitForFunction(() => /nx-rep-grid/.test((document.getElementById('sqlRepBody') || {}).innerHTML || ''), null, { timeout: 15000 });
    T.check('a query report opens a tab and runs its SQL into a grid', /nx-rep-grid/.test(await page.innerHTML('#sqlRepBody')) && (await page.$$('.nx-sql-reptab')).length === 1);
    await page.click('.nx-sql-reprow:has-text("Staff pay list")');
    await page.waitForFunction(() => { const b = (document.getElementById('sqlRepBody') || {}).innerHTML || ''; return /nx-rep-chart/.test(b) && /nx-rep-grid/.test(b); }, null, { timeout: 15000 });
    T.check('an infolet report shows its chart above the grid, in a second tab', /nx-rep-chart/.test(await page.innerHTML('#sqlRepBody')) && (await page.$$('.nx-sql-reptab')).length === 2);
    await page.click('.nx-sql-reptabwrap:has-text("Employees") .nx-sql-reptabx');
    await page.waitForFunction(() => document.querySelectorAll('.nx-sql-reptab').length === 1, null, { timeout: 10000 });
    T.check('closing one report tab leaves the other open', (await page.$$('.nx-sql-reptab')).length === 1);

    T.section('a report with a bind shows the saved value, editable, then runs');
    await page.click('.nx-sql-reprow:has-text("By request")');
    await page.waitForSelector('#sqlRepBind-0', { timeout: 10000 });
    T.check('the bind bar shows the saved value, editable', (await page.inputValue('#sqlRepBind-0')) === '7369');
    await page.waitForFunction(() => /nx-rep-grid/.test((document.getElementById('sqlRepData') || {}).innerHTML || ''), null, { timeout: 15000 });
    T.check('with the saved value it runs straight away (no NJS-098)', /nx-rep-grid/.test(await page.innerHTML('#sqlRepData')) && !/NJS-098|bind/.test(await page.innerHTML('#sqlRepData')));
    await page.fill('#sqlRepBind-0', '7499');
    await page.click('#sqlRepBindRun');
    await page.waitForFunction(() => /nx-rep-grid/.test((document.getElementById('sqlRepData') || {}).innerHTML || ''), null, { timeout: 15000 });
    T.check('changing the value and Run re-runs the report', /nx-rep-grid/.test(await page.innerHTML('#sqlRepData')));

    await env.shot('sql-dash.png');
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    await env.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  T.report();
})();
