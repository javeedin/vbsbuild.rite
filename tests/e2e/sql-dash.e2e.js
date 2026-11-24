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
  const enc = (t) => Buffer.from('ENC:' + Buffer.from(t).toString('base64'));
  const dec = (b) => Buffer.from(b.toString().slice(4), 'base64').toString();
  const sqlStore = await require('../../desktop/lib/oracleSql').open({ file: path.join(dir, 'conns.json'), driver: fakeOracle({ password: 'secret' }), encrypt: enc, decrypt: dec });
  const env = await E.start({ port: 19741, sqlStore, savedSqlStore, username: 'rite.user' });
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
