#!/usr/bin/env node
'use strict';
/**
 * Change requests › Knowledge base (webApps/buildrite/resources/js/crKnowledge.js): an FDD's sections listed with a
 * technical tag (its heading or a heading above it: integration, API, data model, report, security…), filtered
 * (functional / technical) and searched, ticked ones marked; the sections that match the request suggested; the
 * knowledge text the AI reads (the chosen sections in order, then the person's notes); a one-line summary.
 */
const fs = require('fs');
const path = require('path');
const H = require('./_harness');

const T = H.makeAsserter();
const JS = path.join(__dirname, '..', 'webApps', 'buildrite', 'resources', 'js');
let FX = null, K = null;
new Function('define', fs.readFileSync(path.join(JS, 'fddIndex.js'), 'utf8'))((deps, f) => { FX = f(); });
new Function('define', fs.readFileSync(path.join(JS, 'crKnowledge.js'), 'utf8'))((deps, f) => { K = f(FX); });

const doc = { id: 'fdd1', name: 'Customer Portal FDD', version: '2', sections: [
  { n: '7', t: 'Customer statements', l: 1, x: 'Customers see their statements.' },
  { n: '7.1', t: 'Statement list', l: 2, x: 'The statements of the last 12 months, newest first; each opens its PDF.' },
  { n: '7.2', t: 'Statement filters', l: 2, x: 'Filter by month and by status (open, paid).' },
  { n: '8', t: 'Technical design', l: 1, x: '' },
  { n: '8.1', t: 'Statement service', l: 2, x: 'GET /statements?customer={id} returns id, period, amount, status, pdfUrl.' },
  { n: '8.2', t: 'Error handling', l: 2, x: 'A failed call shows a banner with retry.' },
  { n: '9', t: 'Billing', l: 1, x: 'Invoices and payments.' }
] };

T.section('the sections, functional and technical');
const all = K.outline(doc, ['7.1', '8.1'], 'all', '');
T.eq('every section, technical when its heading (or one above it) says so', all.map((s) => s.n + (s.tech ? 'T' : '')).join(' '), '7 7.1 7.2 8T 8.1T 8.2T 9');
T.check('…ticked ones marked; their parent named', all.filter((s) => s.on).map((s) => s.n).join() === '7.1,8.1' && all[1].parent === '7 Customer statements');
T.eq('technical only', K.outline(doc, [], 'technical', '').map((s) => s.n).join(), '8,8.1,8.2');
T.eq('functional only, searched ("filter")', K.outline(doc, [], 'functional', 'filter').map((s) => s.n).join(), '7.2');

T.section('suggested for the request; the text the AI reads');
const sug = K.suggest(doc, 'A statements page: the statement list of the last 12 months with filters by month and status');
T.check('suggested: the statement sections the request talks about', sug.indexOf('7.1') !== -1 && sug.indexOf('7.2') !== -1 && sug.indexOf('9') === -1, sug.join());
const t = K.text(doc, ['8.1', '7.1'], 'Use the PDF viewer the billing page uses.');
T.check('the text: the chosen sections in document order (named with the FDD), then the notes', /^### FDD Customer Portal FDD v2 — 7\.1 Statement list\nThe statements of the last 12 months[\s\S]*### FDD Customer Portal FDD v2 — 8\.1 Statement service\nGET \/statements[\s\S]*### Notes and rules from the person\nUse the PDF viewer/.test(t), t);
T.check('…nothing chosen, no notes: empty', K.text(doc, [], '') === '' && K.text(null, [], 'only notes') === '### Notes and rules from the person\nonly notes');
T.eq('the summary', [K.summary({ sections: ['7.1', '8.1'], fddLabel: 'Customer Portal FDD v2', notes: 'x' }), K.summary({}), K.summary({ notes: 'y' })].join(' | '), '2 FDD sections of Customer Portal FDD v2 + your notes | nothing yet | your notes');
T.report();
