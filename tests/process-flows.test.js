#!/usr/bin/env node
'use strict';
/**
 * Process Flows (desktop/lib/processFlows.js): a process across the app's pages, written by hand — name, description, the
 * pages in order with a note — kept per project, and turned into a document. The store (save keeps the code, list newest
 * first, get/remove, no workspace said); the document (title, control table, description paragraphs, the flow strip,
 * numbered steps with Start/End and notes, print-ready HTML, everything escaped); the AI prompt (names, pages, no invention).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const P = require('../desktop/lib/processFlows');

const T = H.makeAsserter();
(() => {
  T.section('no workspace');
  T.check('no folder: every call says to set up the workspace', P.open({ dir: () => '' }).list('').ok === false && /workspace/.test(P.open({ dir: () => '' }).save({ name: 'x' }).error));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-pf-'));
  let clock = new Date('2026-11-19T09:00:00Z');
  const s = P.open({ dir, now: () => clock });

  T.section('save, list, get, remove');
  T.check('a fresh project has no flows', s.list('').flows.length === 0);
  let r = s.save({ name: 'Equipment rental', area: 'Rentals', description: 'A customer rents an item.\n\nThey return it later.',
    pages: [{ name: 'Catalog', note: 'Browse items' }, { name: 'Cart' }, { name: 'Checkout', page: 'app/orders/checkout', note: 'Pay' }] }, 'rite.user');
  T.check('saved: a code, the pages kept in order, who and when', r.ok && r.flow.id === 'PF-0001' && r.flow.pages.length === 3 && r.flow.pages[0].name === 'Catalog' && r.flow.created === 'rite.user' && r.flow.createdAt === '2026-11-19T09:00:00.000Z');
  const trim = P.open({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'br-pf2-')) });
  T.check('an empty page (no name, no page id) is dropped', trim.save({ name: 'Trim', pages: [{ name: 'A' }, { name: '', note: 'x' }, { page: 'app/b', name: '' }] }, 'rite.user').flow.pages.map((p) => p.name || p.page).join(',') === 'A,app/b');
  clock = new Date('2026-11-19T10:00:00Z');
  r = s.save(Object.assign({}, r.flow, { name: 'Equipment rental v2', status: 'review' }), 'sam');
  T.check('update keeps the code and created, stamps updated/by', r.flow.id === 'PF-0001' && r.flow.name === 'Equipment rental v2' && r.flow.created === 'rite.user' && r.flow.updatedBy === 'sam' && r.flow.status === 'review');
  s.save({ name: 'Order to cash', pages: [{ name: 'Order' }] }, 'sam');
  T.check('newest code first; the list is slimmed (names, count, no description)', s.list('').flows.map((f) => f.id).join(',') === 'PF-0002,PF-0001' && s.list('').flows[1].names.join(',') === 'Catalog,Cart,Checkout' && s.list('').flows[0].pages === 1 && s.list('').flows[0].description === undefined);
  T.check('search by name / area / page', s.list('rental').flows.length === 1 && s.list('cash').flows.length === 1 && s.list('checkout').flows.map((f) => f.id).join(',') === 'PF-0001' && s.list('nope').flows.length === 0);
  T.check('get one in full; a bad id said', s.get('PF-0001').flow.description.indexOf('rents') !== -1 && s.get('PF-9999').ok === false);
  T.check('removed; a second remove says no such flow', s.remove('PF-0002').ok === true && s.list('').flows.length === 1 && s.remove('PF-0002').ok === false);
  T.check('kept on disk as JSON, no temp left', fs.existsSync(path.join(dir, 'PF-0001.json')) && !fs.existsSync(path.join(dir, 'PF-0001.json.tmp')));
  T.check('a restart reads it back', P.open({ dir }).get('PF-0001').flow.name === 'Equipment rental v2');

  T.section('the document');
  const flow = s.get('PF-0001').flow;
  const html = P.renderDocument(flow, { app: 'Acme Rentals', date: '2026-11-19' });
  T.check('print-ready HTML with the name, code, area, status, application', html.startsWith('<!doctype html>') && /Equipment rental v2/.test(html) && /PF-0001/.test(html) && /Rentals/.test(html) && /In review/.test(html) && /Acme Rentals/.test(html));
  T.check('the description in paragraphs', /<p>A customer rents an item\.<\/p>/.test(html) && /<p>They return it later\.<\/p>/.test(html));
  T.check('the flow strip: boxes with arrows, Start and End labels', /class="strip"/.test(html) && (html.match(/class="arr"/g) || []).length === 2 && /Start/.test(html) && /End/.test(html));
  T.check('the numbered steps with their notes and the catalog page id', /class="steps"/.test(html) && /Browse items/.test(html) && /class="st-tag">Start/.test(html) && /class="st-tag end">End/.test(html) && /app\/orders\/checkout/.test(html));
  const danger = P.renderDocument({ name: '<script>x</script>', description: 'a & b <tag>', pages: [{ name: '<b>P</b>', note: '"q" & <i>' }] }, {});
  T.check('everything is escaped: no raw tag from the name, description or a page gets through', !/<script>x<\/script>/.test(danger) && !/<b>P<\/b>/.test(danger) && /&lt;script&gt;/.test(danger) && /a &amp; b &lt;tag&gt;/.test(danger));
  T.check('no pages / no description: said, still valid HTML', /No pages yet\./.test(P.renderDocument({ name: 'Empty' }, {})) && /No description\./.test(P.renderDocument({ name: 'Empty' }, {})));

  T.section('the AI prompt');
  const prompt = P.aiPrompt(flow);
  T.check('names the process and the pages in order, carries the author\'s text, forbids invention', /Equipment rental v2/.test(prompt) && /1\. Catalog/.test(prompt) && /3\. Checkout/.test(prompt) && /rents an item/.test(prompt) && /Do not invent/.test(prompt));

  T.report();
})();
