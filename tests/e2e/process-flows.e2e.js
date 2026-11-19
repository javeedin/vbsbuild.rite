#!/usr/bin/env node
'use strict';
/*
 * Application → Process Flows, in a browser (desktop/lib/processFlows.js): no flow yet; New → the editor; name it, write a
 * description, list the pages in order (Start … End) each with a note, add / move / remove pages; Save (PF-0001) and it is
 * in the list; Generate document → a preview with the name, the flow and the numbered steps; Draft with AI (a stand-in AI)
 * → the draft, Use it fills the description; reopen keeps everything; remove.
 * Needs `npm run build`. Run: node tests/e2e/process-flows.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const P = require('../../desktop/lib/processFlows');

const T = H.makeAsserter();
const settle = (page, ms) => page.waitForTimeout(ms || 300);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-pf-e2e-'));
  const store = P.open({ dir });
  const asked = [];
  const aiStore = { settings: () => ({ active: 'anthropic', providers: { anthropic: { ready: true } }, catalog: [], features: [], uses: {} }),
    chat: async (b) => { asked.push(b); return { ok: true, provider: 'Claude (Anthropic)', text: 'The equipment rental process lets a customer rent an item and return it.\n\nOn the Catalog they browse; on Checkout they pay.' }; } };
  const htmlToPdf = async () => Buffer.from('%PDF-1.4 process flow');
  const env = await E.start({ port: 19991, processFlowStore: store, aiStore, htmlToPdf });
  const page = env.page;
  page.on('dialog', (d) => d.accept());
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
    await page.fill('#pfEditor .nx-pf-prow[data-idx="0"] .nx-pf-pname', 'Catalog');
    await page.fill('#pfEditor .nx-pf-prow[data-idx="0"] .nx-pf-pnote', 'Browse items');
    await page.click('#pfAddPage');
    await page.waitForFunction(() => document.querySelectorAll('#pfEditor .nx-pf-prow').length === 2, null, { timeout: 5000 });
    await page.fill('#pfEditor .nx-pf-prow[data-idx="1"] .nx-pf-pname', 'Cart');
    await page.click('#pfAddPage');
    await page.waitForFunction(() => document.querySelectorAll('#pfEditor .nx-pf-prow').length === 3, null, { timeout: 5000 });
    await page.fill('#pfEditor .nx-pf-prow[data-idx="2"] .nx-pf-pname', 'Checkout');
    await page.fill('#pfEditor .nx-pf-prow[data-idx="2"] .nx-pf-pnote', 'Pay');
    T.check('three pages; the last is labelled End', (await page.$$('#pfEditor .nx-pf-prow')).length === 3 && /End/i.test(await text('#pfEditor .nx-pf-prow[data-idx="2"] .nx-pf-num')));

    T.section('reorder');
    await page.click('#pfEditor .nx-pf-prow[data-idx="2"] [data-op="moveUp"]'); // Checkout up → Catalog, Checkout, Cart
    await settle(page);
    T.check('move up keeps what was typed, in the new order', (await page.inputValue('#pfEditor .nx-pf-prow[data-idx="1"] .nx-pf-pname')) === 'Checkout' && (await page.inputValue('#pfEditor .nx-pf-prow[data-idx="2"] .nx-pf-pname')) === 'Cart');
    await page.click('#pfEditor .nx-pf-prow[data-idx="1"] [data-op="moveDown"]'); // back to Catalog, Cart, Checkout
    await settle(page);
    T.check('move down restores the order', (await page.inputValue('#pfEditor .nx-pf-prow[data-idx="2"] .nx-pf-pname')) === 'Checkout');

    T.section('save');
    await page.click('#pfSave');
    await page.waitForFunction(() => /PF-0001/.test(document.body.textContent), null, { timeout: 10000 });
    const saved = store.get('PF-0001').flow;
    T.check('saved on this PC: name, area, description, the pages in order with notes', saved.name === 'Equipment rental' && saved.area === 'Rentals' && /rents an item/.test(saved.description)
      && saved.pages.map((p) => p.name).join(',') === 'Catalog,Cart,Checkout' && saved.pages[0].note === 'Browse items', JSON.stringify(saved.pages));

    T.section('the document');
    await page.click('#pfGenerate');
    await page.waitForSelector('#pfDocFrame', { timeout: 10000 });
    await settle(page, 400);
    const doc = await page.evaluate(() => { const f = document.getElementById('pfDocFrame'); return f ? f.getAttribute('srcdoc') : ''; });
    T.check('the document has the name, the flow strip (Start→End) and the numbered steps with notes', /Equipment rental/.test(doc) && /class="strip"/.test(doc) && /class="steps"/.test(doc) && /Browse items/.test(doc) && /class="st-tag">Start/.test(doc) && /Checkout/.test(doc));
    await page.click('#pfPdf');
    await page.waitForFunction(() => !/Saving…/.test((document.getElementById('pfPdf') || {}).textContent || ''), null, { timeout: 10000 });
    T.eq('no browser error from the PDF download', errs().join(' | ').slice(0, 300), '');
    await page.click('#pfDoc .nx-iconbtn[data-op="docClose"]');
    await page.waitForSelector('#pfDoc', { state: 'detached', timeout: 5000 });

    T.section('draft the description with AI');
    await page.fill('#pf-desc', '');
    await page.click('#pfAi');
    await page.waitForSelector('#pfAiDraft', { timeout: 10000 });
    T.check('the AI draft shows, from a request built from the name and the pages', /lets a customer rent/.test(await text('#pfAiDraft')) && asked.length === 1 && /Catalog/.test(asked[0].user) && /Equipment rental/.test(asked[0].user));
    await page.click('#pfAiUse');
    await page.waitForFunction(() => !document.getElementById('pfAiDraft'), null, { timeout: 5000 });
    T.check('Use it puts the draft in the description', /lets a customer rent/.test(await page.inputValue('#pf-desc')));

    T.section('back, reopen, remove');
    await page.click('#pfBack');
    await page.waitForSelector('#pfList .nx-pf-card', { timeout: 10000 });
    T.check('the list shows it with its pages and page count', /Equipment rental/.test(await text('#pfList')) && /Catalog/.test(await text('#pfList .nx-pf-chips')) && /3 pages/.test(await text('#pfList')));
    await page.click('#pfList .nx-pf-open');
    await page.waitForSelector('#pfEditor', { timeout: 10000 });
    T.check('reopened: the name and the pages are there', (await page.inputValue('#pf-name')) === 'Equipment rental' && (await page.$$('#pfEditor .nx-pf-prow')).length === 3);
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
  }
  T.report();
})();
