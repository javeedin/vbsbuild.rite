#!/usr/bin/env node
'use strict';
/*
 * Application → Process Flows, in a browser (desktop/lib/processFlows.js): no flow yet; New → the editor (master–detail:
 * the header on top, the pages below); name it, write a description, list the pages in order (Start … End) each with a
 * note, add / move / remove pages; Save (PF-0001) and it is in the list. A page matched to a real app page can have its
 * screenshot fetched from the code or uploaded, and its APIs listed; Generate document → a preview with the name, the
 * flow, the numbered steps, the screenshots and the APIs; Draft with AI (a stand-in AI) → the draft, Use it fills the
 * description; reopen keeps everything; remove.
 * Needs `npm run build`. Run: node tests/e2e/process-flows.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const P = require('../../desktop/lib/processFlows');
const A = require('../../desktop/lib/apiTest');
const S = require('../../desktop/lib/apiScenarios');

const T = H.makeAsserter();
const settle = (page, ms) => page.waitForTimeout(ms || 300);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const pg = await E.pagesSandbox();
  // give one real page a screenshot so "From the page" has something to fetch
  pg.store.saveShot('shop/orders/order-list', { base64: PNG.toString('base64'), mime: 'image/png', source: 'upload', by: 'rite.user' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-pf-e2e-'));
  const store = P.open({ dir });
  const apiStore = A.open({ root: pg.root, file: path.join(dir, 'api-tests.json') });
  const scenarioStore = S.open({ api: apiStore, dir: path.join(dir, 'scenarios') });
  const apiProject = () => ({ catalogFile: path.join(pg.root, 'services', 'catalog.json'), getIdentity: () => ({ username: 'rite.user', roles: [], fusion: null }) });
  const asked = [];
  const aiStore = { settings: () => ({ active: 'anthropic', providers: { anthropic: { ready: true } }, catalog: [], features: [], uses: {} }),
    chat: async (b) => { asked.push(b); return { ok: true, provider: 'Claude (Anthropic)', text: 'The equipment rental process lets a customer rent an item and return it.\n\nOn the first page they browse; on Checkout they pay.' }; } };
  const htmlToPdf = async () => Buffer.from('%PDF-1.4 process flow');
  const env = await E.start({ port: 19991, processFlowStore: store, pagesStore: pg.store, apiStore, scenarioStore, apiProject, aiStore, htmlToPdf });
  const page = env.page;
  page.on('dialog', (d) => d.accept());
  page.on('filechooser', (fc) => { fc.setFiles({ name: 'cart.png', mimeType: 'image/png', buffer: PNG }).catch(() => {}); });
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const text = (sel) => env.text(sel).catch(() => '');
  const prow = (i) => '#pfEditor .nx-pf-prow[data-idx="' + i + '"]';
  try {
    T.section('the screen, no flow yet');
    await env.open('/');
    await page.click('.nx-nav-item[data-nav-id="process-flows"]');
    await page.waitForSelector('#pfTitle', { timeout: 30000 });
    await page.waitForSelector('#pfEmpty', { timeout: 10000 });
    T.check('no process flow yet, says what to do', /No process flow yet/.test(await text('#pfEmpty')));

    T.section('build one');
    await page.click('#pfNew');
    await page.waitForSelector('#pf-name', { timeout: 10000 });
    T.check('the editor: one page row, labelled Start', (await page.$$('#pfEditor .nx-pf-prow')).length === 1 && /Start/i.test(await text('#pfEditor .nx-pf-num')));
    await page.fill('#pf-name', 'Equipment rental');
    await page.fill('#pf-area', 'Rentals');
    await page.fill('#pf-desc', 'A customer rents an item and returns it.');
    await page.fill(prow(0) + ' .nx-pf-pname', 'Order Workbench');
    await page.fill(prow(0) + ' .nx-pf-pnote', 'Browse items');
    await page.click('#pfAddPage');
    await page.waitForFunction(() => document.querySelectorAll('#pfEditor .nx-pf-prow').length === 2, null, { timeout: 5000 });
    await page.fill(prow(1) + ' .nx-pf-pname', 'Cart');
    await page.click('#pfAddPage');
    await page.waitForFunction(() => document.querySelectorAll('#pfEditor .nx-pf-prow').length === 3, null, { timeout: 5000 });
    await page.fill(prow(2) + ' .nx-pf-pname', 'Checkout');
    await page.fill(prow(2) + ' .nx-pf-pnote', 'Pay');
    T.check('three pages; the last is labelled End', (await page.$$('#pfEditor .nx-pf-prow')).length === 3 && /End/i.test(await text(prow(2) + ' .nx-pf-num')));

    T.section('reorder');
    await page.click(prow(2) + ' [data-op="moveUp"]'); // Checkout up → Order Workbench, Checkout, Cart
    await settle(page);
    T.check('move up keeps what was typed, in the new order', (await page.inputValue(prow(1) + ' .nx-pf-pname')) === 'Checkout' && (await page.inputValue(prow(2) + ' .nx-pf-pname')) === 'Cart');
    await page.click(prow(1) + ' [data-op="moveDown"]'); // back to Order Workbench, Cart, Checkout
    await settle(page);
    T.check('move down restores the order', (await page.inputValue(prow(2) + ' .nx-pf-pname')) === 'Checkout');

    T.section('save');
    await page.click('#pfSave');
    await page.waitForFunction(() => /PF-0001/.test(document.body.textContent), null, { timeout: 10000 });
    const saved = store.get('PF-0001').flow;
    T.check('saved on this PC: name, area, description, the pages in order with notes', saved.name === 'Equipment rental' && saved.area === 'Rentals' && /rents an item/.test(saved.description)
      && saved.pages.map((p) => p.name).join(',') === 'Order Workbench,Cart,Checkout' && saved.pages[0].note === 'Browse items', JSON.stringify(saved.pages));

    T.section('master–detail layout, a page\'s screenshot and its APIs');
    const stacked = await page.evaluate(() => { const f = document.querySelector('#pfEditor .nx-pf-form').getBoundingClientRect(); const p = document.querySelector('#pfEditor .nx-pf-pages').getBoundingClientRect(); return p.top >= f.bottom - 2; });
    T.check('the header is on top and the pages below it (master–detail)', stacked);
    // the APIs of the first page (Order Workbench — a real app page)
    await page.click(prow(0) + ' [data-op="apisToggle"]');
    await page.waitForSelector(prow(0) + ' .nx-pf-apilist .nx-pf-apirow', { timeout: 10000 });
    const apiRows = await page.$$eval(prow(0) + ' .nx-pf-apirow', (a) => a.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    T.check('the page\'s APIs are listed (method + name + path), the orders call among them', apiRows.length >= 1 && apiRows.some((t) => /orders/i.test(t)), apiRows.join(' | '));
    // a screenshot fetched from the page's code
    await page.click(prow(0) + ' [data-op="shotFromPage"]');
    await page.waitForSelector(prow(0) + ' .nx-pf-shotimg', { timeout: 10000 });
    T.check('"From the page" fetches the page\'s screenshot as a self-contained image', /^data:image\//.test(await page.getAttribute(prow(0) + ' .nx-pf-shotimg', 'src') || ''));
    // uploading an image to another page, then removing it
    await page.click(prow(1) + ' .nx-pf-shotpick');
    await page.waitForSelector(prow(1) + ' .nx-pf-shotimg', { timeout: 10000 });
    T.check('a page screenshot can be uploaded', /^data:image\//.test(await page.getAttribute(prow(1) + ' .nx-pf-shotimg', 'src') || ''));
    await page.click(prow(1) + ' [data-op="shotRemove"]');
    await page.waitForSelector(prow(1) + ' .nx-pf-shotbox', { timeout: 5000 });
    T.check('…and removed', !(await page.$(prow(1) + ' .nx-pf-shotimg')));
    // save keeps the first page's screenshot with the flow
    await page.click('#pfSave');
    await page.waitForTimeout(500);
    const saved2 = store.get('PF-0001').flow;
    T.check('the screenshot is kept with the flow (a data: URL, source "page")', saved2.pages[0].shot && saved2.pages[0].shot.src === 'page' && /^data:image\//.test(saved2.pages[0].shot.data || ''), JSON.stringify(saved2.pages[0].shot && saved2.pages[0].shot.src));

    T.section('the document');
    await page.click('#pfGenerate');
    await page.waitForSelector('#pfDocFrame', { timeout: 10000 });
    await settle(page, 500);
    const doc = await page.evaluate(() => { const f = document.getElementById('pfDocFrame'); return f ? f.getAttribute('srcdoc') : ''; });
    T.check('the document has the name, the flow strip (Start→End) and the numbered steps with notes', /Equipment rental/.test(doc) && /class="strip"/.test(doc) && /class="steps"/.test(doc) && /Browse items/.test(doc) && /class="st-tag">Start/.test(doc) && /Checkout/.test(doc));
    T.check('…and it embeds each page\'s screenshot and lists its APIs', /class="st-shot"/.test(doc) && /data:image\//.test(doc) && /class="st-apis"/.test(doc) && /orders/i.test(doc), doc.slice(0, 60));
    await page.click('#pfPdf');
    await page.waitForFunction(() => !/Saving…/.test((document.getElementById('pfPdf') || {}).textContent || ''), null, { timeout: 10000 });
    T.eq('no browser error from the PDF download', errs().join(' | ').slice(0, 300), '');
    await page.click('#pfDoc .nx-iconbtn[data-op="docClose"]');
    await page.waitForSelector('#pfDoc', { state: 'detached', timeout: 5000 });

    T.section('draft the description with AI');
    await page.fill('#pf-desc', '');
    await page.click('#pfAi');
    await page.waitForSelector('#pfAiDraft', { timeout: 10000 });
    T.check('the AI draft shows, from a request built from the name and the pages', /lets a customer rent/.test(await text('#pfAiDraft')) && asked.length === 1 && /Order Workbench/.test(asked[0].user) && /Equipment rental/.test(asked[0].user));
    await page.click('#pfAiUse');
    await page.waitForFunction(() => !document.getElementById('pfAiDraft'), null, { timeout: 5000 });
    T.check('Use it puts the draft in the description', /lets a customer rent/.test(await page.inputValue('#pf-desc')));

    T.section('back, reopen, remove');
    await page.click('#pfBack');
    await page.waitForSelector('#pfList .nx-pf-card', { timeout: 10000 });
    T.check('the list shows it with its pages and page count', /Equipment rental/.test(await text('#pfList')) && /Order Workbench/.test(await text('#pfList .nx-pf-chips')) && /3 pages/.test(await text('#pfList')));
    await page.click('#pfList .nx-pf-open');
    await page.waitForSelector('#pfEditor', { timeout: 10000 });
    T.check('reopened: the name, the pages and the kept screenshot are there', (await page.inputValue('#pf-name')) === 'Equipment rental' && (await page.$$('#pfEditor .nx-pf-prow')).length === 3 && !!(await page.$(prow(0) + ' .nx-pf-shotimg')));
    await page.click('#pfBack');
    await page.waitForSelector('#pfList .nx-pf-card', { timeout: 10000 });
    await page.click('#pfList .nx-pf-del');
    await page.waitForSelector('#pfEmpty', { timeout: 10000 });
    T.check('removed from the list and this PC', store.list('').flows.length === 0 && /No process flow yet/.test(await text('#pfEmpty')));
    await env.shot('process-flows.png');
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    await env.close();
    fs.rmSync(dir, { recursive: true, force: true });
    if (pg.restore) pg.restore();
  }
  T.report();
})();
