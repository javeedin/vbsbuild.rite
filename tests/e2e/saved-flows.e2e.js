#!/usr/bin/env node
'use strict';
/*
 * Saved flows, in a browser: Integrations → Page flows in plain English (sentences, what sets each action off in words);
 * Edit & save as flow → the name and details asked (a name required) → the saved flow opens in a tab of its own: its
 * diagram (plain English or technical), step by step; Edit steps — an action reworded, a step reworded, a system (lane)
 * added and a step added by hand in it, a note — Save as version 2 with what changed; comments on a step, resolved; its
 * versions (view, restore, discard); Check against the app (a call removed → found → added back); SVG and a real PDF;
 * Save as copy; then Integrations → Saved flows: both listed, Check all against the app, search, status chips, remove.
 * Needs `npm run build`. Run: node tests/e2e/saved-flows.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const settle = (page, ms) => page.waitForTimeout(ms || 400);
const vis = (page, sel) => page.locator(sel + ':visible').first();
const text = async (page, sel) => ((await vis(page, sel).innerText({ timeout: 5000 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim();
const count = (page, sel) => page.locator(sel + ':visible').count();
const setField = async (page, sel, value) => { const el = vis(page, sel); await el.fill(value); await el.press('Tab'); await settle(page, 300); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-sf-e2e-'));
  const pg = await E.pagesSandbox();
  const flowStore = require('../../desktop/lib/savedFlows').open({ dir: path.join(dir, 'saved-flows') });
  const { chromium } = require('playwright');
  const printer = await chromium.launch();
  const htmlToPdf = async (html) => { const p = await printer.newPage(); try { await p.setContent(html, { waitUntil: 'load' }); return await p.pdf({ format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true }); } finally { await p.close(); } };
  const env = await E.start({ port: 19986, pagesStore: pg.store, flowStore, htmlToPdf });
  const page = env.page;
  page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('Order intake — copy') : d.accept()));
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const tabTitle = () => page.$eval('.nx-tab--on .nx-tab-title', (e) => e.textContent.trim()).catch(() => '');
  const toTab = async (title) => { await page.locator('.nx-tab .nx-tab-title', { hasText: title }).first().click(); await settle(page, 600); };
  try {
    T.section('plain English on Page flows');
    await env.open('/?open=integrations');
    await page.waitForSelector('#intKpis', { timeout: 30000 });
    await page.click('#intTabPages');
    await page.waitForSelector('#intPgSel', { timeout: 10000 });
    await page.selectOption('#intPgSel', 'shop/orders/order-create');
    await settle(page);
    await page.click('#intPlain');
    await settle(page);
    const pd = (await page.getAttribute('#intPgDia', 'srcdoc')) || '';
    T.check('the flow in plain English: sentences ("Reads the customers"), what sets it off in words, no paths or chains', /fill="#1d4f91">Reads</.test(pd) && />the customers</.test(pd) && />When the page opens</.test(pd) && !/\/shop\/v1\/customers</.test(pd) && !/>LoadCustomersChain</.test(pd)
      && /^In plain English/.test(await text(page, '#intPgDiaNote')), pd.slice(0, 120));
    const pl = await page.$$eval('#intPgPlain .nx-int-row:not(.nx-int-row--head)', (l) => l.map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
    T.check('…and step by step, in words: when, what happens, where', pl.length === 3 && /When the page opens Reads the customers from The shop's REST backend/.test(pl[0]) && /Runs the customers report in Oracle BI Publisher \(SOAP\)/.test(pl[1])
      && /When the user clicks "Submit" Creates the orders in The shop's REST backend/.test(pl[2]), JSON.stringify(pl));
    await env.shot('saved-flows-plain.png');

    T.section('Edit & save as flow');
    await page.click('#intPgSaveFlow');
    await page.waitForSelector('#intSaveDlg', { timeout: 5000 });
    T.check('the details asked: the name (the page\'s, to change), purpose, area (its flow), owner, status, Jira story, tags; where it comes from', (await page.inputValue('#intSfName')) === 'New Order flow' && (await page.inputValue('#intSfArea')) === 'orders'
      && /From the page New Order \(shop\/orders\/order-create\) — 3 calls, 2 actions, 2 systems/.test(await text(page, '#intSaveFrom')) && !!(await page.$('#intSfPurpose')) && !!(await page.$('#intSfStatus')) && !!(await page.$('#intSfStory')) && !!(await page.$('#intSfTags')));
    await page.fill('#intSfName', '');
    await page.click('#intSaveGo');
    await settle(page);
    T.check('a name is required', (await text(page, '#intSaveErr')) === 'Give the flow a name.' && !!(await page.$('#intSaveDlg')));
    await page.fill('#intSfName', 'Order intake');
    await setField(page, '#intSfPurpose', 'How a new order is taken: the customer list and their credit, then the order.');
    await setField(page, '#intSfArea', 'Order to cash');
    await setField(page, '#intSfOwner', 'Priya Raman');
    await page.selectOption('#intSfStatus', 'review');
    await setField(page, '#intSfStory', 'ABC-12');
    await setField(page, '#intSfTags', 'orders, intake');
    await env.shot('saved-flows-dialog.png');
    await page.click('#intSaveGo');
    await page.waitForSelector('#sfpTitle', { timeout: 15000 });
    await settle(page, 800);
    T.check('saved: FL-0001 in a tab of its own, in review, version 1, from the page', /^FL-0001 · Order intake$/.test(await tabTitle()) && (await text(page, '#sfpTitle')) === 'Order intake'
      && /^FL-0001 · In review · version 1 · 3 steps, 2 actions, 2 systems · from the page New Order/.test(await text(page, '#sfpSub')), await text(page, '#sfpSub'));
    const st0 = flowStore.get('FL-0001').flow;
    T.check('…kept with its details', st0.purpose.indexOf('customer list') !== -1 && st0.area === 'Order to cash' && st0.owner === 'Priya Raman' && st0.status === 'review' && st0.story === 'ABC-12' && st0.tags.join() === 'orders,intake');

    T.section('the saved flow');
    const fd = (await vis(page, '#sfpDia').getAttribute('srcdoc')) || '';
    T.check('its diagram, in plain English first; its purpose; step by step', />When the page opens</.test(fd) && />Order intake</.test(fd) && /In review · v1/.test(fd) && /customer list and their credit/.test(await text(page, '#sfpPurposeShow')) && (await count(page, '#sfpSteps .nx-int-row:not(.nx-int-row--head)')) === 3);
    await vis(page, '#sfpPlain').click();
    await settle(page);
    T.check('…technical with Plain English off (paths, chains)', /\/shop\/v1\/customers</.test((await vis(page, '#sfpDia').getAttribute('srcdoc')) || '') && />LoadCustomersChain</.test((await vis(page, '#sfpDia').getAttribute('srcdoc')) || ''));
    await vis(page, '#sfpPlain').click();
    await env.shot('saved-flow-diagram.png');

    T.section('edit steps');
    await vis(page, '#sfpTabEdit').click();
    await page.waitForSelector('#sfpActions .nx-sfp-action:visible', { timeout: 5000 });
    T.check('the editor: its systems (lanes), each action with what sets it off (in words, as a placeholder) and its steps', (await count(page, '#sfpLanes .nx-sfp-lane:not(.nx-sfp-lane--new)')) === 2 && (await count(page, '#sfpActions .nx-sfp-action')) === 2
      && (await vis(page, '[data-field="a.a1.title"]').getAttribute('placeholder')) === 'When the page opens' && (await vis(page, '[data-field="s.s1.text"]').getAttribute('placeholder')) === 'Reads the customers from The shop\'s REST backend');
    await setField(page, '[data-field="a.a1.title"]', 'When a clerk opens a new order');
    await setField(page, '[data-field="s.s1.text"]', 'Looks up the customer list');
    await setField(page, '[data-field="s.s2.note"]', 'Credit status comes from this report');
    T.check('unsaved changes said; Save says the next version', (await text(page, '#sfpDirty')) === 'Unsaved changes' && /Save as version 2/.test(await text(page, '#sfpSave')));
    await setField(page, '#sfpNewLane', 'E-mail');
    await vis(page, '#sfpNewLaneKind').selectOption('email');
    await vis(page, '#sfpAddLane').click();
    await settle(page);
    T.check('a system added (E-mail); the box emptied for the next one', (await count(page, '#sfpLanes .nx-sfp-lane:not(.nx-sfp-lane--new)')) === 3 && (await vis(page, '#sfpNewLane').inputValue()) === '');
    await vis(page, '.nx-sfp-action[data-id="a2"] [data-act="addStep"]').click();
    await settle(page);
    await vis(page, '[data-field="s.s4.system"]').selectOption('e-mail');
    await setField(page, '[data-field="s.s4.text"]', 'E-mails the order confirmation to the customer');
    T.check('a step added by hand in it', (await count(page, '.nx-sfp-action[data-id="a2"] .nx-sfp-step')) === 2 && /Added by hand/.test(await text(page, '.nx-sfp-step[data-id="s4"]')));
    await env.shot('saved-flow-edit.png');
    await setField(page, '#sfpNote', 'Business wording and the e-mail step');
    await vis(page, '#sfpSave').click();
    await page.waitForFunction(() => /version 2/.test((document.querySelector('#sfpSub') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    const st1 = flowStore.get('FL-0001').flow;
    T.check('Save: version 2, what changed kept, the version before kept', st1.version === 2 && st1.versions.length === 1 && /Business wording and the e-mail step/.test(st1.history[st1.history.length - 1].note) && !(await page.$('#sfpDirty:visible'))
      && st1.actions[1].steps[1].manual && st1.actions[1].steps[1].system === 'e-mail' && st1.actions[0].title === 'When a clerk opens a new order', JSON.stringify(st1.history));
    await vis(page, '#sfpTabFlow').click();
    await settle(page);
    const fd2 = (await vis(page, '#sfpDia').getAttribute('srcdoc')) || '';
    T.check('the diagram follows: the reworded action and step, the E-mail lane and its step, the note', />When a clerk opens a new</.test(fd2) && />Looks up the customer list</.test(fd2) && />E-mail</.test(fd2) && />E-mails the order</.test(fd2) && /Note: Credit status comes from this/.test(fd2));
    await env.shot('saved-flow-v2.png');

    T.section('comments');
    await vis(page, '#sfpTabComments').click();
    await page.waitForSelector('#sfpCText:visible', { timeout: 5000 });
    await vis(page, '#sfpCText').fill('Who gets the confirmation when the customer has no e-mail?');
    await vis(page, '#sfpCStep').selectOption('s4');
    await vis(page, '#sfpAddComment').click();
    await page.waitForSelector('#sfpCList .nx-sfp-cm:visible', { timeout: 5000 });
    const cm = await text(page, '#sfpCList .nx-sfp-cm');
    T.check('…the comment box emptied', (await vis(page, '#sfpCText').inputValue()) === '');
    T.check('a comment on a step: who, when, which step (its words), kept at once (no new version)', /On step 2\.2 — E-mails the order confirmation to the customer/.test(cm) && /Who gets the confirmation/.test(cm) && /Comments \(1\)/.test(await text(page, '#sfpTabComments'))
      && flowStore.get('FL-0001').flow.comments.length === 1 && flowStore.get('FL-0001').flow.version === 2, cm);
    await vis(page, '#sfpCList [data-act="resolve"]').click();
    await settle(page);
    T.check('…resolved: hidden, shown with "show resolved"', (await count(page, '#sfpCList .nx-sfp-cm')) === 0 && /0 open · 1 resolved/.test(await text(page, '#sfpCommentCount')));
    await vis(page, '#sfpShowResolved').click();
    await settle(page);
    T.check('…resolved by whom', /Resolved/.test(await text(page, '#sfpCList .nx-sfp-cm')));

    T.section('history');
    await vis(page, '#sfpTabHistory').click();
    await page.waitForSelector('#sfpVersions:visible', { timeout: 5000 });
    T.check('its versions: v2 (current, what changed) and v1', (await count(page, '#sfpVersions .nx-int-row:not(.nx-int-row--head)')) === 2 && /v2 current/.test(await text(page, '#sfpVersions .nx-int-row[data-v="2"]')) && /Business wording/.test(await text(page, '#sfpVersions .nx-int-row[data-v="2"]')));
    await vis(page, '#sfpVersions .nx-int-row[data-v="1"] [data-act="viewVersion"]').click();
    await page.waitForSelector('#sfpVDia:visible', { timeout: 5000 });
    T.check('…v1 shown as it was (before the e-mail step)', !/>E-mail</.test((await vis(page, '#sfpVDia').getAttribute('srcdoc')) || '') && /v1/.test((await vis(page, '#sfpVDia').getAttribute('srcdoc')) || ''));
    await vis(page, '#sfpVersions .nx-int-row[data-v="1"] [data-act="restoreVersion"]').click();
    await settle(page);
    T.check('…restored into the editor (unsaved), its note filled; Discard puts version 2 back', (await text(page, '#sfpDirty')) === 'Unsaved changes' && (await vis(page, '#sfpNote').inputValue()) === 'Back to version 1' && (await count(page, '.nx-sfp-step[data-id="s4"]')) === 0);
    await vis(page, '#sfpRevert').click();
    await settle(page);
    T.check('…discarded', !(await page.$('#sfpDirty:visible')) && (await count(page, '.nx-sfp-step[data-id="s4"]')) === 1);

    T.section('check against the app');
    await vis(page, '#sfpCheckBtn').click();
    await page.waitForSelector('#sfpCheckResult:visible', { timeout: 15000 });
    await settle(page, 600);
    T.check('matches the app (the step added by hand is not the app\'s)', /^Matches the app: all 3 of its app steps are still made/.test(await text(page, '#sfpCheckResult')), await text(page, '#sfpCheckResult'));
    await vis(page, '#sfpTabEdit').click();
    await settle(page);
    await vis(page, '.nx-sfp-step[data-id="s3"] [data-act="removeStep"]').click();
    await settle(page);
    await vis(page, '#sfpTabCheck').click();
    await vis(page, '#sfpCheckAgain').click();
    await settle(page, 800);
    T.check('a call removed: found — the page makes a call the flow does not have', /1 new call the flow does not have/.test(await text(page, '#sfpCheckResult')) && /POST \/shop\/v1\/orders/.test(await text(page, '#sfpAdded')), await text(page, '#sfpCheckResult'));
    await vis(page, '#sfpAddFromApp').click();
    await settle(page);
    T.check('…added back: matches again (Save to keep it)', /^Matches the app/.test(await text(page, '#sfpCheckResult')) && (await text(page, '#sfpDirty')) === 'Unsaved changes');
    await vis(page, '#sfpSave').click();
    await page.waitForFunction(() => /version 3/.test((document.querySelector('#sfpSub') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('…saved as version 3', flowStore.get('FL-0001').flow.version === 3);

    T.section('exports, copy');
    const [svg] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), vis(page, '#sfpSvg').click()]);
    T.check('SVG: the flow as a file', /^flow-fl-0001-order-intake\.svg$/.test(svg.suggestedFilename()), svg.suggestedFilename());
    const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), vis(page, '#sfpPdf').click()]);
    const pdfFile = path.join(dir, 'f.pdf');
    await pdf.saveAs(pdfFile);
    T.check('PDF: a real PDF — its details, the diagram, its steps', pdf.suggestedFilename() === 'flow-fl-0001-order-intake.pdf' && fs.readFileSync(pdfFile).slice(0, 5).toString() === '%PDF-' && fs.statSync(pdfFile).size > 10000);
    await vis(page, '#sfpCopy').click();
    await page.waitForFunction(() => /FL-0002/.test((document.querySelector('.nx-tab--on .nx-tab-title') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('Save as copy: FL-0002 under the name asked, in its own tab, a draft', /^FL-0002 · Order intake — copy$/.test(await tabTitle()) && flowStore.get('FL-0002').flow.copiedFrom === 'FL-0001' && flowStore.get('FL-0002').flow.status === 'draft', await tabTitle());

    T.section('Integrations → Saved flows');
    await toTab('Integrations');
    await page.click('#intTabSaved');
    await page.waitForSelector('#intFlowsGrid', { timeout: 10000 });
    await settle(page, 600);
    const rows = await page.$$eval('#intFlowsGrid .nx-int-row:not(.nx-int-row--head)', (l) => l.map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
    T.check('both listed, the newest first: name, purpose, from, systems, steps, status, version, owner', rows.length === 2 && /^FL-0002 Order intake — copy/.test(rows[0]) && /^FL-0001 Order intake How a new order is taken/.test(rows[1]) && /New Order/.test(rows[1])
      && /E-mail/.test(rows[1]) && /4 steps · 2 actions/.test(rows[1]) && /In review v3/.test(rows[1]) && /Priya Raman/.test(rows[1]) && /Saved flows \(2\)/.test(await text(page, '#intTabSaved')), JSON.stringify(rows));
    await page.click('#intFlowsCheck');
    await settle(page);
    T.check('Check all against the app: each says it matches', (await page.$$eval('#intFlowsGrid .nx-int-ck--ok', (l) => l.length)) === 2);
    await page.click('#intFlowChips [data-key="review"]');
    await settle(page);
    T.check('a status: In review — FL-0001', (await count(page, '#intFlowsGrid .nx-int-row:not(.nx-int-row--head)')) === 1 && /FL-0001/.test(await text(page, '#intFlowsGrid .nx-int-row:not(.nx-int-row--head)')));
    await page.click('#intFlowChips [data-key="all"]');
    await page.fill('#intFlowsQ', 'copy');
    await settle(page);
    T.check('find: copy — FL-0002', (await count(page, '#intFlowsGrid .nx-int-row:not(.nx-int-row--head)')) === 1);
    await page.fill('#intFlowsQ', '');
    await settle(page);
    await env.shot('saved-flows-list.png');
    await page.click('#intFlowsGrid .nx-int-row[data-id="FL-0002"] [data-act="flowDelete"]');
    await settle(page, 800);
    T.check('removed (asked first): one left, its tab closed', (await count(page, '#intFlowsGrid .nx-int-row:not(.nx-int-row--head)')) === 1 && !flowStore.get('FL-0002').ok && !(await page.$$eval('.nx-tab .nx-tab-title', (l) => l.some((e) => /FL-0002/.test(e.textContent)))));
    await page.click('#intFlowsGrid .nx-int-row[data-id="FL-0001"] [data-act="flowOpen"]');
    await settle(page, 800);
    T.check('Open: its tab', /^FL-0001 · Order intake$/.test(await tabTitle()));
    T.check('no errors in the page', errs().length === 0, errs().join(' | '));
  } catch (e) {
    T.check('no exception: ' + (e && e.message), false);
  } finally {
    await env.close();
    await printer.close();
    pg.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  T.report();
})();
