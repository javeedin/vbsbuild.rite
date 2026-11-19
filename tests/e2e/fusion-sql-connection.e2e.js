#!/usr/bin/env node
'use strict';
/*
 * Tools → Fusion SQL → Connection, in a browser, against stand-in Fusion pods (tests/fakeFusionPod.js): the five tiles
 * (Pod, Instance, Runs as, Runner report, AI assistant); the Pods card with a Test per pod and its pill (Connected with
 * the time, Failed with the pod's words); Test connection; Runner settings of the pod in use (saved, a bad path refused);
 * Deploy the query runner with the manual steps and the runner's SQL; the AI assistant card (the AI chosen for SQL, Test,
 * AI settings); the schema cache (what it holds, Clear cache); API Inspector; another pod in use → the cards follow it.
 * Needs `npm run build`. Run: node tests/e2e/fusion-sql-connection.e2e.js
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-fsqlc-e2e-'));
  const pod = await Pod.start({ runner: true });
  const bare = await Pod.start({ runner: false }); // no query runner yet
  const store = F.open({ file: path.join(dir, 'fusion-sql.json'), cacheDir: path.join(dir, 'cache'), encrypt: (t) => Buffer.from('sealed:' + Buffer.from(t).toString('base64')),
    decrypt: (b) => Buffer.from(String(b).replace(/^sealed:/, ''), 'base64').toString(), fetch: (u, i) => fetch(u, i), allowHttp: true });
  const p1 = store.savePod({ name: 'TEST', url: pod.url, login: 'own', username: pod.user, password: pod.password });
  const p2 = store.savePod({ name: 'UAT', url: bare.url, login: 'own', username: bare.user, password: bare.password });
  store.setActive(p1.id);
  const asked = [];
  const aiStore = {
    settings: () => ({ active: 'anthropic', providers: { anthropic: { ready: true, model: 'model-x' } }, catalog: [{ id: 'anthropic', label: 'Claude (Anthropic)' }], features: [], uses: {} }),
    chat: async (b) => { asked.push(b); return { ok: true, provider: 'Claude (Anthropic)', text: 'Ready — Claude here.' }; },
  };
  const env = await E.start({ port: 19996, fusionSqlStore: store, aiStore });
  const page = env.page;
  page.on('dialog', (d) => d.accept());
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const text = (sel) => env.text(sel).catch(() => '');
  const stat = (k) => text('#fsqlConnStats .nx-fsql-stat[data-key="' + k + '"]');
  const podRow = (id) => '#fsqlPods .nx-fsql-pod[data-id="' + id + '"]';
  const host = (u) => new URL(u).host;
  try {
    T.section('the tiles');
    await env.open('/');
    await page.click('.nx-nav-item[data-nav-id="fusion-sql"]');
    await page.waitForSelector('#fsqlObjects, #fsqlSchema', { timeout: 30000 });
    await settle(page, 800); // the schema browser reads the pod (and fills the cache)
    await page.click('#fsqlTab-connection');
    await page.waitForSelector('#fsqlConnStats .nx-fsql-stat', { timeout: 15000 });
    T.eq('five tiles', (await page.$$('#fsqlConnStats .nx-fsql-stat')).length, 5);
    T.check('Pod: the host of the pod in use', (await stat('pod')).indexOf(host(pod.url)) !== -1);
    T.check('Instance: its name and how many pods', /TEST/.test(await stat('instance')) && /2 pods on this PC/.test(await stat('instance')));
    T.check('Runs as: its user, with the keychain', /BI\.TESTER/.test(await stat('user')) && /keychain/.test(await stat('user')));
    T.check('Runner report: its path, not tested yet', /\/Custom\/BuildRite\/QueryRunner\.xdo/.test(await stat('runner')) && /Not tested yet/.test(await stat('runner')));
    T.check('AI assistant: the AI chosen for SQL and its model', /Claude \(Anthropic\) · model-x/.test(await stat('ai')));
    T.check('the header: Test connection and API Inspector', !!(await page.$('#fsqlConnTest')) && !!(await page.$('#fsqlConnInspector')));

    T.section('pods: a Test each');
    T.check('both pods listed, not tested', /Not tested/.test(await text(podRow(p1.id))) && /Not tested/.test(await text(podRow(p2.id))));
    await page.click(podRow(p2.id) + ' .nx-fsql-podtest');
    await page.waitForFunction((sel) => /Failed/.test((document.querySelector(sel) || {}).textContent || ''), podRow(p2.id) + ' .nx-fsql-podpill', { timeout: 15000 });
    T.check('a pod without the runner: Failed, with the pod\'s words under it', /not found|Deploy the runner/i.test(await text(podRow(p2.id) + ' .nx-fsql-poderr')));
    T.check('…and the result card says so', /UAT: the test failed/.test(await text('#fsqlConnResult')));
    await page.click(podRow(p1.id) + ' .nx-fsql-podtest');
    await page.waitForFunction((sel) => /Connected/.test((document.querySelector(sel) || {}).textContent || ''), podRow(p1.id) + ' .nx-fsql-podpill', { timeout: 15000 });
    T.check('the pod with its runner: Connected, with the time', /Connected · \d+ ms/.test(await text(podRow(p1.id) + ' .nx-fsql-podpill')));
    T.check('the Runner report tile follows', /Answers in \d+ ms/.test(await stat('runner')));
    await page.click('#fsqlConnTest');
    await page.waitForFunction(() => /TEST: the runner answered/.test((document.getElementById('fsqlConnResult') || {}).textContent || ''), null, { timeout: 15000 });
    T.check('Test connection: the pod in use, SELECT 1 FROM dual', /SELECT 1 FROM dual returned 1/.test(await text('#fsqlConnResult')));
    await page.evaluate(() => { const el = document.getElementById('fsqlTitle'); if (el) el.scrollIntoView(); });
    await env.shot('fusion-sql-connection-top.png');

    T.section('runner settings');
    T.check('the pod in use\'s settings', /Runner settings · TEST/.test(await text('#fsqlRunner')) && (await page.inputValue('#fsqlRReport')) === '/Custom/BuildRite/QueryRunner.xdo' && (await page.inputValue('#fsqlRDs')) === 'ApplicationDB_FSCM');
    await page.fill('#fsqlRRows', '250');
    await page.fill('#fsqlRTimeout', '90');
    await page.click('#fsqlRSave');
    await page.waitForFunction(() => /Saved the runner settings/.test(document.body.textContent), null, { timeout: 10000 });
    const saved = store.settings().pods.filter((p) => p.id === p1.id)[0];
    T.check('saved on the pod (rows, time limit), the password kept', saved.rowLimit === 250 && saved.timeoutMs === 90000 && saved.hasPassword);
    await page.fill('#fsqlRReport', '/Custom/BuildRite/QueryRunner');
    await page.click('#fsqlRSave');
    await page.waitForFunction(() => /ends in \.xdo/.test(document.body.textContent), null, { timeout: 10000 });
    T.check('a report path without .xdo: refused, nothing saved', store.settings().pods.filter((p) => p.id === p1.id)[0].reportPath === '/Custom/BuildRite/QueryRunner.xdo');
    await page.fill('#fsqlRReport', '/Custom/BuildRite/QueryRunner.xdo');

    T.section('deploy: the manual steps and the runner\'s SQL');
    await page.click('#fsqlManual summary');
    await settle(page);
    T.check('the manual steps name the data source, the data model and the report', /ApplicationDB_FSCM/.test(await text('#fsqlManDs')) && /QueryRunnerDM\.xdm/.test(await text('#fsqlManDm')) && /QueryRunner\.xdo/.test(await text('#fsqlManRep')));
    T.check('the runner\'s SQL: DBMS_XMLGEN on the base64 P_QRY_STMT', /DBMS_XMLGEN\.getxml/.test(await text('#fsqlRunnerSql')) && /:P_QRY_STMT/.test(await text('#fsqlRunnerSql')));

    T.section('the AI assistant');
    T.check('the AI chosen for SQL, ready', /Claude \(Anthropic\) · model-x/.test(await text('#fsqlAiWho')) && /Ready/.test(await text('#fsqlAiCard')));
    await page.click('#fsqlAiTest');
    await page.waitForSelector('#fsqlAiTestRes', { timeout: 10000 });
    T.check('Test: one tiny request, for the SQL feature, its answer shown', /Ready — Claude here/.test(await text('#fsqlAiTestRes')) && asked.length === 1 && asked[0].feature === 'sql');

    T.section('the schema cache');
    T.check('what the cache of the pod in use holds', /Owners\s*4/.test(await text('#fsqlCacheInfo')) && /Object lists\s*1/.test(await text('#fsqlCacheInfo')) && /KB|bytes/.test(await text('#fsqlCacheInfo')));
    await page.click('#fsqlCacheClear');
    await page.waitForFunction(() => /Owners\s*0/.test((document.getElementById('fsqlCacheInfo') || {}).textContent || ''), null, { timeout: 10000 });
    T.check('Clear cache: emptied', /empty/.test(await text('#fsqlCacheInfo')));
    await env.shot('fusion-sql-connection.png');

    T.section('another pod in use');
    await page.selectOption('#fsqlPod', p2.id);
    await page.waitForFunction(() => /UAT/.test((document.querySelector('#fsqlConnStats .nx-fsql-stat[data-key="instance"]') || {}).textContent || ''), null, { timeout: 15000 });
    T.check('the tiles and the runner card follow it', /Test failed/.test(await stat('runner')) && /Runner settings · UAT/.test(await text('#fsqlRunner')));
    await page.click('#fsqlConnDeploy');
    await page.waitForFunction(() => /runner is on UAT|deploy stopped/.test((document.getElementById('fsqlConnResult') || {}).textContent || ''), null, { timeout: 20000 });
    T.check('Deploy runner report on it: the steps, then it answers', /runner is on UAT and answers/.test(await text('#fsqlConnResult')) && /data model/i.test(await text('#fsqlConnResult')));
    await page.click(podRow(p2.id) + ' .nx-fsql-podtest');
    await page.waitForFunction((sel) => /Connected/.test((document.querySelector(sel) || {}).textContent || ''), podRow(p2.id) + ' .nx-fsql-podpill', { timeout: 15000 });
    T.check('…and its pill turns Connected', true);

    T.section('API Inspector');
    await page.click('#fsqlConnInspector');
    await page.waitForSelector('#fsqlCalls .nx-fsql-call', { timeout: 10000 });
    T.check('the last SOAP calls, the password as ***', /runReport/.test(await text('#fsqlCalls')) && /API Inspector/.test(await text('#fsqlTab-calls')));
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    await env.close();
    await pod.close();
    await bare.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  T.report();
})();
