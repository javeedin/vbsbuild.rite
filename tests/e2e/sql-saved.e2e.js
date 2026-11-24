#!/usr/bin/env node
'use strict';
/*
 * SQL worksheet → the SQL library (save query / Saved dropdown / reopen / delete), in a browser.
 * Type SQL, "Save query" (name it; unshared so the test needs no git), it lands in the shared store and in the "Saved"
 * dropdown; reopen it into the editor; delete it. Needs `npm run build`. Run: node tests/e2e/sql-saved.e2e.js
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-sqlsaved-e2e-'));
  const savedSqlStore = SV.open({ root: dir });                 // local file, no data branch (no git in the test)
  // the real SQL store over a fake Oracle driver, so info.available is true and the worksheet renders (no connect needed to save)
  const enc = (t) => Buffer.from('ENC:' + Buffer.from(t).toString('base64'));
  const dec = (b) => Buffer.from(b.toString().slice(4), 'base64').toString();
  const sqlStore = await require('../../desktop/lib/oracleSql').open({ file: path.join(dir, 'sql-connections.json'), driver: fakeOracle({ password: 'secret' }), encrypt: enc, decrypt: dec });
  const env = await E.start({ port: 19740, sqlStore, savedSqlStore, username: 'rite.user' });
  const page = env.page;
  page.on('dialog', (d) => d.accept());
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('open the SQL worksheet');
    await env.open('/');
    await page.click('.nx-nav-item[data-nav-id="sql"]');
    await page.waitForSelector('#sqlSaveQuery', { timeout: 30000 });
    await page.waitForSelector('#sqlEditor', { timeout: 10000 });

    T.section('save a query');
    await page.fill('#sqlEditor', 'select * from eqr_equipment_master');
    await page.click('#sqlSaveQuery');
    await page.waitForSelector('#sqlSaveModal', { timeout: 10000 });
    await page.fill('#sqlSaveName', 'Equipment master');
    await page.fill('#sqlSaveDesc', 'the base table');
    await page.click('#sqlSaveShare'); // untick "Share with the team" so the test needs no git
    await page.click('#sqlSaveGo');
    await page.waitForFunction(() => !document.getElementById('sqlSaveModal'), null, { timeout: 10000 });
    await settle(page, 200);
    const inStore = savedSqlStore.listQueries();
    T.check('the query is saved in the shared store (name, sql, by)', inStore.length === 1 && inStore[0].name === 'Equipment master' && savedSqlStore.getQuery(inStore[0].id).sql === 'select * from eqr_equipment_master' && inStore[0].by === 'rite.user', JSON.stringify(inStore[0] || {}));

    T.section('it shows in the "Saved" dropdown');
    await page.click('#sqlSavedBtn');
    await page.waitForSelector('.nx-sql-savedmenu .nx-sql-savedrow', { timeout: 10000 });
    T.check('the saved query is listed', /Equipment master/.test(await env.text('.nx-sql-savedmenu')));

    T.section('reopen it into the editor');
    await page.fill('#sqlEditor', ''); // clear first, to prove it is loaded back
    await page.click('.nx-sql-savedmenu .nx-sql-savedname');
    await page.waitForFunction(() => /eqr_equipment_master/.test((document.getElementById('sqlEditor') || {}).value || ''), null, { timeout: 10000 });
    T.check('clicking a saved query loads its SQL into the worksheet and closes the dropdown', (await page.inputValue('#sqlEditor')).indexOf('eqr_equipment_master') !== -1 && !(await page.$('.nx-sql-savedmenu')));

    T.section('delete it');
    await page.click('#sqlSavedBtn');
    await page.waitForSelector('.nx-sql-savedmenu .nx-sql-saveddel', { timeout: 10000 });
    await page.click('.nx-sql-savedmenu .nx-sql-saveddel'); // confirm auto-accepted
    await settle(page, 300);
    T.check('the query is removed from the store', savedSqlStore.listQueries().length === 0);

    await env.shot('sql-saved.png');
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    await env.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  T.report();
})();
