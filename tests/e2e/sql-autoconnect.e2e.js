#!/usr/bin/env node
'use strict';
/*
 * SQL worksheet → connect automatically on open. Once you've connected to a saved connection (password kept on this PC),
 * the worksheet reconnects to it the next time it opens — no manual Connect. A toggle in the connections panel turns it
 * off. Over the fake Oracle driver. Needs `npm run build`. Run: node tests/e2e/sql-autoconnect.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const { fakeOracle } = require('./fake-oracle');

const T = H.makeAsserter();

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-sqlauto-e2e-'));
  const enc = (t) => Buffer.from('ENC:' + Buffer.from(t).toString('base64'));
  const dec = (b) => Buffer.from(b.toString().slice(4), 'base64').toString();
  const sqlStore = await require('../../desktop/lib/oracleSql').open({ file: path.join(dir, 'conns.json'), driver: fakeOracle({ password: 'secret' }), encrypt: enc, decrypt: dec });
  const env = await E.start({ port: 19743, sqlStore, username: 'rite.user' });
  const page = env.page;
  page.on('dialog', (d) => d.accept());
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const openSql = async () => { await env.open('/'); await page.click('.nx-nav-item[data-nav-id="sql"]'); await page.waitForSelector('#sqlModeWork', { timeout: 30000 }); };
  try {
    T.section('connect once (password saved on this PC)');
    await openSql();
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
    T.check('the auto-connect toggle is on by default', await page.isChecked('#sqlAutoConnect'));

    T.section('disconnect, then reopen → it reconnects by itself');
    await page.click('#sqlDisconnect');
    await page.waitForSelector('#sqlNotConnected', { timeout: 10000 });
    await openSql();
    await page.waitForSelector('#sqlConnected', { timeout: 15000 });
    T.check('on open it reconnected to the last connection, with no manual Connect', !!(await page.$('#sqlConnected')) && /SHOPAPP/.test(await env.text('#sqlConnected')));

    T.section('turning the toggle off stops it');
    await page.click('#sqlAutoConnect'); // uncheck
    await page.waitForTimeout(150);
    await page.click('#sqlDisconnect');
    await page.waitForSelector('#sqlNotConnected', { timeout: 10000 });
    await openSql();
    await page.waitForSelector('#sqlNotConnected', { timeout: 10000 });
    T.check('with auto-connect off, it stays disconnected on open', !(await page.$('#sqlConnected')) && !(await page.isChecked('#sqlAutoConnect')));

    await env.shot('sql-autoconnect.png');
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    await env.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  T.report();
})();
