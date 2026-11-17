#!/usr/bin/env node
'use strict';
/**
 * The top bar's Microsoft 365 button and its panel (pages/shell-page m365Chain; desktop/lib/graph.js through
 * /__minutes/graph/*), in a browser, against a stand-in for Microsoft 365 whose state the test changes:
 *   - connected: a green dot, "Connected as …", a test email, the company directory switch, Check now
 *   - a stored sign-in Microsoft no longer renews: Check now shows it expired (amber), Connect again signs in again
 *   - no app set up: the Tenant ID and App (client) ID asked for, saved, then the sign-in
 *   - Disconnect (asked first)
 * Needs npm run build. Run: node tests/e2e/m365.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');

(async () => {
  // Microsoft 365, as desktop/lib/graph.js answers — the test moves it between states
  const g = { configured: true, signedIn: true, expired: false, account: 'sam@example.com', tenantId: 't-1', clientId: 'c-1', directory: false, lastError: '' };
  const calls = [];
  const graph = {
    status: () => Object.assign({ pending: false, userCode: '', verificationUri: '', error: '' }, g),
    check: async () => { calls.push('check'); if (g.renewRefused) { g.signedIn = false; g.expired = true; g.lastError = 'AADSTS700082: the refresh token has expired due to inactivity.'; } return Object.assign({ reachable: true }, graph.status()); },
    saveConfig: (b) => { calls.push('config ' + JSON.stringify(b)); Object.keys(b || {}).forEach((k) => { g[k] = b[k]; }); g.configured = !!(g.tenantId && g.clientId); return graph.status(); },
    signInInteractive: async () => { calls.push('signin ' + g.tenantId + '/' + g.clientId); g.signedIn = true; g.expired = false; g.renewRefused = false; g.lastError = ''; g.account = 'sam@example.com'; return { ok: true, status: graph.status() }; },
    beginSignIn: async () => ({ ok: true, userCode: 'ABCD-EFGH', verificationUri: 'https://login.example.com/device' }),
    signOut: () => { calls.push('signout'); g.signedIn = false; g.expired = false; g.account = ''; return graph.status(); },
    sendMail: async (b) => { calls.push('send ' + b.to); return { ok: true }; },
    people: async () => ({ ok: true, contacts: [], sources: [] }),
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-m365-'));
  const minutesStore = await require('../../desktop/lib/minutes').open({ file: path.join(dir, 'minutes.duckdb'), graph });
  const env = await E.start({ port: 19790, minutesStore });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const open = async () => { if (!(await page.$('#nxM365Panel'))) await page.click('#nxM365'); await page.waitForSelector('#nxM365Panel', { timeout: 10000 }); await page.waitForTimeout(400); };
  const btnClass = () => page.getAttribute('#nxM365', 'class');
  try {
    T.section('connected: in the top bar, green, its panel');
    await env.open('/');
    await page.waitForSelector('#nxM365', { timeout: 30000 });
    await page.waitForFunction(() => /nx-m365btn--on/.test((document.getElementById('nxM365') || {}).className || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('a 365 button in the top bar, before the Jira bell: connected (green), its account on hover', /nx-m365btn--on/.test(await btnClass())
      && /connected as sam@example\.com/.test(await page.getAttribute('#nxM365', 'title'))
      && (await page.evaluate(() => { const a = document.getElementById('nxM365'); const b = document.getElementById('nxJiraBell'); return !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)); })), await btnClass());
    await open();
    T.check('its panel: Connected as the account, what it is used for, a test email, Check now, the company directory (off), Disconnect',
      /Connected as sam@example\.com/.test(await text(page, '#nxM365State')) && /recipient suggestions and Send via Microsoft 365/.test(await text(page, '#nxM365Panel'))
      && !!(await page.$('#nxM365Test')) && !!(await page.$('#nxM365Check')) && !(await page.isChecked('#nxM365Dir')) && !!(await page.$('#nxM365Out')) && calls.indexOf('check') !== -1, await text(page, '#nxM365Panel'));
    await env.shot('m365-panel.png');
    await page.click('#nxM365Test');
    await page.waitForTimeout(500);
    T.check('Send a test email to me: sent to the account', calls.some((c) => c === 'send sam@example.com'), calls.join(' | '));
    await page.check('#nxM365Dir');
    await page.waitForTimeout(400);
    T.check('Search the whole company: saved (directory on), asked for at the next sign-in', calls.some((c) => c === 'config {"directory":true}') && g.directory === true, calls.join(' | '));

    T.section('a sign-in Microsoft no longer renews: expired, connect again');
    g.renewRefused = true;
    await page.click('#nxM365Check');
    await page.waitForFunction(() => /expired/.test((document.getElementById('nxM365State') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('Check now asks Microsoft: the sign-in expired — said with Microsoft\'s reason, the button amber', /Your sign-in has expired/.test(await text(page, '#nxM365State'))
      && /AADSTS700082/.test(await text(page, '#nxM365Expired')) && /nx-m365btn--expired/.test(await btnClass()) && /Connect again/.test(await text(page, '#nxM365Connect')), await text(page, '#nxM365Panel'));
    await env.shot('m365-expired.png');
    await page.click('#nxM365Connect');
    await page.waitForFunction(() => /Connected as/.test((document.getElementById('nxM365State') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('Connect again: signed in again (the app as set up), green', calls.some((c) => c === 'signin t-1/c-1') && /Connected as sam@example\.com/.test(await text(page, '#nxM365State')) && /nx-m365btn--on/.test(await btnClass()));

    T.section('Disconnect, and no app set up yet');
    await page.click('#nxM365Out');
    await page.waitForFunction(() => /Not connected/.test((document.getElementById('nxM365State') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('Disconnect (asked first): not connected, grey, Connect offered', calls.indexOf('signout') !== -1 && /nx-m365btn--off/.test(await btnClass()) && /Connect Microsoft 365/.test(await text(page, '#nxM365Connect')));
    g.tenantId = ''; g.clientId = ''; g.configured = false;
    await page.click('#nxM365Panel [data-act="close"]');
    await page.waitForTimeout(300);
    await open();
    T.check('no app set up: "Not set up yet", the Tenant ID and App (client) ID asked for', /Not set up yet/.test(await text(page, '#nxM365State')) && !!(await page.$('#nxM365Tenant')) && !!(await page.$('#nxM365Client')));
    await page.click('#nxM365Connect');
    await page.waitForTimeout(400);
    T.check('…Connect without them: asked for, nothing sent to Microsoft', !calls.some((c) => /^signin \//.test(c)) && /Tenant ID/.test(await page.evaluate(() => document.body.textContent)));
    await page.fill('#nxM365Tenant', 'tenant-123');
    await page.fill('#nxM365Client', 'client-456');
    await page.click('#nxM365Connect');
    await page.waitForFunction(() => /Connected as/.test((document.getElementById('nxM365State') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('…filled in: saved, then the sign-in with them; connected, the fields put away', calls.some((c) => /^config .*"tenantId":"tenant-123".*"clientId":"client-456"/.test(c)) && calls.some((c) => c === 'signin tenant-123/client-456')
      && /Connected as/.test(await text(page, '#nxM365State')) && !(await page.$('#nxM365Tenant')), calls.join(' | '));
    T.check('…"Change the app" shows the fields again', await (async () => { await page.click('#nxM365Change'); await page.waitForTimeout(300); return !!(await page.$('#nxM365Tenant')) && (await page.inputValue('#nxM365Tenant')) === 'tenant-123'; })());

    T.check('no page errors', errs().length === 0, errs().slice(0, 3).join(' | '));
  } catch (e) {
    T.check('ran through', false, e.message);
    await env.shot('m365-fail.png').catch(() => {});
  } finally {
    await env.close();
    if (minutesStore.close) await minutesStore.close();
  }
  T.report();
})().catch((e) => { console.error(e); process.exitCode = 1; });
