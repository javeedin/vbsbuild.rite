#!/usr/bin/env node
'use strict';
/**
 * The functional design of a story (Analyze with AI → Create the functional design):
 *   - desktop/lib/designDoc.js: the pages a story touches (mapped first, then by shared words), one page's facts for the
 *     AI, the prompt (fixed headings, the story, its analysis, the FDD, the pages' fields, lists, calls, chains and files),
 *     the AI's Markdown → HTML (headings, nested lists, tables, code, wireframes drawn from JSON; nothing it writes runs),
 *     the whole document (cover, control table with sprint, story, version and date, contents)
 *   - desktop/lib/fdd.js: design documents saved with the FDD library (docs/fdd/designs, resources/fdd/designs.json),
 *     versioned per story, read back by kind, deleted; two people's lists merged (the data branch)
 *   - desktop/lib/devserver.js /__fdd/design: the saved analysis, the FDD sections sent, the working folder's pages, the
 *     AI (a stand-in), the PDF (a stand-in printer), the files; the list, a file inline or as a download, delete
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const H = require('./_harness');
const D = require('../desktop/lib/designDoc');
const F = require('../desktop/lib/fdd');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'vb-sample');

const MD = [
  '## 1. Overview', 'Watch an order from the order list [FDD 7.2]. <img src=x onerror=alert(1)>',
  '## 2. Functional design (FDD)', '### 2.1 Business requirement', '- A buyer watches an order', '  - and is told when it ships', '- Then unwatches it',
  '## 3. Wireframes', '```wireframe',
  '{"screen": "Order list — watch", "page": "shop/orders/order-list", "sections": [{"title": "Watch", "fields": [{"label": "Notify me", "type": "select", "value": "Shipped", "required": true}, {"label": "Email too", "type": "toggle", "value": "on"}], "table": {"columns": ["Order", "Status"], "rows": 2}}], "actions": ["Save", "Cancel"], "notes": "A Watch toggle on each row"}',
  '```', 'The buyer ticks Watch.',
  '## 4. Technical design (TDD)', '### 4.3 Integration touch points', '| # | System | Endpoint or report | Method |', '|---|---|---|---|', '| 1 | shop | shopApi/getOrders | GET |', '| 2 | shop | NEW shopApi/postWatch | POST |',
  '## 5. Developer reference', '### 5.1 Files to change', '1. `webApps/shop/flows/orders/pages/order-list-page.html`', '2. NEW `order-list-page-chains/WatchChain.js`',
  '## 6. Assumptions and open questions', '> Who gets the email?'].join('\n');

function request(port, method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: 'localhost', port, method, path: p, headers: Object.assign({ 'X-Build-Rite-FDD': '1' }, data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}, headers || {}) }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const buf = Buffer.concat(chunks); let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch (e) { json = null; } resolve({ status: res.statusCode, headers: res.headers, buf, json }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const tmp = [];
  const mk = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); tmp.push(d); return d; };
  try {
    T.section('the pages a story touches');
    const pages = [{ id: 'shop/orders/order-list', label: 'Order Workbench', fields: ['Find an order'] }, { id: 'shop/customers/customer-billing', label: 'Customer billing', fields: ['Invoice'] },
      { id: 'shop/orders/order-detail', label: 'Order detail', fields: ['Order number', 'Shipment'] }];
    const story = { summary: 'Watch an order and its shipment', description: 'The buyer watches an order from the order list.' };
    let ids = D.relevantPages(pages, story, ['shop/customers/customer-billing'], 3);
    T.check('mapped first, then those sharing the most words (2 at least); one unrelated left out', ids[0] === 'shop/customers/customer-billing' && ids.indexOf('shop/orders/order-detail') !== -1 && ids.length <= 3, ids.join());
    T.eq('…a minimum of one word (by title alone)', D.relevantPages(pages, { summary: 'Billing run' }, [], 3, 1).join(), 'shop/customers/customer-billing');
    const facts = require('../desktop/lib/pageScan').analyze(FIXTURE, 'shop/orders/order-list');
    const pt = D.pageText(facts);
    T.check('one page, for the AI: its title, fields, REST calls (method, path, endpoint) and chains with their files', /### Page shop\/orders\/order-list — Order Workbench/.test(pt) && /Fields: Find an order/.test(pt)
      && /REST: GET \/shop\/v1\/orders — shopApi\/getOrders/.test(pt) && /Chain LoadOrdersChain \(webApps\/shop\/flows\/orders\/pages\/order-list-page-chains\/LoadOrdersChain\.js\)/.test(pt), pt.slice(0, 600));

    T.section('the prompt');
    const p = D.prompt({ story: { key: 'ABC-12', summary: 'Watch an order' }, storyText: 'STORY ABC-12: Watch an order', analysis: '## What to do next\n- Add a Watch toggle', fdd: { name: 'Shop FDD · v1.7', text: '7.2 Order master list: every order.' },
      pages: [facts], backends: ['Shop API'], allPages: pages, appName: 'Shop' });
    T.check('the system: only what the context has, NEW for the rest, the FDD cited', /only the pages, files, chains, modules, REST endpoints/.test(p.system) && /"NEW"/.test(p.system) && /\[FDD n\]/.test(p.system));
    T.check('…every heading, in order: FDD, wireframes, TDD (touch points), developer reference, questions', D.OUTLINE.every((h) => p.user.indexOf(h) !== -1)
      && p.user.indexOf('## 2. Functional design (FDD)') < p.user.indexOf('## 3. Wireframes') && p.user.indexOf('### 4.3 Integration touch points') < p.user.indexOf('## 5. Developer reference'));
    T.check('…the wireframe format, the touch-points table, real paths for the files to change', /```wireframe/.test(p.user) && /\| # \| System \| Endpoint or report \| Method \| Purpose \| Sends \| Uses from the answer \|/.test(p.user) && /the real paths from the context/.test(p.user));
    T.check('…the story, its analysis, the FDD sections, the page\'s code facts, every page of the app', /STORY ABC-12/.test(p.user) && /Add a Watch toggle/.test(p.user) && /Shop FDD · v1\.7/.test(p.user)
      && /REST: GET \/shop\/v1\/orders/.test(p.user) && /shop\/customers\/customer-billing — Customer billing/.test(p.user) && /\(Shop\)/.test(p.user));

    T.section('Markdown → HTML');
    const r = D.mdToHtml(MD);
    const flat = r.html.replace(/\n/g, '');
    T.check('headings with ids, for the contents (## → h2, ### → h3)', r.heads.length >= 8 && r.heads[0].lvl === 2 && /<h3 id="h\d+">2\.1 Business requirement<\/h3>/.test(r.html), r.heads.map((h) => h.text).join(' | '));
    T.check('nested lists; numbered lists', /<ul><li>A buyer watches an order<ul><li>and is told when it ships<\/li><\/ul><\/li><li>Then unwatches it<\/li><\/ul>/.test(flat) && /<ol><li><code>webApps\/shop/.test(flat), flat.slice(flat.indexOf('<ul>'), flat.indexOf('<ul>') + 160));
    T.check('a table (the touch points), NEW marked, the FDD cited, a quote', /<table class="tbl"><thead><tr><th>#<\/th><th>System<\/th>/.test(flat) && /<span class="new">NEW<\/span> shopApi\/postWatch/.test(flat)
      && /<span class="cite">FDD 7\.2<\/span>/.test(flat) && /<blockquote>Who gets the email\?<\/blockquote>/.test(flat));
    T.check('a wireframe drawn: the screen, its page, fields (required, a select, a toggle on), a table, the buttons (the first primary), the note', /<figure class="wf">/.test(flat) && /<b>Order list — watch<\/b><span class="wf-page">shop\/orders\/order-list<\/span>/.test(flat)
      && /Notify me <i>\*<\/i>/.test(flat) && /wf-select">Shipped<span class="wf-mark">▾/.test(flat) && /wf-toggle wf-toggle--on/.test(flat) && /<th>Order<\/th><th>Status<\/th>/.test(flat)
      && /wf-btn wf-btn--p">Save/.test(flat) && /<figcaption>A Watch toggle on each row<\/figcaption>/.test(flat));
    T.check('nothing the AI writes runs: its HTML is text', !/<img/.test(r.html) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(r.html));
    T.check('a wireframe that is not JSON: shown as code', /<pre><code>\{ not json/.test(D.mdToHtml('```wireframe\n{ not json\n```').html));
    const wf = D.wireframe({ screen: '<b>x</b>', sections: [{ fields: [{ label: 'a"b', type: 'checkbox', value: 'yes' }] }], actions: ['<i>'] });
    T.check('…its words escaped too', /&lt;b&gt;x&lt;\/b&gt;/.test(wf) && /a&quot;b/.test(wf) && /wf-check">✓/.test(wf) && /&lt;i&gt;/.test(wf));

    T.section('the document');
    const doc = D.renderDocument({ meta: { key: 'ABC-12', title: 'Watch an order', sprint: '2026-11 A', epic: 'ABC-1 Order Registry', assignee: 'Priya Raman', version: 2, date: '2026-11-16',
      author: 'Sam Lee', fdd: 'Shop FDD · v1.7', app: 'Shop', pages: ['shop/orders/order-list'], provider: 'ChatGPT' }, markdown: MD });
    T.check('A4, printable; the cover: the story, the app, the sprint, the version, the date', /@page \{ size: A4/.test(doc) && /<h1>ABC-12 · Watch an order<\/h1>/.test(doc) && /Shop · Sprint 2026-11 A · Version 2 · 2026-11-16/.test(doc));
    T.check('…its control table: story, sprint, epic, version, date, prepared by, the FDD, pages, the AI', ['<th>Story</th><td>ABC-12 — Watch an order', '<th>Sprint</th><td>2026-11 A', '<th>Epic</th><td>ABC-1 Order Registry',
      '<th>Document version</th><td>v2', '<th>Date</th><td>2026-11-16', '<th>Prepared by</th><td>Sam Lee', '<th>Read against</th><td>Shop FDD · v1.7', '<th>Pages considered</th><td>shop/orders/order-list', 'ChatGPT (AI)'].every((x) => doc.indexOf(x) !== -1));
    T.check('…contents linking to each heading; no script anywhere', /<nav class="toc"><b>Contents<\/b><a class="l2" href="#h1">1\. Overview<\/a>/.test(doc) && !/<script/i.test(doc));

    T.section('saved with the FDD library');
    const root = mk('br-design-');
    fs.mkdirSync(path.join(root, 'webApps', 'buildrite', 'resources', 'fdd'), { recursive: true });
    const mirror = mk('br-design-mirror-');
    let clock = Date.parse('2026-11-16T10:00:00Z');
    const S = F.open({ root, mirror, now: () => new Date(clock += 60000) });
    const st = { key: 'ABC-12', summary: 'Watch an order', sprint: '2026-11 A', epic: 'ABC-1 Order Registry', assignee: 'Priya Raman', due: '2026-11-30', status: 'DEVELOPMENT', url: 'https://example.atlassian.net/browse/ABC-12' };
    const pdf = Buffer.from('%PDF-1.4 a stand-in\n%%EOF');
    const s1 = S.saveDesign({ story: st, markdown: MD, html: doc, pdf, fdd: { id: 'shop-fdd-v1-7', name: 'Shop FDD · v1.7' }, pages: ['shop/orders/order-list'], provider: 'ChatGPT', model: 'gpt-4o', by: 'Sam Lee' });
    T.check('v1: its PDF, HTML and Markdown in docs/fdd/designs, listed in resources/fdd/designs.json (and the build copy)', s1.ok && s1.doc.id === 'abc-12-design-v1' && s1.doc.version === 1
      && fs.readFileSync(path.join(root, 'docs/fdd/designs/abc-12-design-v1.pdf')).toString().indexOf('%PDF') === 0 && fs.existsSync(path.join(root, 'docs/fdd/designs/abc-12-design-v1.html'))
      && fs.readFileSync(path.join(root, 'docs/fdd/designs/abc-12-design-v1.md'), 'utf8') === MD && fs.existsSync(path.join(mirror, 'designs.json'))
      && s1.files.join() === 'docs/fdd/designs/abc-12-design-v1.pdf,docs/fdd/designs/abc-12-design-v1.html,docs/fdd/designs/abc-12-design-v1.md,webApps/buildrite/resources/fdd/designs.json', JSON.stringify(s1).slice(0, 400));
    T.check('…with the story\'s sprint, epic, status, link, who, the AI, the FDD, the pages, the sizes', s1.doc.sprint === '2026-11 A' && s1.doc.epic === 'ABC-1 Order Registry' && s1.doc.status === 'DEVELOPMENT'
      && s1.doc.url === st.url && s1.doc.by === 'Sam Lee' && s1.doc.provider === 'ChatGPT' && s1.doc.fddName === 'Shop FDD · v1.7' && s1.doc.pages[0] === 'shop/orders/order-list' && s1.doc.sizes.pdf === pdf.length);
    const s2 = S.saveDesign({ story: st, markdown: MD, html: doc, pdf: null, by: 'Sam Lee' });
    T.check('again: v2, newest first; no PDF (it could not be printed): HTML and Markdown only', s2.ok && s2.doc.version === 2 && !s2.doc.files.pdf && S.designs('ABC-12').map((d) => d.version).join() === '2,1');
    S.saveDesign({ story: { key: 'ABC-13', summary: 'Edit' }, markdown: '# x', html: '<p>x</p>' });
    T.check('another story: its own v1; a story\'s list is only its own; the library info lists them all', S.designs('ABC-13').length === 1 && S.designs('ABC-13')[0].version === 1 && S.designs('ABC-12').length === 2
      && S.info().designs.length === 3 && S.info().paths.designs === 'docs/fdd/designs');
    let f = S.designFile('abc-12-design-v1', 'pdf');
    T.check('a file by kind: the PDF', f.ok && f.mime === 'application/pdf' && f.name === 'abc-12-design-v1.pdf');
    f = S.designFile('abc-12-design-v2', 'pdf');
    T.check('…a PDF it does not have: said, with what to do', !f.ok && /no PDF .*download its HTML and print it/.test(f.error), f.error);
    T.check('…an id that is not one: refused', !S.designFile('../../etc/passwd', 'md').ok && !S.designFile('ABC 12', 'md').ok);
    T.check('…nothing to save, no story: refused', !S.saveDesign({ story: st, markdown: ' ' }).ok && !S.saveDesign({ story: {}, markdown: MD }).ok);
    const rm = S.removeDesign('abc-12-design-v1');
    T.check('delete: its files gone, unlisted', rm.ok && !fs.existsSync(path.join(root, 'docs/fdd/designs/abc-12-design-v1.pdf')) && S.designs('ABC-12').map((d) => d.version).join() === '2' && rm.files.indexOf('docs/fdd/designs/abc-12-design-v1.pdf') !== -1);
    T.check('…the next after the newest: v3', S.saveDesign({ story: st, markdown: MD }).doc.version === 3);
    const merged = JSON.parse(F.mergeDesigns(JSON.stringify({ docs: [{ id: 'a-design-v1', createdAt: '2026-11-01' }] }), JSON.stringify({ docs: [{ id: 'a-design-v2', createdAt: '2026-11-02' }, { id: 'a-design-v1', createdAt: '2026-11-01' }] })));
    T.eq('two people\'s lists (the data branch): every design of either, newest first', merged.docs.map((d) => d.id).join(), 'a-design-v2,a-design-v1');
    T.check('not from the project folder: refused, said', !F.open({ root: mk('br-nodesign-') }).saveDesign({ story: st, markdown: MD }).ok);

    T.section('/__fdd/design: from the analysis page to the PDF');
    const proot = mk('br-design-srv-');
    fs.mkdirSync(path.join(proot, 'webApps', 'buildrite', 'resources', 'fdd'), { recursive: true });
    const fd = F.open({ root: proot });
    const asked = [];
    const aiStore = { chat: async (b) => { asked.push(b); return { ok: true, text: MD, provider: 'ChatGPT', model: 'gpt-4o' }; } };
    const analysisStore = { get: (k) => (k === 'ABC-12' ? { ok: true, item: { text: '## What to do next\n- Add a Watch toggle on the order list' } } : { ok: false }) };
    const pagesStore = { catalog: () => ({ pages: [{ id: 'shop/orders/order-list', label: 'Order Workbench', appName: 'Shop', stories: [] }, { id: 'shop/customers/customer-billing', label: 'Customer billing', appName: 'Shop', stories: [] },
      { id: 'shop/orders/order-detail', label: 'Order detail', appName: 'Shop', stories: ['ABC-12'] }] }), facts: (id) => require('../desktop/lib/pageScan').analyze(FIXTURE, id) };
    const printed = [];
    const DS = require('../desktop/lib/devserver');
    const port = 19000 + Math.floor(Math.random() * 500);
    const srv = await DS.createDevServer({ buildDir: path.join(ROOT, 'build'), webApp: 'buildrite', port, fddStore: fd, aiStore, analysisStore, pagesStore,
      htmlToPdf: async (html) => { printed.push(html); return Buffer.from('%PDF-1.7 printed\n%%EOF'); }, getIdentity: () => ({ username: 'sam', displayName: 'Sam Lee' }), onLog: () => {} });
    try {
      const body = { story: st, storyText: 'STORY ABC-12: Watch an order from the order list', fdd: { id: 'shop-fdd-v1-7', name: 'Shop FDD · v1.7', text: '7.2 Order master list: every order.' }, mapped: [] };
      let res = await request(port, 'POST', '/__fdd/design', body);
      const b = res.json || {};
      T.check('written and saved: v1, its PDF printed from the document, the analysis used', b.ok && b.doc.id === 'abc-12-design-v1' && b.doc.files.pdf && printed.length === 1 && /<h1>ABC-12 · Watch an order<\/h1>/.test(printed[0])
        && b.analysisUsed === true && fs.readFileSync(path.join(proot, 'docs/fdd/designs/abc-12-design-v1.pdf')).toString().indexOf('%PDF-1.7') === 0, JSON.stringify(b).slice(0, 300));
      const u = asked[0] || {};
      T.check('the AI asked once (Analyze with AI\'s AI, room to write): the story, its saved analysis, the FDD sections sent', asked.length === 1 && u.feature === 'analysis' && u.maxTokens >= 12000
        && /STORY ABC-12/.test(u.user) && /Add a Watch toggle on the order list/.test(u.user) && /7\.2 Order master list: every order\./.test(u.user));
      T.check('…the pages from the working folder: the one mapped to the story first, then the one its words name, with their code facts', /### Page shop\/orders\/order-detail/.test(u.user) && /### Page shop\/orders\/order-list — Order Workbench/.test(u.user)
        && u.user.indexOf('### Page shop/orders/order-detail') < u.user.indexOf('### Page shop/orders/order-list') && /REST: GET \/shop\/v1\/orders/.test(u.user) && !/### Page shop\/customers\/customer-billing/.test(u.user));
      T.check('…the document: who prepared it, the pages considered, the FDD', /<th>Prepared by<\/th><td>Sam Lee/.test(printed[0]) && /<th>Pages considered<\/th><td>shop\/orders\/order-detail, shop\/orders\/order-list/.test(printed[0]) && /<th>Read against<\/th><td>Shop FDD · v1\.7/.test(printed[0]));
      res = await request(port, 'GET', '/__fdd/designs?story=ABC-12');
      T.check('the story\'s designs', res.json && res.json.ok && res.json.docs.length === 1 && res.json.docs[0].sprint === '2026-11 A');
      res = await request(port, 'GET', '/__fdd/design-file?id=abc-12-design-v1&kind=pdf&download=1');
      T.check('the PDF, as a download under its name', res.status === 200 && res.headers['content-type'] === 'application/pdf' && /attachment; filename="abc-12-design-v1\.pdf"/.test(res.headers['content-disposition']) && res.buf.toString().indexOf('%PDF') === 0);
      res = await request(port, 'GET', '/__fdd/design-file?id=abc-12-design-v1&kind=html');
      T.check('…its HTML inline, nothing in it may run (CSP)', res.status === 200 && /inline/.test(res.headers['content-disposition']) && /default-src 'none'/.test(res.headers['content-security-policy'] || '') && /Functional &amp; technical design/.test(res.buf.toString()));
      res = await request(port, 'GET', '/__fdd/design-file?id=abc-12-design-v1&kind=pdf', null, { 'X-Build-Rite-FDD': '0' });
      T.check('…not from Build.Rite (no header): refused', res.status === 403);
      res = await request(port, 'POST', '/__fdd/design-open', { id: 'abc-12-design-v1', kind: 'pdf' });
      T.check('open in this PC\'s reader: the desktop app only (said)', res.json && !res.json.ok && /needs the desktop app/.test(res.json.error));
      const noPdf = await DS.createDevServer({ buildDir: path.join(ROOT, 'build'), webApp: 'buildrite', port: port + 1, fddStore: fd, aiStore, analysisStore, pagesStore, onLog: () => {} });
      try {
        res = await request(port + 1, 'POST', '/__fdd/design', body);
        T.check('no PDF printer (npm run serve): HTML and Markdown saved, v2, said why', res.json && res.json.ok && res.json.doc.version === 2 && !res.json.doc.files.pdf && /only in the desktop app/.test(res.json.pdfError));
      } finally { await noPdf.close(); }
      const failing = await DS.createDevServer({ buildDir: path.join(ROOT, 'build'), webApp: 'buildrite', port: port + 2, fddStore: fd, analysisStore, pagesStore,
        aiStore: { chat: async () => ({ ok: false, needsSetup: true, error: 'No API key for Claude (Anthropic) is saved on this PC: enter it in Tools → AI settings.' }) }, onLog: () => {} });
      try {
        res = await request(port + 2, 'POST', '/__fdd/design', body);
        T.check('the AI not set up: its words back, nothing saved', res.json && !res.json.ok && res.json.needsSetup && /Tools → AI settings/.test(res.json.error) && fd.designs('ABC-12').length === 2);
      } finally { await failing.close(); }
      res = await request(port, 'POST', '/__fdd/design-remove', { id: 'abc-12-design-v2' });
      T.check('delete', res.json && res.json.ok && fd.designs('ABC-12').length === 1);
    } finally {
      await srv.close();
    }
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    tmp.forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* tmp */ } });
  }
  T.report();
})();
