#!/usr/bin/env node
'use strict';
/*
 * Create the functional design, in a browser: a story opened in Analyze with AI (a fake Jira), its analysis (a stand-in
 * AI), then "Create the functional design" under it — the AI asked with the story, its analysis, the FDD's sections and
 * the working folder's pages (the sample app); the document printed to a real PDF (Chromium), saved with the FDD library
 * and pushed to its git (a throwaway repository with a bare origin); listed under the analysis with Preview and Download;
 * written again without pushing, then pushed; then FDD library → Design documents: both versions with story, sprint,
 * version and date, a search, the preview, delete (pushed).
 * Needs `npm run build`. Run: node tests/e2e/design-doc.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const JA = require('../../desktop/lib/jiraAuth');

const T = H.makeAsserter();
const settle = (page, ms) => page.waitForTimeout(ms || 400);

const STORY = { id: '12', key: 'ABC-12', fields: { summary: 'Watch an order from the order list', issuetype: { name: 'Story' }, priority: { name: 'Medium' },
  status: { name: 'DEVELOPMENT', statusCategory: { key: 'indeterminate' } }, assignee: { displayName: 'Priya Raman' }, parent: { key: 'ABC-1', fields: { summary: 'Order Registry' } },
  description: 'A buyer watches an order on the order list and is told when it ships.\n\nAcceptance Criteria: a Watch toggle per row; an email when it ships.\n\nFDD Section: 7.2',
  comment: { comments: [] }, created: '2026-11-01T10:00:00.000-0500', updated: '2026-11-14T10:00:00.000-0500',
  customfield_10020: [{ id: 5, name: '2026-11 A', state: 'active', startDate: '2026-11-02T05:00:00.000Z', endDate: '2026-11-20T05:00:00.000Z' }] } };

function handle(req, res) {
  if (req.path === '/rest/api/2/myself') return res.json({ accountId: '1', displayName: 'Sam Lee' });
  if (/^\/rest\/api\/2\/issue\/[A-Z]+-\d+\/(comment|changelog|worklog)$/.test(req.path)) return res.json({ startAt: 0, maxResults: 50, total: 0, isLast: true, comments: [], values: [], worklogs: [] });
  if (req.path === '/rest/api/2/search/jql') {
    const jql = req.query.get('jql') || '';
    return res.json({ issues: /ABC-12/.test(jql) ? [STORY] : [], isLast: true });
  }
  return undefined;
}

const ANALYSIS = '## Requirement\n- A Watch toggle on the order list.\n## Current situation\n- DEVELOPMENT.\n## What to do next\n- Add the Watch toggle and the shipped email.\n## Risks & open questions\n- Who gets the email?';
const DESIGN = [
  '## 1. Overview', 'A buyer watches an order from the order list [FDD 7.2].',
  '## 2. Functional design (FDD)', '### 2.1 Business requirement', '- Watch an order', '### 2.6 Acceptance criteria', '1. A Watch toggle per row', '2. An email when it ships',
  '## 3. Wireframes', '```wireframe',
  '{"screen": "Order Workbench — watch", "page": "shop/orders/order-list", "sections": [{"title": "Orders", "fields": [{"label": "Find an order", "type": "search"}], "table": {"columns": ["Order", "Status", "Watch"], "rows": 3}}], "actions": ["Save"], "notes": "A Watch toggle on each row"}',
  '```', 'The buyer ticks Watch on a row.',
  '## 4. Technical design (TDD)', '### 4.3 Integration touch points', '| # | System | Endpoint or report | Method | Purpose |', '|---|---|---|---|---|',
  '| 1 | shop | shopApi/getOrders | GET | the orders |', '| 2 | shop | NEW shopApi/postWatch | POST | save a watch |',
  '## 5. Developer reference', '### 5.1 Files to change', '- `webApps/shop/flows/orders/pages/order-list-page.html`: the Watch column',
  '## 6. Assumptions and open questions', '- Who gets the email?'].join('\n');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-design-e2e-'));
  const enc = (t) => Buffer.from('enc:' + Buffer.from(t).toString('base64'));
  const dec = (b) => Buffer.from(String(b).replace(/^enc:/, ''), 'base64').toString();
  const jiraStore = JA.open({ file: path.join(dir, 'jira.json'), encrypt: enc, decrypt: dec });
  jiraStore.save({ site: 'https://example.atlassian.net', project: 'ABC', email: 'sam@example.com', token: 'ATATT-test' });
  // a stand-in AI: the analysis, or the design (asked with the architect's system prompt)
  const asked = [];
  const llmFetch = async (url, init) => {
    const body = JSON.parse(String((init && init.body) || '{}'));
    const sys = ((body.messages || [])[0] || {}).content || '';
    const design = /solution architect/.test(sys);
    asked.push({ design, user: ((body.messages || [])[1] || {}).content || '', max: body.max_completion_tokens || body.max_tokens });
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: design ? DESIGN : ANALYSIS } }] }) };
  };
  const aiStore = await require('../../desktop/lib/aiSql').open({ file: path.join(dir, 'ai.json'), encrypt: enc, decrypt: dec, fetch: llmFetch });
  aiStore.save({ provider: 'openai', key: 'sk-test', model: 'gpt-4o' });
  const analysisStore = require('../../desktop/lib/analyses').open({ file: path.join(dir, 'ai-analyses.json') });
  // the FDD library, a git repository with its own origin; its FDD (the latest)
  const fdd = await E.fddSandbox({ git: true });
  await fdd.store.upload({ fileName: 'shop-fdd.md', name: 'Shop FDD', version: '1.7',
    base64: Buffer.from('# 7 Order registry\nThe registry.\n## 7.2 Order master list\nFDD-72: the order list shows every order; a buyer may watch one.\n# 9 Timesheets\nHours.').toString('base64') });
  fdd.git('add', '-A'); fdd.git('commit', '-q', '-m', 'FDD'); fdd.git('push', '-q');
  // the working folder: the sample app's pages
  const pg = await E.pagesSandbox();
  // a real PDF printer (Chromium), as the desktop app prints with Electron
  const { chromium } = require('playwright');
  const printer = await chromium.launch();
  const htmlToPdf = async (html) => { const p = await printer.newPage(); try { await p.setContent(html, { waitUntil: 'load' }); return await p.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }); } finally { await p.close(); } };
  const env = await E.start({ port: 19980, handle, jiraStore, aiStore, analysisStore, fddStore: fdd.store, pagesStore: pg.store, htmlToPdf });
  const page = env.page;
  page.on('dialog', (d) => d.accept());
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const designsDir = path.join(fdd.root, 'docs', 'fdd', 'designs');
  try {
    T.section('a story, its analysis');
    await env.open('/');
    await page.evaluate(() => new Promise((r) => require(['resources/js/shellBus'], (bus) => { bus.open({ record: 'jira-analysis', params: { key: 'ABC-12' } }); r(); })));
    await page.waitForFunction(() => { const f = document.getElementById('anAnalysis'); return f && /What to do next/.test(f.getAttribute('srcdoc') || ''); }, null, { timeout: 30000 }).catch(() => {});
    T.check('Analyze with AI: the story, its analysis (asked once, saved)', asked.length === 1 && !asked[0].design && /What to do next/.test((await page.getAttribute('#anAnalysis', 'srcdoc')) || '') && !!analysisStore.get('ABC-12').ok);
    await page.waitForSelector('#anDesignBtn', { timeout: 10000 });
    T.check('under it: Create the functional design — what it writes and where it goes; Push to git ticked', (await env.text('#anDesignBtn')) === 'Create the functional design'
      && /FDD · wireframes · TDD · integration touch points · developer reference/.test(await env.text('#anDesign')) && await page.isChecked('#anDesignPush') && !(await page.$('#anDesignList')));

    T.section('Create the functional design');
    await page.click('#anDesignBtn');
    await page.waitForSelector('#anDesignBusy', { timeout: 5000 }).catch(() => {});
    const busy = await env.text('#anDesignBusy').catch(() => '');
    await page.waitForSelector('#anDesignDone', { timeout: 60000 }).catch(() => {});
    T.check('while it works: what it reads (the story, its analysis, the FDD, the working folder\'s pages) and the seconds', /Reading the story, its AI analysis, the FDD and the pages and integrations in your working folder/.test(busy) && /\d+ s so far/.test(busy), busy);
    const done = await env.text('#anDesignDone').catch(() => '');
    T.check('done: ABC-12 v1 saved in the FDD library and pushed to git', /ABC-12 v1 saved in the FDD library — pushed to git/.test(done) && !(await page.$('#anDesignPushNow')), done);
    const ask = asked.filter((a) => a.design)[0] || { user: '' };
    T.check('the AI was given the story, its analysis, the FDD section and the pages\' code (fields, REST calls, chain files), with room to write', /STORY ABC-12: Watch an order/.test(ask.user) && /Add the Watch toggle and the shipped email/.test(ask.user)
      && /FDD-72: the order list shows every order/.test(ask.user) && /### Page shop\/orders\/order-list — Order Workbench/.test(ask.user) && /REST: GET \/shop\/v1\/orders — shopApi\/getOrders/.test(ask.user)
      && /order-list-page-chains\/LoadOrdersChain\.js/.test(ask.user) && ask.max >= 12000, ask.user.slice(0, 300));
    const pdf = fs.existsSync(path.join(designsDir, 'abc-12-design-v1.pdf')) ? fs.readFileSync(path.join(designsDir, 'abc-12-design-v1.pdf')) : Buffer.alloc(0);
    T.check('saved locally: a real PDF (several KB), its HTML and Markdown, in docs/fdd/designs', pdf.slice(0, 5).toString() === '%PDF-' && pdf.length > 5000
      && fs.existsSync(path.join(designsDir, 'abc-12-design-v1.html')) && fs.readFileSync(path.join(designsDir, 'abc-12-design-v1.md'), 'utf8') === DESIGN, String(pdf.length));
    const tree = fdd.gitRemote('ls-tree', '-r', '--name-only', 'fdd/test');
    const log = fdd.gitRemote('log', '-1', '--format=%s', 'fdd/test');
    T.check('…and pushed: the PDF, HTML, Markdown and the list in the FDD library\'s git, "Design: ABC-12 v1 — …"', /docs\/fdd\/designs\/abc-12-design-v1\.pdf/.test(tree) && /abc-12-design-v1\.md/.test(tree)
      && /webApps\/buildrite\/resources\/fdd\/designs\.json/.test(tree) && /^Design: ABC-12 v1 — Watch an order/.test(log), log);
    const listed = JSON.parse(fs.readFileSync(path.join(fdd.root, 'webApps/buildrite/resources/fdd/designs.json'), 'utf8')).docs[0] || {};
    T.check('…listed with the story\'s sprint, epic, status, the FDD read, the pages considered', listed.key === 'ABC-12' && listed.sprint === '2026-11 A' && /ABC-1 Order Registry/.test(listed.epic) && listed.status === 'DEVELOPMENT'
      && listed.fddName === 'Shop FDD · v1.7' && listed.pages.indexOf('shop/orders/order-list') !== -1, JSON.stringify(listed).slice(0, 300));
    const row = await env.text('#anDesignList .nx-an-designrow').catch(() => '');
    T.check('under the analysis: v1 — its date, sprint, PDF size, the FDD; Preview, PDF, MD', /v1/.test(row) && /Sprint 2026-11 A/.test(row) && /PDF \d+ KB/.test(row) && /against Shop FDD · v1\.7/.test(row) && /Preview/.test(row) && /PDF/.test(row) && /MD/.test(row), row);
    await env.shot('design-created.png');

    T.section('preview and download');
    await page.click('#anDesignList .nx-an-designrow[data-id="abc-12-design-v1"] [data-act="preview"]');
    await page.waitForSelector('#anDesignFrame', { timeout: 10000 }).catch(() => {});
    const src = (await page.getAttribute('#anDesignFrame', 'srcdoc')) || '';
    T.check('Preview: the document as it prints — cover, control table (sprint, version, date), contents, the wireframe drawn, the touch points', /<h1>ABC-12 · Watch an order from the order list<\/h1>/.test(src)
      && /<th>Sprint<\/th><td>2026-11 A/.test(src) && /<th>Document version<\/th><td>v1/.test(src) && /<b>Contents<\/b>/.test(src) && /<b>Order Workbench — watch<\/b>/.test(src)
      && /<span class="new">NEW<\/span> shopApi\/postWatch/.test(src) && /ABC-12 · v1/.test(await env.text('#anDesignViewTitle')), src.slice(0, 200));
    T.check('…in a frame where nothing runs', (await page.getAttribute('#anDesignFrame', 'sandbox')) === '');
    await env.shot('design-preview.png');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#anDesignView [data-act="download"][data-kind="pdf"]')]);
    const dlFile = path.join(dir, 'got.pdf');
    await dl.saveAs(dlFile);
    T.check('Download PDF: the file, under its name', dl.suggestedFilename() === 'abc-12-design-v1.pdf' && fs.readFileSync(dlFile).slice(0, 5).toString() === '%PDF-');
    await page.click('#anDesignView .nx-iconbtn[data-act="close"]');
    await page.waitForSelector('#anDesignView', { state: 'detached', timeout: 5000 }).catch(() => {});

    T.section('again, without pushing; then pushed');
    await page.click('#anDesignPush');
    await page.click('#anDesignBtn');
    await page.waitForFunction(() => /v2 saved/.test((document.getElementById('anDesignDone') || {}).textContent || ''), null, { timeout: 60000 }).catch(() => {});
    T.check('v2: saved on this PC, not in git yet — Push to git offered; listed first', /ABC-12 v2 saved in the FDD library — on this PC, not in git yet/.test(await env.text('#anDesignDone'))
      && await page.isVisible('#anDesignPushNow') && (await page.$$eval('#anDesignList .nx-an-designrow', (r) => r.map((x) => x.getAttribute('data-id')))).join() === 'abc-12-design-v2,abc-12-design-v1'
      && !/abc-12-design-v2/.test(fdd.gitRemote('ls-tree', '-r', '--name-only', 'fdd/test')));
    await page.click('#anDesignPushNow');
    await page.waitForFunction(() => /pushed to git/.test((document.getElementById('anDesignDone') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
    T.check('Push to git: pushed', /abc-12-design-v2\.pdf/.test(fdd.gitRemote('ls-tree', '-r', '--name-only', 'fdd/test')) && /pushed to git/.test(await env.text('#anDesignDone')));

    T.section('FDD library → Design documents');
    await page.evaluate(() => new Promise((r) => require(['resources/js/shellBus'], (bus) => { bus.open({ navId: 'fdd-library' }); r(); })));
    await page.waitForSelector('#flibDesignTable', { timeout: 30000 }).catch(() => {});
    const rows = await page.$$eval('#flibDesignTable .nx-flib-designrow', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
    T.check('both versions: story and title, sprint, version (the newest the latest), date, who, the FDD, the PDF size', rows.length === 2 && /ABC-12 Watch an order from the order list/.test(rows[0]) && /2026-11 A/.test(rows[0])
      && /v2 Latest/i.test(rows[0]) && /v1/.test(rows[1]) && !/Latest/i.test(rows[1]) && /\d+ \w{3} \d{4}/.test(rows[0]) && /Shop FDD · v1\.7/.test(rows[0]) && /\d+ KB/.test(rows[0]) && /2 documents · 1 story/.test(await env.text('#flibDesignCount')), rows.join(' || '));
    await page.fill('#flibDesignQ', 'nothing-like-this');
    await page.dispatchEvent('#flibDesignQ', 'input');
    await settle(page);
    const none = (await page.$$('#flibDesignTable .nx-flib-designrow')).length;
    await page.fill('#flibDesignQ', '2026-11 a');
    await page.dispatchEvent('#flibDesignQ', 'input');
    await settle(page);
    T.check('a search: by sprint (or story, title, who)', none === 0 && (await page.$$('#flibDesignTable .nx-flib-designrow')).length === 2);
    await page.click('#flibDesignTable .nx-flib-designrow[data-id="abc-12-design-v2"] [data-act="preview"]');
    await page.waitForSelector('#flibDesignFrame', { timeout: 10000 }).catch(() => {});
    T.check('Preview here too', /Document version<\/th><td>v2/.test((await page.getAttribute('#flibDesignFrame', 'srcdoc')) || ''));
    await env.shot('design-library.png');
    await page.click('#flibDesignView .nx-iconbtn[data-act="close"]');
    await page.waitForSelector('#flibDesignView', { state: 'detached', timeout: 5000 }).catch(() => {});
    await page.click('#flibDesignTable .nx-flib-designrow[data-id="abc-12-design-v1"] [data-act="remove"]');
    await page.waitForFunction(() => document.querySelectorAll('#flibDesignTable .nx-flib-designrow').length === 1, null, { timeout: 15000 }).catch(() => {});
    T.check('Delete v1: gone from the list, the folder and the FDD library\'s git (pushed)', (await page.$$('#flibDesignTable .nx-flib-designrow')).length === 1 && !fs.existsSync(path.join(designsDir, 'abc-12-design-v1.pdf'))
      && !/abc-12-design-v1/.test(fdd.gitRemote('ls-tree', '-r', '--name-only', 'fdd/test')) && /abc-12-design-v2/.test(fdd.gitRemote('ls-tree', '-r', '--name-only', 'fdd/test')));
    await page.click('#flibDesignTable .nx-flib-designrow[data-id="abc-12-design-v2"] [data-act="story"]');
    await page.waitForFunction(() => /AI · ABC-12/.test((document.querySelector('.nx-tab--on .nx-tab-title') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
    T.check('the story\'s key opens it in Analyze with AI', /AI · ABC-12/.test(await env.text('.nx-tab--on .nx-tab-title').catch(() => '')));
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    await env.close();
    await printer.close();
    fdd.restore();
    if (pg.restore) pg.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  T.report();
})();
