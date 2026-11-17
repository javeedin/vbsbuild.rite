'use strict';
/*
 * Build.Rite's Follow-ups page (flows/insights followups-page; store desktop/lib/followups.js), in a real
 * browser: a saved follow-up shows in the list; opening it shows its header (title, scope, recipients, when) and the
 * email that was composed (greeting + the stories table with the Key linking to Jira); Copy for email puts it on the
 * clipboard; Delete removes it. The store is the real DuckDB store (a JSON file where DuckDB cannot load).
 * Needs `npm run build`. Run: node tests/e2e/next-followups.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
const texts = (page, sel) => page.$$eval(sel, (els) => els.filter((e) => e.getClientRects().length).map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
const settle = (page, ms) => page.waitForTimeout(ms);

const SAMPLE = {
  kind: 'sprint', title: 'Follow-up — Sprint 2026-07', subtitle: 'active · 2026-07-01 – 2026-07-31',
  subject: 'Please close these stories', to: 'priya@company.com; omar@company.com', message: 'Dear Priya and Omar,\n\nAs we discussed, kindly close the following stories.',
  signoff: 'Thanks,', sprintName: '2026-07', source: '', author: 'sam.lee',
  lines: [
    { storyKey: 'ABC-12', summary: 'Order Master List View - Section 7.2', status: 'DEVELOPMENT', assignee: 'Priya Raman', sprint: '2026-07', due: '2026-10-07', overdue: true, customer: 'acme', url: 'https://example.atlassian.net/browse/ABC-12' },
    { storyKey: 'ABC-31', summary: 'Rate Schedule Report - Section 7.15.9', status: 'DEVELOPMENT', assignee: 'Priya Raman', sprint: '2026-07', due: '2026-07-31', overdue: true, customer: 'globex', url: 'https://example.atlassian.net/browse/ABC-31' },
  ],
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'followups-'));
  const fuStore = await require('../../desktop/lib/followups').open({ file: path.join(dir, 'followups.duckdb') });
  await fuStore.save(SAMPLE);

  const env = await E.start({ port: 19772, followupsStore: fuStore });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('the Follow-ups page lists what was saved');
    await env.open('/?open=followups');
    await page.waitForSelector('#flTitle', { timeout: 30000 });
    await settle(page, 600);
    T.eq('its menu item, under Insights', await text(page, '.nx-nav-item--on'), 'Follow-ups');
    T.eq('one saved follow-up, counted in the header', await text(page, '#flCount'), '1 saved follow-up');
    const rows = await texts(page, '.nx-fl-list .nx-fl-row');
    T.check('the row shows the title, the scope and the item count', rows.length === 1
      && rows[0].includes('Follow-up — Sprint 2026-07') && rows[0].includes('Sprint 2026-07') && rows[0].includes('2 stories'), rows.join(' | '));

    T.section('opening it shows the header and the composed email');
    await page.click('.nx-fl-list .nx-fl-row');
    await page.waitForSelector('#flDetailTitle', { timeout: 10000 });
    await settle(page, 400);
    T.eq('the detail title', await text(page, '#flDetailTitle'), 'Follow-up — Sprint 2026-07');
    const facts = await text(page, '.nx-fl-facts');
    T.check('the header facts: recipients, scope, items', facts.includes('priya@company.com') && facts.includes('Sprint 2026-07') && facts.includes('2 stories'), facts);
    const srcdoc = await page.getAttribute('#flPreview', 'srcdoc');
    T.check('the preview is the composed email: greeting, the table with the linked Key, the Sprint column',
      srcdoc.includes('Dear Priya and Omar,') && srcdoc.includes('<table') && srcdoc.includes('href="https://example.atlassian.net/browse/ABC-12"')
      && srcdoc.includes('>Sprint</th>'), srcdoc.slice(0, 160));
    await env.shot('followups.png');

    T.section('Copy for email puts the whole email on the clipboard');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: env.nextUrl });
    await page.click('#flCopy');
    await settle(page, 300);
    const clip = await page.evaluate(async () => {
      try { const items = await navigator.clipboard.read(); for (const it of items) { if (it.types.includes('text/html')) return await (await it.getType('text/html')).text(); } } catch (e) { /* ignore */ }
      return '';
    });
    T.check('the clipboard HTML has the message and the table', clip.includes('Dear Priya and Omar,') && clip.includes('<table') && clip.includes('ABC-31'), clip.slice(0, 120));

    T.section('Delete removes it');
    await page.click('#flDelete');
    await page.waitForSelector('#flEmpty', { timeout: 10000 });
    T.check('the list is empty and the store has none', (await page.$$('.nx-fl-list .nx-fl-row')).length === 0 && (await fuStore.list()).followups.length === 0);


    T.section('Messages: the messages the follow-up dialog offers — built in, changed, yours, hidden, in your order');
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await page.click('#flTabMessages');
    await page.waitForSelector('#fmList .nx-fm-row', { timeout: 10000 });
    await settle(page, 300);
    let labels = await texts(page, '#fmList .nx-fm-rowlabel');
    T.check('a Messages tab: every built-in message, the new testing ones among them, Write my own last',
      labels.length >= 12 && ['Provide test scripts', 'Provide proof of testing', 'Need more info', 'Any blockers?', 'UAT sign-off'].every((l) => labels.indexOf(l) !== -1)
      && labels[labels.length - 1] === 'Write my own' && /^\d+ in the dialog$/.test(await text(page, '#fmCount')), labels.join(' | '));
    await page.click('#fmList .nx-fm-row[data-key="proof"] .nx-fm-rowmain');
    await page.waitForSelector('#fmTitle', { timeout: 5000 });
    await settle(page, 200);
    let pv = await page.getAttribute('#fmPreview', 'srcdoc');
    T.check('picked: its name, subject and message to change, marked built in; a preview with two sample stories (greeting, message, table)',
      (await text(page, '#fmTitle')) === 'Provide proof of testing' && /Built in/.test(await text(page, '#fmEdit .nx-card-head'))
      && (await page.$eval('#fmSubject', (e) => e.value)) === 'Proof of testing needed before we close these stories'
      && pv.includes('Dear Priya and Sam,') && pv.includes('attach proof of testing') && pv.includes('ABC-101'), pv.slice(0, 120));
    // a built-in changed: kept as your version
    await page.fill('#fmSubject', 'Proof of testing for {count}');
    await settle(page, 200);
    T.check('a word in the subject is filled in the preview ({count} → 2 stories); Save lights up', (await text(page, '#fmPrevSubject')) === 'Proof of testing for 2 stories' && !(await page.$eval('#fmSave', (b) => b.disabled)));
    await page.click('#fmSave');
    await page.waitForFunction(() => /changed/.test((document.querySelector('#fmList .nx-fm-row[data-key="proof"] .nx-fm-tags') || {}).textContent || ''), null, { timeout: 10000 });
    let st = await fuStore.messages();
    T.check('Save: kept on this PC as your version of it (marked changed, what it said before shown)', st.messages.some((m) => m.key === 'proof' && m.subject === 'Proof of testing for {count}')
      && /As it came: Proof of testing needed before we close these stories/.test(await text(page, '#fmOrig')), JSON.stringify(st.messages));
    await page.click('#fmReset');
    await page.waitForFunction(() => /built in/.test((document.querySelector('#fmList .nx-fm-row[data-key="proof"] .nx-fm-tags') || {}).textContent || ''), null, { timeout: 10000 });
    await settle(page, 250);
    T.check('Put back as it came: your version gone, the built-in text back', !(await fuStore.messages()).messages.some((m) => m.key === 'proof')
      && (await page.$eval('#fmSubject', (e) => e.value)) === 'Proof of testing needed before we close these stories', JSON.stringify([(await fuStore.messages()).messages.map((m) => m.key), await page.$eval('#fmSubject', (e) => e.value)]));
    // a message of your own
    await page.click('#fmNew');
    await page.waitForSelector('#fmLabel', { timeout: 5000 });
    await page.fill('#fmLabel', 'Ask for a demo');
    await page.fill('#fmSubject', 'Demo of {count}');
    await page.fill('#fmBody', 'Please show a short demo of the stories below by {due}. Thank you, ');
    await page.click('#fmWords .nx-fm-word[data-key="{names}"]');
    await settle(page, 200);
    T.check('+ New message: a word button puts {names} where the cursor is', /Thank you, \{names\}$/.test(await page.$eval('#fmBody', (e) => e.value)), await page.$eval('#fmBody', (e) => e.value));
    await page.click('#fmSave');
    await page.waitForFunction(() => Array.prototype.some.call(document.querySelectorAll('#fmList .nx-fm-rowlabel'), (x) => x.textContent.trim() === 'Ask for a demo'), null, { timeout: 10000 });
    st = await fuStore.messages();
    const mine = st.messages.filter((m) => m.label === 'Ask for a demo')[0];
    labels = await texts(page, '#fmList .nx-fm-rowlabel');
    pv = await page.getAttribute('#fmPreview', 'srcdoc');
    T.check('saved: yours, kept on this PC, offered just before Write my own; its preview fills the words (2026-11-28, Priya and Sam)', !!mine && /^my-ask-for-a-demo-/.test(mine.key)
      && labels[labels.length - 2] === 'Ask for a demo' && /yours/.test(await text(page, '#fmList .nx-fm-row--on .nx-fm-tags')) && pv.includes('by 2026-11-28. Thank you, Priya and Sam'), labels.slice(-3).join(' | '));
    // move it up, hide a built-in
    await page.click('#fmList .nx-fm-row--on .nx-fm-up');
    await page.waitForFunction((k) => { const r = Array.prototype.map.call(document.querySelectorAll('#fmList .nx-fm-row'), (x) => x.getAttribute('data-key')); return r.indexOf(k) === r.length - 3; }, mine.key, { timeout: 10000 });
    st = await fuStore.messages();
    T.check('↑ moves it earlier in the dialog (the order kept)', st.order.indexOf(mine.key) === st.order.length - 2 && st.order[st.order.length - 1] === 'uat', st.order.join());
    await page.click('#fmList .nx-fm-row[data-key="sprint"] .nx-fm-rowmain');
    await page.waitForSelector('#fmShow', { timeout: 5000 });
    await page.uncheck('#fmShow');
    await page.click('#fmSave');
    await page.waitForFunction(() => /hidden/.test((document.querySelector('#fmList .nx-fm-row[data-key="sprint"] .nx-fm-tags') || {}).textContent || ''), null, { timeout: 10000 });
    T.check('"Offer it in the follow-up dialog" off: hidden (shown struck out, counted)', /1 hidden/.test(await text(page, '#fmCount')) && (await fuStore.messages()).messages.some((m) => m.key === 'sprint' && m.hidden));
    await env.shot('followups-messages.png');
    // export, import
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#fmExport')]);
    const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    T.check('Export: a file with yours, your changes (the hidden one) and the order — to give the team', dl.suggestedFilename() === 'followup-messages.json' && exported.kind === 'buildrite-followup-messages'
      && exported.messages.some((m) => m.label === 'Ask for a demo') && exported.messages.some((m) => m.key === 'sprint' && m.hidden) && exported.order.indexOf(mine.key) !== -1, JSON.stringify(exported).slice(0, 200));
    exported.messages.push({ key: 'team-retest', label: 'Please retest', subject: 'Retest needed', body: 'The fixes are in: please retest the stories below.' });
    await page.setInputFiles('#fmImportFile', { name: 'team.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
    await page.waitForFunction(() => Array.prototype.some.call(document.querySelectorAll('#fmList .nx-fm-rowlabel'), (x) => x.textContent.trim() === 'Please retest'), null, { timeout: 10000 });
    T.check('Import (a file from a teammate): its messages added (same keys replaced), kept on this PC', (await fuStore.messages()).messages.some((m) => m.key === 'team-retest')
      && (await fuStore.messages()).messages.filter((m) => m.label === 'Ask for a demo').length === 1);
    // remove yours
    await page.click('#fmList .nx-fm-row[data-key="team-retest"] .nx-fm-rowmain');
    await page.waitForSelector('#fmRemove', { timeout: 5000 });
    await page.click('#fmRemove');
    await page.waitForFunction(() => !document.querySelector('#fmList .nx-fm-row[data-key="team-retest"]'), null, { timeout: 10000 });
    T.check('Remove (yours only): gone from the list and this PC; a built-in has no Remove', !(await fuStore.messages()).messages.some((m) => m.key === 'team-retest') && !(await page.$('#fmRemove')));
    await page.click('#fmList .nx-fm-row[data-key="close"] .nx-fm-rowmain');
    await page.waitForSelector('#fmTitle', { timeout: 5000 });
    T.check('…a built-in: no Remove, Duplicate to start one of your own from it', !(await page.$('#fmRemove')) && !!(await page.$('#fmDup')));

    T.check('no console errors', errs().length === 0, errs().join(' | '));
  } finally {
    if (fuStore.close) await fuStore.close();
    await env.close();
  }
  T.report();
})().catch((e) => { console.error(e); process.exitCode = 1; });
