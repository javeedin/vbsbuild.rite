#!/usr/bin/env node
'use strict';
/*
 * Sticky notes on a saved flow's Flow tab, in a browser: the notes sit over the diagram; one is dragged by its top bar
 * with the mouse — smoothly (the same box moves while dragging, nothing is drawn again until it is let go) — and dropped
 * anywhere: it stays over what it was dropped on (the layout closes the room it took); resized by its corner; written in
 * on several lines; its colour circles shown on it; × removes it; Sticky note adds one where you look and you stay on
 * the Flow tab, ready to type; Save keeps where each one is and its size (reopened: the same); on Edit steps a placed
 * note says so, and choosing an action puts it back under its steps. The PDF: previewed first (plain English or
 * technical, the notes in it with their lines), then Download PDF / Print. Needs `npm run build`.
 * Run: node tests/e2e/flow-notes.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const I = require('../../desktop/lib/integrations');

const T = H.makeAsserter();
const JS = path.join(__dirname, '..', '..', 'webApps', 'buildrite', 'resources', 'js');
const load = (f, deps) => { let out = null; new Function('define', fs.readFileSync(path.join(JS, f), 'utf8'))((d, fn) => { out = fn.apply(null, deps || []); }); return out; };
const settle = (page, ms) => page.waitForTimeout(ms || 400);
const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
const near = (a, b, tol) => Math.abs(a - b) <= (tol || 6);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-notes-e2e-'));
  const pg = await E.pagesSandbox();
  const D = load('integrationDiagram.js');
  const M = load('flowModel.js', [D]);
  const flowStore = require('../../desktop/lib/savedFlows').open({ dir: path.join(dir, 'saved-flows') });
  // FL-0001: the New Order page's flow with two notes laid out as before: one on the whole flow (a band at the top), one on action 1
  const f0 = M.fromPage(I.scan(pg.root), 'shop/orders/order-create', { name: 'Order intake', status: 'draft' });
  f0.stickies = [{ id: 'n1', text: 'An empty note', color: 'yellow', action: '', lane: '' }, { id: 'n2', text: 'Ask the shop team', color: 'blue', action: f0.actions[0].id, lane: '' }];
  flowStore.save(f0, 'Priya Raman');
  const { chromium } = require('playwright');
  const printer = await chromium.launch();
  const htmlToPdf = async (html) => { const p = await printer.newPage(); try { await p.setContent(html, { waitUntil: 'load' }); return await p.pdf({ format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true }); } finally { await p.close(); } };
  const env = await E.start({ port: 19990, pagesStore: pg.store, flowStore, htmlToPdf });
  const page = env.page;
  page.on('dialog', (d) => d.accept());
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const note = (id) => '#sfpNotes .nx-sfp-sn[data-id="' + id + '"]';
  const box = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  // where a text of the diagram is on the page (the diagram is in a frame of its own)
  const inDia = (words) => page.evaluate((w) => {
    const fr = document.getElementById('sfpDia');
    const t = Array.prototype.filter.call(fr.contentDocument.querySelectorAll('text'), (x) => x.textContent.indexOf(w) !== -1)[0];
    if (!t) return null;
    const a = fr.getBoundingClientRect(), r = t.getBoundingClientRect();
    return { x: a.left + r.left, y: a.top + r.top, w: r.width, h: r.height };
  }, words);
  const drag = async (sel, dx, dy, mid) => {
    const b = await box(sel);
    const sx = b.x + (mid ? b.w / 2 : b.w - 6), sy = b.y + (mid ? 10 : b.h - 6);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(sx + (dx * i) / 10, sy + (dy * i) / 10);
    return { finish: async () => { await page.mouse.up(); await settle(page, 500); } };
  };
  try {
    await env.open('/?open=integrations');
    await page.waitForSelector('#intKpis', { timeout: 30000 });
    await page.click('#intTabSaved');
    await page.waitForSelector('.nx-btn[data-act="flowOpen"][data-key="FL-0001"]', { timeout: 10000 });
    await page.click('.nx-btn[data-act="flowOpen"][data-key="FL-0001"]');
    await page.waitForSelector('#sfpBoard', { timeout: 15000 });
    await settle(page, 900);

    T.section('the notes over the diagram');
    const dia0 = (await page.getAttribute('#sfpDia', 'srcdoc')) || '';
    T.check('both notes are on the board, where the diagram puts them (not drawn in the picture under them)', (await page.$$('#sfpNotes .nx-sfp-sn--laid')).length === 2 && !/<title>Sticky note:/.test(dia0)
      && (await page.inputValue(note('n1') + ' textarea')) === 'An empty note');
    await page.hover(note('n1') + ' .nx-sfp-nbar');
    await settle(page, 250);
    T.check('…each with its colour circles (shown on it when you point at it) and × to remove it', (await page.$$(note('n1') + ' .nx-sfp-ncolor')).length === 4
      && (await page.$eval(note('n1') + ' .nx-sfp-ncolors', (e) => getComputedStyle(e).opacity)) === '1' && !!(await page.$(note('n1') + ' .nx-sfp-nx')) && !!(await page.$(note('n1') + ' .nx-sfp-nresize')));

    T.section('dragged by its top bar, smoothly, anywhere');
    const step = await inDia('the customers');
    const n1 = await box(note('n1'));
    const dh0 = Number(await page.getAttribute('#sfpBoard', 'data-dh'));
    const target = { x: step.x + 90, y: step.y - 6 };
    const g = await drag(note('n1') + ' .nx-sfp-nbar', target.x - n1.x, target.y - n1.y, true);
    const mid = await page.evaluate((s) => { const e = document.querySelector(s); e.__same = true; return { left: e.style.left, drag: e.classList.contains('nx-sfp-sn--drag') }; }, note('n1'));
    await g.finish();
    T.check('while dragging the note itself moves (nothing drawn again until it is let go)', /px$/.test(mid.left) && mid.drag, JSON.stringify(mid));
    const step2 = await inDia('the customers');
    const n1b = await box(note('n1'));
    T.check('dropped: you are still on the Flow tab; it is placed by hand now', /^Flow$/.test(await text(page, '#sfpTabs .nx-sc-tab--on')) && (await page.$$(note('n1') + '.nx-sfp-sn--laid')).length === 0 && /Unsaved changes/.test(await text(page, '#sfpBar')));
    const dh1 = Number(await page.getAttribute('#sfpBoard', 'data-dh'));
    T.check('…and stays over what it was dropped on (the band it took at the top is gone, the steps moved up — it moved with them)', dh1 < dh0 - 30 && near(n1b.y - step2.y, target.y - step.y, 8) && near(n1b.x - step2.x, target.x - step.x, 8),
      JSON.stringify({ before: target.y - step.y, after: n1b.y - step2.y, dh: [dh0, dh1] }));

    T.section('resized by its corner');
    const r0 = await box(note('n1'));
    const g2 = await drag(note('n1') + ' .nx-sfp-nresize', 90, 70, false);
    await g2.finish();
    const r1 = await box(note('n1'));
    T.check('bigger by what the corner was pulled', near(r1.w - r0.w, 90, 6) && near(r1.h - r0.h, 70, 6) && near(r1.x, r0.x, 2) && near(r1.y, r0.y, 2), JSON.stringify([r0, r1]));
    const g3 = await drag(note('n1') + ' .nx-sfp-nresize', -900, -900, false);
    await g3.finish();
    const r2 = await box(note('n1'));
    T.check('…never smaller than a note can be', r2.w > 40 && r2.h > 20, JSON.stringify(r2));
    const g4 = await drag(note('n1') + ' .nx-sfp-nresize', 170, 90, false);
    await g4.finish();

    T.section('written on several lines, its colour, removed');
    await page.fill(note('n1') + ' textarea', 'Line one\nLine two\nLine three');
    await page.press(note('n1') + ' textarea', 'Tab');
    await settle(page, 500);
    T.check('several lines kept in it', (await page.inputValue(note('n1') + ' textarea')) === 'Line one\nLine two\nLine three');
    await page.hover(note('n1') + ' .nx-sfp-nbar');
    await page.click(note('n1') + ' .nx-sfp-ncolor.nx-sfp-swatch--green');
    await settle(page);
    T.check('a colour circle: it turns green', (await page.$$(note('n1') + '.nx-sfp-sn--green')).length === 1);
    await page.hover(note('n2') + ' .nx-sfp-nbar');
    await page.click(note('n2') + ' .nx-sfp-nx');
    await settle(page);
    T.check('× removes it', !(await page.$(note('n2'))) && (await page.$$('#sfpNotes .nx-sfp-sn')).length === 1);

    T.section('Sticky note: added where you look, you stay on the Flow tab');
    await page.click('#sfpAddNoteFlow');
    await settle(page, 600);
    const added = await page.$$eval('#sfpNotes .nx-sfp-sn', (l) => l.map((x) => x.getAttribute('data-id')));
    T.check('a new note on the diagram, placed by hand, its box ready to type in; still the Flow tab', added.length === 2 && /^Flow$/.test(await text(page, '#sfpTabs .nx-sc-tab--on'))
      && (await page.evaluate(() => (document.activeElement || {}).getAttribute && document.activeElement.getAttribute('data-field'))) === 'n.' + added[1] + '.text' && (await page.$$(note(added[1]) + '.nx-sfp-sn--laid')).length === 0, JSON.stringify(added));
    const nb = await box(note(added[1]));
    const others = await page.$$eval('#sfpNotes .nx-sfp-sn', (l, id) => l.filter((x) => x.getAttribute('data-id') !== id).map((x) => { const r = x.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }), added[1]);
    T.check('…in a free spot: it covers no other note', others.every((o) => nb.x >= o.x + o.w || o.x >= nb.x + nb.w || nb.y >= o.y + o.h || o.y >= nb.y + nb.h), JSON.stringify([nb, others]));
    await page.keyboard.type('Check credit first');
    await page.keyboard.press('Enter');
    await page.keyboard.type('then submit');
    await page.press(note(added[1]) + ' textarea', 'Tab');
    await settle(page, 500);
    await env.shot('flow-notes-board.png');

    T.section('saved: where each one is and its size');
    await page.fill('#sfpNote', 'Notes placed on the diagram');
    await page.press('#sfpNote', 'Tab');
    await page.click('#sfpSave');
    await page.waitForFunction(() => /version 2/.test((document.querySelector('#sfpSub') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    const st = flowStore.get('FL-0001').flow;
    const s1 = st.stickies.filter((x) => x.id === 'n1')[0], s3 = st.stickies.filter((x) => x.id === added[1])[0];
    T.check('kept: its place and size (diagram units), its lines, its colour; the removed one gone', st.version === 2 && st.stickies.length === 2 && s1 && typeof s1.x === 'number' && s1.w > 230 && s1.color === 'green' && s1.text === 'Line one\nLine two\nLine three'
      && s3 && typeof s3.y === 'number' && s3.text === 'Check credit first\nthen submit', JSON.stringify(st.stickies));
    const placedBox = await box(note('n1'));
    await page.click('.nx-tab--on .nx-tab-close');
    await settle(page, 600);
    await page.click('.nx-btn[data-act="flowOpen"][data-key="FL-0001"]');
    await page.waitForSelector(note('n1'), { timeout: 15000 });
    await settle(page, 900);
    const again = await box(note('n1'));
    T.check('…opened again: the same place and size', near(again.x, placedBox.x, 3) && near(again.y, placedBox.y, 3) && near(again.w, placedBox.w, 3) && near(again.h, placedBox.h, 3), JSON.stringify([placedBox, again]));

    T.section('the PDF: previewed, then downloaded');
    await page.click('#sfpPdf');
    await page.waitForSelector('#sfpPdfFrame', { timeout: 5000 });
    let pv = (await page.getAttribute('#sfpPdfFrame', 'srcdoc')) || '';
    T.check('the preview as it prints: the notes drawn where they were placed, each line of them', /<title>Sticky note: Line one/.test(pv) && />Line one</.test(pv) && />Line two</.test(pv) && />Line three</.test(pv) && />then submit</.test(pv) && /Placed on the diagram/.test(pv));
    await page.click('#sfpPdfTech');
    await settle(page);
    pv = (await page.getAttribute('#sfpPdfFrame', 'srcdoc')) || '';
    T.check('…Technical: the calls as they are made', /\/shop\/v1\/customers/.test(pv) && /^A4 landscape · technical/.test(await text(page, '#sfpPdfSub')));
    await env.shot('flow-notes-pdf.png');
    const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#sfpPdfSave')]);
    const pdfFile = path.join(dir, 'f.pdf');
    await pdf.saveAs(pdfFile);
    T.check('Download PDF: a real PDF', fs.readFileSync(pdfFile).slice(0, 5).toString() === '%PDF-' && fs.statSync(pdfFile).size > 10000);
    T.check('…and Print beside it', !!(await page.$('#sfpPdfPrint')));
    await page.click('#sfpPdfDlg .nx-dialog-head [data-act="pdfClose"]');
    await settle(page);

    T.section('on Edit steps');
    await page.click('#sfpTabEdit');
    await settle(page, 600);
    T.check('a note placed by hand says so', (await page.$eval('[data-field="n.n1.action"]', (e) => e.options[e.selectedIndex].text)) === 'Where it was dragged on the diagram');
    await page.selectOption('[data-field="n.n1.action"]', st.actions[0].id);
    await settle(page);
    await page.click('#sfpTabFlow');
    await settle(page, 700);
    T.check('…choosing an action puts it back under its steps', (await page.$$(note('n1') + '.nx-sfp-sn--laid')).length === 1);

    T.check('no page errors', errs().length === 0, errs().slice(0, 3).join(' | '));
  } catch (e) {
    T.check('no exception: ' + e.message, false);
    await env.shot('flow-notes-failed.png').catch(() => {});
  } finally {
    await env.close();
    await printer.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  T.report();
})();
