#!/usr/bin/env node
'use strict';
/**
 * A new page (Change requests → New page): Build.Rite learns how the app's menu and pages fit together from its own
 * code (desktop/lib/appMenu.js — the menu's groups and items with their routes, the flows and their pages, every place
 * a page is registered, the links from other pages kept apart), then Code Fix makes the page like an existing one and
 * links it the same way: the AI is told what to make, where the app registers a page (with the exact text of those
 * files) and the knowledge base; the checks hold it to that (its files made, every place linked, its menu label) — a
 * place left out is asked again; approving writes the files and the links, and the app's page list then has the page
 * with its menu entry. Wrong names, flows or groups are refused.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./_harness');
const AM = require('../desktop/lib/appMenu');
const CF = require('../desktop/lib/codeFix');
const scan = require('../desktop/lib/pageScan');

const T = H.makeAsserter();
const FIX = path.join(__dirname, 'fixtures', 'vb-sample');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const copyDir = (from, to) => { fs.mkdirSync(to, { recursive: true }); fs.readdirSync(from).forEach((f) => { const a = path.join(from, f), b = path.join(to, f); if (fs.statSync(a).isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b); }); };
const BILL = 'shop/customers/customer-billing';
const NEW = 'webApps/shop/flows/customers/pages/customer-statement-page';

T.section('the app\'s menu and pages, learnt from its code');
const m = AM.menu(FIX, 'shop');
T.check('the menu: its file, its groups and items, each item\'s route (flow and page)', m.found && m.file === 'webApps/shop/app-flow.js' && m.groups.map((g) => g.label + ' ' + g.items.length).join() === 'Customers 2,Orders 2'
  && m.groups[0].items[1].id === 'customer-billing' && m.groups[0].items[1].page === 'customers/customer-billing', JSON.stringify(m.groups));
T.eq('the flows and their pages', AM.flows(FIX, 'shop').map((f) => f.flow + ':' + f.pages.join('|')).join(' '), 'customers:customer-dashboard|customer-billing orders:order-list|order-detail|order-create');
const reg = AM.registrations(FIX, 'shop', { flow: 'customers', page: 'customer-billing' });
T.check('where My Billing is registered: its flow\'s page list, the menu — needed for a page like it; a page that opens it is a link, kept apart', reg.ref.navId === 'customer-billing' && reg.ref.group === 'Customers'
  && reg.places.filter((p) => p.needed).map((p) => p.file).join() === 'webApps/shop/flows/customers/customers-flow.json,webApps/shop/app-flow.js'
  && reg.places.filter((p) => !p.needed).map((p) => p.kind).join() === 'another page opens it (a link)', JSON.stringify(reg.places.map((p) => [p.file, p.kinds, p.needed])));
T.check('the excerpts: small files whole (exact text, to copy SEARCH from)', /=== FILE webApps\/shop\/app-flow\.js \(complete\) ===\n[\s\S]*NAV_GROUPS/.test(AM.excerpts(FIX, reg.places.filter((p) => p.needed))));
T.eq('a page name from a title', AM.kebab('Customer Statement & Notes!') + ' ' + AM.kebab('  2026 Report '), 'customer-statement-and-notes p-2026-report');
const big = 'const A = {\n' + Array.from({ length: 1200 }, (_, i) => "  'p" + i + "': 'value number " + i + "',").join('\n') + '\n};\n';
const tmpBig = fs.mkdtempSync(path.join(os.tmpdir(), 'br-np-big-'));
fs.writeFileSync(path.join(tmpBig, 'big.js'), big);
T.check('…a big file: only the lines around each place, said so', /=== FILE big\.js \(lines 192–208 of 1203, an excerpt\) ===\n {2}'p190'/.test(AM.excerpts(tmpBig, [{ file: 'big.js', lines: [{ n: 200 }] }])), AM.excerpts(tmpBig, [{ file: 'big.js', lines: [{ n: 200 }] }]).slice(0, 120));
fs.rmSync(tmpBig, { recursive: true, force: true });

(async () => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch (e) { T.check('git is installed (skipping)', true); T.report(); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'br-np-'));
  const A = path.join(tmp, 'project');
  try {
    copyDir(path.join(FIX, 'webApps'), path.join(A, 'webApps'));
    git(A, 'init', '-q', '-b', 'main'); git(A, 'config', 'user.name', 'Tester'); git(A, 'config', 'user.email', 'tester@example.com'); git(A, 'config', 'core.autocrlf', 'false');
    git(A, 'add', '-A'); git(A, 'commit', '-q', '-m', 'project');
    const flowJson = fs.readFileSync(path.join(A, 'webApps/shop/flows/customers/customers-flow.json'), 'utf8');
    const appFlow = fs.readFileSync(path.join(A, 'webApps/shop/app-flow.js'), 'utf8');
    const billItem = appFlow.split('\n').filter((l) => /id: 'customer-billing'/.test(l))[0];
    const flowEntry = /"customer-billing": \{\n\s*"path": "pages\/customer-billing-page"\n\s*\}/.exec(flowJson)[0];
    const files = (withMenu) => [
      '## Summary', 'A new Statements page, like My Billing.', '## How it works today', 'There is no statements page.', '## What changes', 'A new page, in the menu under Customers.',
      '## The change', '- three new files; the flow and the menu', '## After the change', 'Statements opens from the menu.', '## Risks', 'None known', '## How to test', '1. Open Customers › Statements.', '## Questions', 'None', '',
      'FILE: ' + NEW + '.html', '<<<<<<< SEARCH', '=======', '<div class="oj-flex">', '  <oj-sp-general-overview-page page-title="Statements">', '    <div slot="main">Statements</div>', '  </oj-sp-general-overview-page>', '</div>', '>>>>>>> REPLACE',
      'FILE: ' + NEW + '.js', '<<<<<<< SEARCH', '=======', "define([], () => { 'use strict'; class PageModule {} return PageModule; });", '>>>>>>> REPLACE',
      'FILE: ' + NEW + '.json', '<<<<<<< SEARCH', '=======', '{ "description": "Statements", "variables": {}, "eventListeners": {} }', '>>>>>>> REPLACE',
      'FILE: webApps/shop/flows/customers/customers-flow.json', '<<<<<<< SEARCH', flowEntry, '=======', flowEntry + ',\n    "customer-statement": {\n      "path": "pages/customer-statement-page"\n    }', '>>>>>>> REPLACE'
    ].concat(withMenu ? ['FILE: webApps/shop/app-flow.js', '<<<<<<< SEARCH', billItem, '=======', billItem + ",\n      { id: 'customer-statement', label: 'Statements', flow: 'customers', page: 'customer-statement' }", '>>>>>>> REPLACE'] : []).join('\n');
    const replies = [];
    const sent = [];
    const ai = { chat: async (req) => { sent.push(req); return { ok: true, text: replies.shift(), provider: 'Stand-in AI', model: 'test' }; }, settings: () => ({ active: 'x', catalog: [{ id: 'x', label: 'Stand-in AI' }] }) };
    const store = CF.open({ root: A, file: path.join(tmp, 'data', 'code-fixes.json'), ai: ai });

    T.section('the New page form: the menu, the flows, where a page like it goes');
    const am = store.appMenu({ id: BILL, group: 'customers', after: 'customer-billing' });
    T.check('appMenu(): the groups, the flows, the places a page in the menu is registered (like My Billing)', am.ok && am.menu.groups.length === 2 && am.flows.map((f) => f.flow).join() === 'customers,orders'
      && am.places.filter((p) => p.needed).length === 2 && am.ref.label === 'My Billing', JSON.stringify([am.error, am.places]));

    T.section('refused: a page that exists, a flow or group that does not, no title');
    const bad = async (np) => (await store.analyze({ id: BILL, request: 'x', kind: 'page', newPage: np })).error || '';
    T.check('an existing page name, a flow or a menu group not in the app, no title: each said, the AI not asked', /There is a page "customer-billing" in customers already/.test(await bad({ title: 'Billing', name: 'customer-billing', flow: 'customers' }))
      && /There is no flow "nope"/.test(await bad({ title: 'Some Page', flow: 'nope' })) && /There is no menu group "Nope"/.test(await bad({ title: 'Some Page', flow: 'customers', group: 'Nope' }))
      && /Give the new page a title/.test(await bad({ flow: 'customers' })) && sent.length === 0);

    T.section('asked: what to make, like which page, where the app registers it, the knowledge base');
    replies.push(files(false), files(true)); // first without the menu: the check says so, asked again
    const r = await store.analyze({ id: BILL, request: 'A statements page for customers.', kind: 'page', by: 'Asha',
      newPage: { title: 'Statements', name: 'customer-statement', flow: 'customers', group: 'customers', label: 'Statements', after: 'customer-billing' },
      knowledge: 'FDD 7.4 Customer statements: a list of the statements of the last 12 months, newest first; a PDF per statement.' });
    const q = sent[0].user;
    T.check('the AI was told: a NEW page (the existing one only a model), its three files, made like My Billing, in the menu under Customers after My Billing', /NEW PAGE — this request is for a NEW page\. Do not change the page above/.test(q)
      && q.indexOf(NEW + '.html, ' + NEW + '.js, ' + NEW + '.json') !== -1 && /Make it like PAGE My Billing/.test(q) && /under "Customers", labelled "Statements", right after "My Billing"/.test(q) && /REQUEST \(New page\)/.test(q), q.slice(0, 400));
    T.check('…how this app registers a page: the places, with the exact text of those files; the link from another page not among them', /HOW THIS APP REGISTERS A PAGE: the page My Billing \(page customers\/customer-billing, menu id customer-billing\)/.test(q)
      && /- webApps\/shop\/flows\/customers\/customers-flow\.json: its flow's list of pages/.test(q) && /- webApps\/shop\/app-flow\.js: the menu \(an item\)/.test(q) && /REGISTRATION FILES[\s\S]*=== FILE webApps\/shop\/app-flow\.js \(complete\) ===/.test(q)
      && !/- webApps\/shop\/flows\/customers\/pages\/customer-dashboard-page-chains/.test(q));
    T.check('…and the knowledge base given', /KNOWLEDGE BASE \(given by the person[\s\S]*FDD 7\.4 Customer statements/.test(q));
    T.check('the menu left out the first time: the check said so, asked again with that', sent.length === 2 && /the new page is linked in every place[\s\S]*not added in: webApps\/shop\/app-flow\.js/.test(sent[1].user), (sent[1] || {}).user ? sent[1].user.slice(-600) : '');
    const fx = r.fix;
    const npc = (fx && fx.checks || []).filter((c) => /new page|linked|in the menu/.test(c.name));
    T.check('proposed: the 3 new files and the 2 links; the new-page checks ✓ (files made, linked in both places, "Statements" under Customers)', r.ok && fx.status === 'proposed' && fx.retried && fx.files.length === 5
      && npc.length === 3 && npc.every((c) => c.ok) && fx.newPage.page === 'shop/customers/customer-statement' && fx.newPage.menu.group === 'Customers' && /FDD 7\.4/.test(fx.knowledge), JSON.stringify([r.error, fx && fx.status, npc, fx && fx.files]));
    T.check('…the page rules ran on the new page too', fx.checks.some((c) => c.file === NEW + '.html' && /Redwood page template/.test(c.name) && c.ok));
    T.check('…nothing written yet', !fs.existsSync(path.join(A, NEW + '.html')) && fs.readFileSync(path.join(A, 'webApps/shop/app-flow.js'), 'utf8') === appFlow);

    T.section('approved: written and saved; the app now has the page, in its menu');
    const ap = await store.apply({ fix: fx.id, skipPull: true, save: true, by: 'Asha' });
    T.check('applied and saved: the files made, the flow and the menu linked, one commit', ap.ok && ap.fix.status === 'committed' && fs.existsSync(path.join(A, NEW + '.json'))
      && /"customer-statement"/.test(fs.readFileSync(path.join(A, 'webApps/shop/flows/customers/customers-flow.json'), 'utf8')) && /id: 'customer-statement', label: 'Statements'/.test(fs.readFileSync(path.join(A, 'webApps/shop/app-flow.js'), 'utf8'))
      && git(A, 'status', '--porcelain') === '', JSON.stringify([ap.error, ap.fix && ap.fix.status]));
    const listed = scan.list(A).filter((p) => p.id === 'shop/customers/customer-statement')[0];
    T.check('…the app\'s pages list it, with its menu entry (Customers › Statements)', !!listed && /Statements/.test(listed.menu || ''), JSON.stringify(listed));
    const am2 = store.appMenu({ id: BILL });
    T.check('…and the menu shows it after My Billing', am2.menu.groups[0].items.map((i) => i.label).join() === 'Customer Dashboard,My Billing,Statements');
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  }
  T.report();
})();
