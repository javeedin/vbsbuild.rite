/*
 * A new page, in a browser (Change requests, kind New page): made like an existing page of your workspace's app and
 * linked into its menu the way its other pages are. The form learns the app's menu from its code (its groups, the
 * places a page in the menu is registered — its flow's page list, the menu file — and the links from other pages kept
 * apart); the title names the page; asking the AI first asks for a knowledge base (an FDD of the library, its sections
 * functional and technical, your notes); the AI (a stand-in here) is told what to make, like which page, where the
 * app registers a page and the knowledge base; its proposal is checked (files made, every place linked, the menu
 * label); approving writes the page and its links in the working folder and saves them.
 *
 * Run:  node tests/e2e/new-page.e2e.js   (after npm run build)
 */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const val = (page, sel) => page.$eval(sel, (e) => e.value).catch(() => '');
const BILL = 'shop/customers/customer-billing';
const NEW = 'webApps/shop/flows/customers/pages/customer-statements-page';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

(async () => {
  const pg = await E.pagesSandbox({});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-np-e2e-'));
  const working = path.join(dir, 'BuildRite', 'shop-app-dev-one', 'working');
  git(pg.root, 'worktree', 'add', '-q', '-B', 'buildrite-working', working);
  const ws = { folder: working, label: 'Shop App ▸ Dev_One', branch: 'buildrite-working', key: 'acme-dev1/shop-app_100010', name: 'Shop App', ws: 'Dev_One' };
  const pagesStore = require('../../desktop/lib/pages').open({ root: pg.root, rootFn: () => working, rootLabel: () => 'Shop App ▸ Dev_One (dev-one)', spaceFn: () => 'acme-dev1_shop-app_100010',
    baseFn: () => ({ ref: 'origin/pages/test', label: 'VB Studio (pages/test)' }) });
  // the FDD library: one FDD with functional and technical sections
  const fdd = await E.fddSandbox({ git: true });
  await fdd.store.upload({ fileName: 'shop-fdd.md', name: 'Shop FDD', version: '2.1', latest: true,
    base64: Buffer.from(['# 7 Customer statements', 'Customers see their statements.', '## 7.1 Statement list', 'FDD-71: the statements of the last 12 months, newest first; each opens its PDF.',
      '## 7.2 Statement filters', 'Filter by month and by status.', '# 8 Technical design', 'The services.', '## 8.1 Statement service', 'GET /statements?customer={id} returns id, period, amount, status.',
      '# 9 Timesheets', 'Hours.'].join('\n')).toString('base64') });
  // the stand-in AI: the new page's three files, its flow entry and its menu item — against the working folder as it is
  const asked = [];
  const answer = () => {
    const flowJson = fs.readFileSync(path.join(working, 'webApps/shop/flows/customers/customers-flow.json'), 'utf8');
    const appFlow = fs.readFileSync(path.join(working, 'webApps/shop/app-flow.js'), 'utf8');
    const billItem = appFlow.split('\n').filter((l) => /id: 'customer-billing'/.test(l))[0];
    const flowEntry = /"customer-billing": \{\n\s*"path": "pages\/customer-billing-page"\n\s*\}/.exec(flowJson)[0];
    return ['## Summary', 'A new Customer Statements page, like My Billing.', '## How it works today', 'There is no statements page (FDD 7.1 asks for one).', '## What changes', 'A new page under Customers, after My Billing.',
      '## The change', '- three new files; the flow and the menu', '## After the change', 'Customer Statements opens from the menu.', '## Risks', 'None known', '## How to test', '1. Open Customers › Customer Statements.', '## Questions', 'None', '',
      'FILE: ' + NEW + '.html', '<<<<<<< SEARCH', '=======', '<div class="oj-flex">', '  <oj-sp-general-overview-page page-title="Customer Statements">', '    <div slot="main">The statements of the last 12 months.</div>', '  </oj-sp-general-overview-page>', '</div>', '>>>>>>> REPLACE',
      'FILE: ' + NEW + '.js', '<<<<<<< SEARCH', '=======', "define([], () => { 'use strict'; class PageModule {} return PageModule; });", '>>>>>>> REPLACE',
      'FILE: ' + NEW + '.json', '<<<<<<< SEARCH', '=======', '{ "description": "Customer Statements", "variables": {}, "eventListeners": {} }', '>>>>>>> REPLACE',
      'FILE: webApps/shop/flows/customers/customers-flow.json', '<<<<<<< SEARCH', flowEntry, '=======', flowEntry + ',\n    "customer-statements": {\n      "path": "pages/customer-statements-page"\n    }', '>>>>>>> REPLACE',
      'FILE: webApps/shop/app-flow.js', '<<<<<<< SEARCH', billItem, '=======', billItem + ",\n      { id: 'customer-statements', label: 'Customer Statements', flow: 'customers', page: 'customer-statements' }", '>>>>>>> REPLACE'].join('\n');
  };
  const fixStore = require('../../desktop/lib/codeFix').open({ root: pg.root, file: path.join(dir, 'code-fixes.json'), workFn: () => ws, pickFolder: async () => pg.root, ai: {
    settings: () => ({ active: 'x', catalog: [{ id: 'x', label: 'Stand-in AI' }] }),
    chat: async (b) => { asked.push(b); return { ok: true, provider: 'Stand-in AI', model: 'test', text: answer() }; } } });
  const crStore = require('../../desktop/lib/changeRequests').open({ dir: path.join(dir, 'change-requests') });
  const vbsStore = { work: () => ({ copies: [], current: null }), state: () => ({}) };
  const env = await E.start({ port: 19876, pagesStore, fixStore, crStore, vbsStore, fddStore: fdd.store });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const setField = async (sel, value) => { await page.fill(sel, value); await page.press(sel, 'Tab'); await page.waitForTimeout(150); };
  const waitText = (sel, re, ms) => page.waitForFunction(([s, r]) => new RegExp(r).test(((document.querySelector(s) || {}).textContent || '').replace(/\s+/g, ' ')), [sel, re.source], { timeout: ms || 20000 }).catch(() => {});
  try {
    T.section('a new change request of the kind New page: made like a page, the app\'s menu learnt');
    await env.open('/?open=change-requests');
    await page.waitForSelector('#crList', { timeout: 30000 });
    await page.click('#crNewBtn');
    await page.waitForSelector('#crPageSel', { state: 'visible', timeout: 15000 });
    await page.selectOption('#crKind', 'page');
    await page.waitForSelector('#crNewPage', { state: 'visible', timeout: 10000 });
    await page.selectOption('#crPageSel', BILL);
    await waitText('#crNpLinks', /menu is in/);
    T.check('the header asks which page it is like; the New page card appears', /Make it like \(a page of the app\)/.test(await text(page, '#crHeader')) && /Made like My Billing/.test(await text(page, '#crNewPage')), await text(page, '#crNewPage'));
    T.check('…the menu learnt from the app\'s code; a page in the menu is registered in its flow\'s page list and the menu file; a link from another page kept apart', /Your app's menu is in webApps\/shop\/app-flow\.js: 2 groups, 4 items/.test(await text(page, '#crNpLinks'))
      && /customers-flow\.json its flow's list of pages[\s\S]*app-flow\.js the menu \(an item\)/.test(await text(page, '#crNpLinks .nx-cr-places')) && /Also linked from 1 other page/.test(await text(page, '#crNpLinks')), await text(page, '#crNpLinks'));
    await setField('#crNpTitle', 'Customer Statements');
    T.check('the title names it (customer-statements), its files said, its flow the page\'s', (await val(page, '#crNpName')) === 'customer-statements' && (await val(page, '#crNpFlow')) === 'customers'
      && /flows\/customers\/pages\/customer-statements-page\.html, \.js, \.json/.test(await text(page, '#crNpFiles')), await val(page, '#crNpName') + ' / ' + await text(page, '#crNpFiles'));
    await page.selectOption('#crNpGroup', 'customers');
    await page.waitForSelector('#crNpLabel', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(400);
    T.check('in the menu under Customers: its label (the title), placed after the last item (My Billing)', (await val(page, '#crNpLabel')) === 'Customer Statements' && (await val(page, '#crNpAfter')) === 'customer-billing'
      && /as My Billing is, under Customers/.test(await text(page, '#crNpLinks')), await val(page, '#crNpAfter') + ' / ' + await text(page, '#crNpLinks p'));
    await setField('#crRequest', 'A page listing the customer\'s statements of the last 12 months, newest first, each opening its PDF.');
    await setField('#crBy', 'sam.lee');
    await page.click('#crSave');
    await waitText('#crCode', /CR-0001/);
    const saved = crStore.list('').requests[0] || {};
    T.check('saved: CR-0001, kind New page, its new page kept (title, name, flow, group, place)', saved.kind === 'page' && saved.newPage && saved.newPage.title === 'Customer Statements' && saved.newPage.name === 'customer-statements' && saved.newPage.flow === 'customers' && saved.newPage.group === 'customers'
      && saved.targetPage === 'shop/customers/customer-statements' && saved.targetLabel === 'Customer Statements (new)', JSON.stringify(saved.newPage));
    await env.shot('new-page-form.png');

    T.section('asking the AI first asks for a knowledge base');
    await page.click('#crAskFromReq');
    await page.waitForSelector('#crKbAsk', { state: 'visible', timeout: 10000 });
    T.check('the Knowledge base tab opens, asking what to build it from (FDD sections, functional and technical, notes) — the AI not asked yet', (await page.getAttribute('#crTabKb', 'aria-selected')) === 'true' && /Before the AI makes the page: what should it build it from\?/.test(await text(page, '#crKbAsk')) && asked.length === 0);
    await page.selectOption('#crKbFdd', { label: /Shop FDD v2\.1/ }).catch(async () => { const id = await page.$eval('#crKbFdd option:nth-child(2)', (o) => o.value); await page.selectOption('#crKbFdd', id); });
    await page.waitForSelector('#crKbList .nx-cr-kbrow', { timeout: 10000 });
    T.check('the FDD\'s sections, technical ones tagged; filters All / Functional / Technical', /All 6 Functional 4 Technical 2/.test(await text(page, '.nx-cr-kbbar')) && /8\.1 Statement service Technical/.test(await text(page, '#crKbList')), await text(page, '.nx-cr-kbbar'));
    await page.click('.nx-cr-kbbar button:has-text("Technical")');
    await page.waitForTimeout(200);
    const techRows = await page.$$eval('#crKbList .nx-cr-kbrow', (a) => a.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    await page.click('#crKbList .nx-cr-kbrow:has-text("8.1")');
    await page.click('.nx-cr-kbbar button:has-text("All")');
    await page.click('#crKbSuggest');
    await page.waitForTimeout(300);
    const on = await page.$$eval('#crKbList .nx-cr-kbrow--on', (a) => a.map((x) => x.textContent.replace(/\s+/g, ' ').trim().split(' ')[1]));
    T.check('Technical: only those; 8.1 ticked by hand; "Tick the sections that match the request" ticks the statement list', techRows.length === 2 && techRows.every((r) => /Technical/.test(r)) && on.indexOf('8.1') !== -1 && on.indexOf('7.1') !== -1 && on.indexOf('9') === -1, techRows.join(' | ') + ' / ' + on.join());
    await setField('#crKbNotes', 'Use the PDF viewer My Billing uses.');
    T.check('…the preview: what the AI will read (the sections, then the notes); the tab marked ✓', /What the AI will read \(\d+ characters\)/.test(await text(page, '#crKbPreview summary')) && /Knowledge base ✓/.test(await text(page, '#crTabKb'))
      && /FDD Shop FDD v2\.1 — 7\.1 Statement list[\s\S]*8\.1 Statement service[\s\S]*Notes and rules from the person/.test(await page.$eval('#crKbPreview pre', (p) => p.textContent)));
    await env.shot('new-page-knowledge.png');

    T.section('the AI makes the page: told what, like which page, where the app registers it, and the knowledge base');
    await page.click('#crKbAsk2');
    await page.waitForSelector('#crProposal', { state: 'visible', timeout: 30000 });
    await page.waitForTimeout(400);
    const q = (asked[0] && asked[0].user) || '';
    T.check('asked once: a NEW page Customer Statements, its 3 files, like My Billing, under Customers after My Billing; the registration files; the knowledge base', asked.length === 1 && /REQUEST \(New page\)/.test(q) && /NEW PAGE — this request is for a NEW page/.test(q)
      && q.indexOf(NEW + '.html') !== -1 && /under "Customers", labelled "Customer Statements", right after "My Billing"/.test(q) && /REGISTRATION FILES/.test(q)
      && /KNOWLEDGE BASE[\s\S]*FDD-71: the statements of the last 12 months[\s\S]*GET \/statements[\s\S]*Use the PDF viewer/.test(q), q.slice(0, 300));
    const checks = await text(page, '#crChecks');
    T.check('proposed; its checks ✓ — the new page\'s files made, linked in both places, "Customer Statements" in the menu', /Proposed/.test(await text(page, '#crFixStatus')) && /the new page's files are made/.test(checks)
      && /the new page is linked in every place the app registers a page \(2 files, like My Billing\)/.test(checks) && /it is in the menu, under Customers, as "Customer Statements"/.test(checks) && !(await page.$('#crChecks .nx-fx-check--bad')), checks.slice(0, 400));
    T.check('…the change: 5 files (3 new)', /The change · 5 files/.test(await text(page, '#crDiffHead')) && (await page.$$('#crDiff .nx-fx-new')).length === 3, await text(page, '#crDiffHead'));
    await env.shot('new-page-proposal.png');

    T.section('approved: the page and its links written in the working folder, saved');
    page.once('dialog', (d) => d.accept());
    await page.click('#crApply');
    await page.waitForSelector('#crApplied', { state: 'visible', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(400);
    T.check('saved: the three files, the flow entry and the menu item in the working folder; Fixed', /^Saved$/.test(await text(page, '#crFixStatus')) && (await text(page, '#crStatus')) === 'Fixed' && fs.existsSync(path.join(working, NEW + '.html'))
      && /"customer-statements"/.test(fs.readFileSync(path.join(working, 'webApps/shop/flows/customers/customers-flow.json'), 'utf8')) && /id: 'customer-statements', label: 'Customer Statements'/.test(fs.readFileSync(path.join(working, 'webApps/shop/app-flow.js'), 'utf8'))
      && git(working, 'log', '-1', '--format=%s').indexOf('Code fix: My Billing') === 0, await text(page, '#crStatus'));
    T.check('…History says it was asked for the page', (crStore.get(saved.id).request.events || []).some((e) => e.what === 'asked the AI for the page'));
    T.check('no page errors', errs().length === 0, errs().join(' | '));
  } catch (e) {
    T.check('no exception: ' + (e && e.message), false);
  } finally {
    await env.close();
    try { git(pg.root, 'worktree', 'remove', '--force', working); } catch (e) { /* tmp */ }
    pg.restore();
    fdd.restore();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  }
  T.report();
})();
