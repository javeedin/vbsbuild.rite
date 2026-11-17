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

    T.section('How it was fixed: the story, the proof, the code in full with the change marked');
    await page.click('#crTabHow');
    await page.waitForSelector('#crCodeFrame', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(500);
    const storyText = await text(page, '#crStory');
    T.check('the story in order: what was asked, how it worked before, what was changed and why, after, how it was tested, where it is now', /1\s*What was asked\s*Show overdue invoices first on My Billing\.[\s\S]*Enhance, asked by sam\.lee for Northwind Traders/.test(storyText)
      && /How it worked before\s*Newest first\.[\s\S]*What was changed, and why\s*Overdue invoices first\.[\s\S]*One comment line\.[\s\S]*After the change[\s\S]*How it was tested[\s\S]*✓ Nothing broke — \d+ of \d+ checks passed[\s\S]*Where the change is now\s*Saved: commit [0-9a-f]+ on buildrite-working/.test(storyText), storyText.slice(0, 700));
    T.check('…the proof: 1 file, +9 lines (the change + its note), checks passed, the commit', /1\s*file changed\s*\+9\s*lines added\s*−0\s*lines taken away\s*\d+\/\d+\s*checks passed — nothing broke[\s\S]*[0-9a-f]{7}\s*commit, on this PC/.test(await text(page, '#crProof')), await text(page, '#crProof'));
    T.check('…every step folded: asked, proposed, approved and applied, tested, saved on approval', /asked[\s\S]*proposed[\s\S]*approved and applied[\s\S]*tested[\s\S]*saved on approval/.test(await page.$eval('#crSteps', (d) => d.textContent)));
    const frame = await page.evaluate(() => { const d = document.getElementById('crCodeFrame').contentDocument; const q = (sel) => Array.from(d.querySelectorAll(sel)).map((e) => e.textContent); return { lines: q('.l').length, add: q('.l.ca'), note: q('.l.bn').length, cur: q('.l.cur').length }; });
    T.check('the file in full (every line), the added lines green — the fix\'s line among them — its change note tinted, the first change outlined', frame.lines > 20 && frame.add.some((t) => /Overdue invoices first \(change request\)/.test(t)) && frame.note >= 6 && frame.cur > 0
      && /customer-billing-page\.html/.test(await text(page, '#crCodeFiles')) && /^Change 1 of \d+$/.test(await text(page, '#crCodeAt')) && /From its commit [0-9a-f]+ on buildrite-working/.test(await text(page, '#crCodeHead')), JSON.stringify(frame).slice(0, 300) + ' / ' + await text(page, '#crCodeAt'));
    await page.click('#crCodeViews button:has-text("As it was")');
    await page.waitForTimeout(400);
    const was = await page.evaluate(() => { const d = document.getElementById('crCodeFrame').contentDocument; return { text: d.body.textContent, ins: d.querySelectorAll('.l.ci, .l.cit').length }; });
    T.check('As it was: the file before the change (no fix line), green marks where lines were put in', !/change request\)/.test(was.text) && was.ins >= 1 && /As it was before the change/.test(await text(page, '#crCodeHead')), JSON.stringify(was).slice(0, 200));
    await page.click('#crCodeViews button:has-text("Only the change")');
    await page.waitForTimeout(300);
    T.check('Only the change: the diff of that file (its note and the fix line, added)', /Build\.Rite change fx[\s\S]*Overdue invoices first \(change request\)/.test(await text(page, '#crCodeDiff')) && (await page.$$('#crCodeDiff .nx-fx-l--add')).length === 9);
    await page.click('#crCodeViews button:has-text("With the change")');
    await env.shot('change-request-how.png');
    await page.click('#crTabFix');
    await page.waitForSelector('#crUndo', { state: 'visible', timeout: 10000 });

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

    T.section('Analytics: page by page, kinds, status, the weeks, what is late');
    const today = new Date();
    const iso = (back) => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const x1 = crStore.save({ page: 'shop/orders/order-create', pageLabel: 'New Order', title: 'Wrong total on save', kind: 'fix', priority: 'urgent', customer: 'Contoso', requestedBy: 'kim.ng', requestedOn: iso(20), dueOn: iso(3), request: 'The total is wrong.' }, 'kim.ng').request;
    const x2 = crStore.save({ page: ID, pageLabel: 'My Billing', title: 'Rename a column', kind: 'change', priority: 'low', customer: 'Northwind Traders', requestedBy: 'sam.lee', request: 'Rename Amount to Total.' }, 'sam.lee').request;
    await page.click('#crViewAn');
    await page.waitForSelector('#craKpis', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(300);
    const kpis = await text(page, '#craKpis');
    T.check('the headline figures: 3 requests on 2 pages, 3 open, 0 fixed, 1 overdue', /^3 ?change requests ?2 pages 3 ?open ?0 in progress · 2 new 0 ?fixed/.test(kpis) && /1 ?overdue ?past their due date/.test(kpis), kpis);
    T.check('…where they are (New 2, On hold 1) and what kind (1 each), each with its count beside its colour', /New 2 67%[\s\S]*On hold 1 33%/.test(await text(page, '#craStatus')) && /Fix a bug 1 0% fixed Enhance 1 0% fixed Change 1 0% fixed/.test(await text(page, '#craKinds')),
      await text(page, '#craStatus') + ' / ' + await text(page, '#craKinds'));
    const rows = await page.$$eval('#craPages .nx-cra-prow:not(.nx-cra-prow--head)', (a) => a.map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
    T.check('page by page: My Billing 2 (1 enhance · 1 change), New Order 1 (1 fix a bug, 1 overdue)', rows.length === 2 && /^My Billing ?shop\/customers\/customer-billing 2 \(0\) 1 enhance · 1 change 2/.test(rows[0]) && /^New Order ?shop\/orders\/order-create 1 \(0\) 1 fix a bug 1 \+0 −0 0 — 1/.test(rows[1]), rows.join(' | '));
    T.check('…the weeks (this week marked), customers, who asks, the late one', (await page.$$('#craWeeks .nx-cra-col')).length === 12 && !!(await page.$('#craWeeks .nx-cra-col--now'))
      && /Northwind Traders ?2[\s\S]*Contoso ?1/.test(await text(page, '#craCustomers')) && /sam\.lee ?2/.test(await text(page, '#craRequesters')) && /Wrong total on save[\s\S]*3 days late/.test(await text(page, '#craLate')), await text(page, '#craLate'));
    await env.shot('change-requests-analytics.png');
    await page.click('#craPages .nx-cra-prow[data-key="shop/orders/order-create"]');
    await page.waitForSelector('#crGrid', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(200);
    T.check('a page clicked: its requests in the list', (await val(page, '#crListQ')) === 'shop/orders/order-create' && /1 shown · 3 in all/.test(await text(page, '#crListCount')), await text(page, '#crListCount'));
    crStore.remove(x1.id); crStore.remove(x2.id);
    await page.fill('#crListQ', '');
    await page.click('#crViewList');
    await page.waitForTimeout(400);
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
