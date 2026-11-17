/*
 * Change requests, in a browser (Application → Change requests): the list starts empty; + New change request opens one in
 * a tab of its own — its page, kind, priority, customer, who asked and when, the Jira story, the issue, due — saved as
 * CR-0001; "Save & ask the AI" opens Code fix with the AI's proposal for that page (a stand-in AI here), the request's
 * status following it (Proposed); approving applies AND saves it in your workspace's working folder (Fixed, fixed on /
 * by filled in), then What now: Try it opens the page, Undo reverts the saved commit (Undone, the fixed date cleared);
 * History says each step. Back on the list: its row (customer, who, Jira · issue, status), the chips, Find, On hold, delete.
 *
 * Run:  node tests/e2e/change-requests.e2e.js   (after npm run build)
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
const ID = 'shop/customers/customer-billing';
const BILL = 'webApps/shop/flows/customers/pages/customer-billing-page';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const opened = [];

(async () => {
  const pg = await E.pagesSandbox({});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-cr-e2e-'));
  // your workspace's working folder: a worktree of the checkout, on buildrite-working (as the set-up wizard makes it)
  const working = path.join(dir, 'BuildRite', 'shop-app-dev-one', 'working');
  git(pg.root, 'worktree', 'add', '-q', '-B', 'buildrite-working', working);
  const ws = { folder: working, label: 'Shop App ▸ Dev_One', branch: 'buildrite-working', key: 'acme-dev1/shop-app_100010', name: 'Shop App', ws: 'Dev_One' };
  const pagesStore = require('../../desktop/lib/pages').open({ root: pg.root, rootFn: () => working, rootLabel: () => 'Shop App ▸ Dev_One (dev-one)', spaceFn: () => 'acme-dev1_shop-app_100010',
    baseFn: () => ({ ref: 'origin/pages/test', label: 'VB Studio (pages/test)' }),
    run: async (app, url) => { opened.push('run ' + app + ' ' + url); return { ok: true, url: 'http://127.0.0.1:4100' + url, from: 'workspace', built: true }; } });
  const lines = fs.readFileSync(path.join(working, BILL + '.html'), 'utf8').replace(/\r\n/g, '\n').split('\n');
  const asked = [];
  const fixStore = require('../../desktop/lib/codeFix').open({ root: pg.root, file: path.join(dir, 'code-fixes.json'), workFn: () => ws, pickFolder: async () => pg.root, ai: {
    settings: () => ({ active: 'x', catalog: [{ id: 'x', label: 'Stand-in AI' }] }),
    chat: async (b) => { asked.push(b); return { ok: true, provider: 'Stand-in AI', model: 'test', text: ['## Summary', 'Overdue invoices first.', '## How it works today', 'Newest first.', '## What changes', 'One comment line.',
      '## The change', '- `' + BILL + '.html` — a comment line', '## After the change', 'Overdue first.', '## Risks', 'None known', '## How to test', '1. Open My Billing.', '## Questions', 'None', '',
      'FILE: ' + BILL + '.html', '<<<<<<< SEARCH', lines.slice(1, 3).join('\n'), '=======', lines.slice(1, 3).join('\n') + '\n  Overdue invoices first (change request).', '>>>>>>> REPLACE'].join('\n') }; } } });
  const crStore = require('../../desktop/lib/changeRequests').open({ dir: path.join(dir, 'change-requests') });
  const vbsStore = { work: () => ({ copies: [], current: null }), state: () => ({}) };
  const env = await E.start({ port: 19874, pagesStore, fixStore, crStore, vbsStore });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const tabTitle = () => page.$eval('.nx-tab--on .nx-tab-title', (e) => e.textContent.trim()).catch(() => '');
  const setField = async (sel, value) => { await page.fill(sel, value); await page.press(sel, 'Tab'); await page.waitForTimeout(120); };
  const waitText = (sel, re, ms) => page.waitForFunction(([s, r]) => new RegExp(r).test(((document.querySelector(s) || {}).textContent || '').replace(/\s+/g, ' ')), [sel, re.source], { timeout: ms || 20000 }).catch(() => {});
  try {
    T.section('the list, in the menu (Application)');
    await env.open('/?open=change-requests');
    await page.waitForSelector('#crList', { timeout: 30000 });
    T.check('Change requests under Application; nothing yet, said so; + New change request', !!(await page.$('[data-nav-id="change-requests"]')) && /No change request yet/.test(await text(page, '#crNone')) && !!(await page.$('#crNewBtn')), await text(page, '#crList'));

    T.section('a new one: its header, saved as CR-0001');
    const before = await page.$$eval('.nx-tab', (t) => t.length);
    await page.click('#crNewBtn');
    await page.waitForFunction((n) => document.querySelectorAll('.nx-tab').length > n, before, { timeout: 15000 });
    await page.waitForSelector('#crPageSel', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(300);
    T.check('in a tab of its own: New change request, New, today as requested on; Code fix and History tabs', /^New change request$/.test(await tabTitle()) && (await text(page, '#crCode')) === 'New' && (await text(page, '#crStatus')) === 'New'
      && (await val(page, '#crOn')) === new Date().toISOString().slice(0, 10) && /Code fix/.test(await text(page, '#crTabFix')) && /History \(0\)/.test(await text(page, '#crTabHist')), await tabTitle());
    T.check('…asking the AI waits for a page and a request', await page.isDisabled('#crAskFromReq'));
    await page.selectOption('#crPageSel', ID);
    await setField('#crTitleIn', 'Overdue invoices first');
    await page.selectOption('#crKind', 'enhance');
    await page.selectOption('#crPriority', 'high');
    await setField('#crCustomer', 'Northwind Traders');
    await setField('#crBy', 'sam.lee');
    await setField('#crJira', 'ABC-123');
    await setField('#crIssue', 'ISS-12');
    await setField('#crDue', '2026-12-01');
    await setField('#crRequest', 'Show overdue invoices first on My Billing.');
    await page.click('#crSave');
    await waitText('#crCode', /CR-0001/);
    await page.waitForTimeout(300);
    const saved = crStore.list('').requests[0] || {};
    T.check('Save: CR-0001, its tab named after it; kept with every field', (await text(page, '#crCode')) === 'CR-0001' && /^CR-0001 · Overdue invoices first$/.test(await tabTitle())
      && saved.page === ID && saved.kind === 'enhance' && saved.priority === 'high' && saved.customer === 'Northwind Traders' && saved.requestedBy === 'sam.lee' && saved.jira === 'ABC-123' && saved.issue === 'ISS-12' && saved.dueOn === '2026-12-01'
      && /Show overdue invoices first/.test(saved.request), JSON.stringify(saved).slice(0, 400));

    T.section('Code fix: the AI\'s proposal for its page');
    await page.click('#crAskFromReq');
    await page.waitForSelector('#crProposal', { state: 'visible', timeout: 30000 });
    await page.waitForTimeout(400);
    T.check('asked: Code fix opened on the proposal (Proposed), the request\'s status follows it', (await page.getAttribute('#crTabFix', 'aria-selected')) === 'true' && /Proposed — waiting for your approval/.test(await text(page, '#crFixStatus'))
      && (await text(page, '#crStatus')) === 'Proposed' && /Code fix \(1\)/.test(await text(page, '#crTabFix')), [await text(page, '#crFixStatus'), await text(page, '#crStatus')].join(' | '));
    T.check('…the AI was asked the request for that page, as an enhancement, with its Jira story and issue', asked.length === 1 && /REQUEST \(Enhance\):\nShow overdue invoices first on My Billing\./.test(asked[0].user) && /PAGE My Billing/.test(asked[0].user), (asked[0] && asked[0].user || '').slice(0, 300));
    T.check('…the exact change shown (+1 line), the checks folded; approving says it is saved in the working folder', /The change · 1 file · \+1 −0/.test(await text(page, '#crDiffHead')) && /Overdue invoices first \(change request\)/.test(await text(page, '#crDiff .nx-fx-l--add'))
      && /^✓ Checks on the proposed code/.test(await text(page, '#crChecks summary')) && /checks them and saves them there/.test(await text(page, '#crApproveText')), await text(page, '#crApproveText'));
    T.check('…written in the code beside the change: its Jira story and issue (the proposal\'s refs)', /Jira story ABC-123/.test(JSON.stringify(fixStore.get(crStore.list('').requests[0].fixId).fix.refs || {})) || /ABC-123/.test(JSON.stringify(fixStore.get(crStore.list('').requests[0].fixId).fix)));
    await env.shot('change-request-proposal.png');

    T.section('approved: applied and saved in the working folder, then what now');
    let q = '';
    page.once('dialog', (d) => { q = d.message(); d.accept(); });
    await page.click('#crApply');
    await page.waitForSelector('#crApplied', { state: 'visible', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(400);
    T.check('the question names the working folder and says it is saved there', q.indexOf(path.resolve(working)) !== -1 && /and save it there\?/.test(q), q);
    T.check('applied and saved (a commit on buildrite-working, on this PC only): Saved; the request Fixed, fixed on today by you', /^Saved$/.test(await text(page, '#crFixStatus')) && /^✓ Applied and saved .* — commit [0-9a-f]+ · on this PC only/.test(await text(page, '#crAppliedText'))
      && (await text(page, '#crStatus')) === 'Fixed' && (await val(page, '#crFixedOn')) === new Date().toISOString().slice(0, 10) && (await val(page, '#crFixedBy')) === 'priya.raman'
      && git(working, 'log', '-1', '--format=%s').indexOf('Code fix: My Billing') === 0 && /Overdue invoices first \(change request\)/.test(fs.readFileSync(path.join(working, BILL + '.html'), 'utf8')),
    [await text(page, '#crAppliedText'), await text(page, '#crStatus'), await val(page, '#crFixedOn'), await val(page, '#crFixedBy')].join(' | '));
    T.check('…What now?: 1 Try it, 2 Send it on (its project: Apply to main → Push), or Undo — nothing else to press', /What now\?[\s\S]*1\s*Try it[\s\S]*2\s*Send it on[\s\S]*Apply to main, then Push[\s\S]*or\s*Take it out/.test(await text(page, '#crNext'))
      && !!(await page.$('#crTry')) && !!(await page.$('#crOpenProject')) && !!(await page.$('#crUndo')) && !(await page.$('#crPush')) && !(await page.$('#crSaveAnyway')), await text(page, '#crNext'));
    await env.shot('change-request-saved.png');
    await page.click('#crTry');
    await waitText('#crFixResult', /Opened in a window/);
    T.check('Try it: the page opened from your working copy', opened.some((x) => x === 'run shop /vp/shell/customers/customer-billing') && /Opened in a window: .*your workspace's working folder/.test(await text(page, '#crFixResult')), opened.join(' | ') + ' / ' + await text(page, '#crFixResult'));

    T.section('Undo: its saved commit reverted');
    page.once('dialog', (d) => { q = d.message(); d.accept(); });
    await page.click('#crUndo');
    await waitText('#crFixStatus', /Undone/);
    await page.waitForTimeout(400);
    T.check('undone: the commit reverted (a new commit), the line gone; the request Undone, its fixed date cleared', /Its commit \([0-9a-f]+\) is reverted/.test(q) && /^Undone$/.test(await text(page, '#crFixStatus')) && (await text(page, '#crStatus')) === 'Undone'
      && /^Revert "Code fix: My Billing/.test(git(working, 'log', '-1', '--format=%s')) && !/change request\)/.test(fs.readFileSync(path.join(working, BILL + '.html'), 'utf8')) && (await val(page, '#crFixedOn')) === '',
    [q, await text(page, '#crStatus'), await val(page, '#crFixedOn')].join(' | '));
    T.check('…Approve and apply offered again, and Ask again from the request', !!(await page.$('#crApply')) && !!(await page.$('#crNewAttempt')));

    T.section('History: what happened to it');
    await page.click('#crTabHist');
    await page.waitForSelector('#crHist li', { timeout: 10000 });
    const hist = await text(page, '#crHist');
    T.check('newest first: undone, saved in working, asked the AI, created — each by whom', /undone[\s\S]*saved in working[\s\S]*asked the AI[\s\S]*created/.test(hist) && /by priya\.raman/.test(hist), hist.slice(0, 400));
    await page.selectOption('#crState', 'hold');
    await page.click('#crSave');
    await waitText('#crStatus', /On hold/);
    T.check('state On hold (set by hand) wins over its Code Fix', (await text(page, '#crStatus')) === 'On hold');

    T.section('back to the list');
    await page.click('.nx-tab--on .nx-tab-close').catch(() => {});
    await page.waitForSelector('#crGrid', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(400);
    const row = await text(page, '#crGrid .nx-sc-grow:not(.nx-sc-grow--head)');
    T.check('its row: CR-0001, title, kind · priority, page, customer, who asked, Jira · issue, On hold, due', /^CR-0001 Overdue invoices first Enhance · High priority My Billing ?shop\/customers\/customer-billing Northwind Traders sam\.lee · \d+ \w+ 2026 ABC-123 · ISS-12 On hold due 1 Dec 2026/.test(row), row);
    T.check('…the chips count it under On hold', /On hold 1/.test(await text(page, '#crChips')) && /All 1/.test(await text(page, '#crChips')));
    await page.click('#crChips button:has-text("Fixed")');
    await page.waitForTimeout(200);
    const noFixed = await text(page, '#crNoMatch');
    await page.click('#crChips button:has-text("All")');
    await page.fill('#crListQ', 'northwind');
    await page.waitForTimeout(200);
    T.check('Fixed: none matches; Find "northwind": its row', /No change request matches/.test(noFixed) && /1 shown · 1 in all/.test(await text(page, '#crListCount')), noFixed + ' / ' + await text(page, '#crListCount'));
    await env.shot('change-requests-list.png');
    page.once('dialog', (d) => d.accept());
    await page.click('#crGrid .nx-sc-carddel');
    await page.waitForSelector('#crNone', { timeout: 10000 }).catch(() => {});
    T.check('deleted from the list: none left', /No change request yet/.test(await text(page, '#crNone')) && crStore.list('').requests.length === 0);
    T.check('no page errors', errs().length === 0, errs().join(' | '));
  } catch (e) {
    T.check('no exception: ' + (e && e.message), false);
  } finally {
    await env.close();
    try { git(pg.root, 'worktree', 'remove', '--force', working); } catch (e) { /* tmp */ }
    pg.restore();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  }
  T.report();
})();
