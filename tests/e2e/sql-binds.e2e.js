#!/usr/bin/env node
'use strict';
/*
 * SQL worksheet → bind values. A statement with :name placeholders asks for their values in a dialog before it runs
 * (like SQL Developer), instead of failing with NJS-098. Over the fake Oracle driver. Needs `npm run build`.
 * Run: node tests/e2e/sql-binds.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const { fakeOracle } = require('./fake-oracle');

const T = H.makeAsserter();

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-sqlbind-e2e-'));
  const enc = (t) => Buffer.from('ENC:' + Buffer.from(t).toString('base64'));
  const dec = (b) => Buffer.from(b.toString().slice(4), 'base64').toString();
  const D = fakeOracle({ password: 'secret' });
  const sqlStore = await require('../../desktop/lib/oracleSql').open({ file: path.join(dir, 'conns.json'), driver: D, encrypt: enc, decrypt: dec });
  const env = await E.start({ port: 19742, sqlStore, username: 'rite.user' });
  const page = env.page;
  page.on('dialog', (d) => d.accept());
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('connect');
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

    T.section('a statement with :binds prompts for values, then runs');
    await page.fill('#sqlEditor', 'select ename, sal from emp where empno = :empno and sal > :min_sal');
    await page.click('#sqlRun');
    await page.waitForSelector('#sqlBindModal', { timeout: 10000 });
    T.check('the bind dialog lists both placeholders (not a run yet)', /:empno/.test(await env.text('#sqlBindModal')) && /:min_sal/.test(await env.text('#sqlBindModal')) && !!(await page.$('#sqlBind-0')) && !!(await page.$('#sqlBind-1')));
    T.check('nothing has been sent to the database yet', D.calls.filter((c) => c.op === 'execute' && /from emp/i.test(c.sql)).length === 0);
    await page.fill('#sqlBind-0', '7369');
    await page.fill('#sqlBind-1', '1000');
    await page.click('#sqlBindRun');
    await page.waitForFunction(() => !document.getElementById('sqlBindModal'), null, { timeout: 10000 });
    await page.waitForSelector('#sqlGrid', { timeout: 10000 });
    T.check('after entering binds, the statement runs and the grid shows rows', (await page.$$('#sqlGrid [role="row"], #sqlGrid tr')).length > 0 || /row/.test(await env.text('#sqlTab-result')));
    T.check('the bound statement reached the database', D.calls.filter((c) => c.op === 'execute' && /from emp/i.test(c.sql)).length === 1);

    T.section('values are remembered for next time, and a no-bind query runs straight away');
    await page.fill('#sqlEditor', 'select ename, sal from emp where empno = :empno');
    await page.click('#sqlRun');
    await page.waitForSelector('#sqlBindModal', { timeout: 10000 });
    T.check('the previously entered value is pre-filled', (await page.inputValue('#sqlBind-0')) === '7369');
    await page.click('#sqlBindCancel');
    await page.waitForFunction(() => !document.getElementById('sqlBindModal'), null, { timeout: 10000 });
    await page.fill('#sqlEditor', 'select ename from emp');
    await page.click('#sqlRun');
    await page.waitForTimeout(300);
    T.check('a statement with no binds does not open the dialog', !(await page.$('#sqlBindModal')));

    await env.shot('sql-binds.png');
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    await env.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  T.report();
})();
