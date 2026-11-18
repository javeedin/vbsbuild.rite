#!/usr/bin/env node
'use strict';
/**
 * The AI Assistant's engine (desktop/lib/assistant.js) on the sample app: the words of a question; the lines of a file
 * around them; what is gathered (the app at a glance, the page named, its integration flow, the code that matches with
 * line numbers, saved flows and design sections for a process question; the scope and a chosen page); the question as
 * sent (numbered context, the conversation so far); the answer read back (the Sources line and the follow-ups taken out,
 * the items cited); a conversation kept (asked, followed up, asked again, renamed, removed); a file of the app shown
 * (never one outside it); questions to start with.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const A = require('../desktop/lib/assistant');
const I = require('../desktop/lib/integrations');
const SF = require('../desktop/lib/savedFlows');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, 'fixtures', 'vb-sample');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-asst-'));
(async () => {
try {
  T.section('the words of a question');
  T.eq('names kept and split, plurals tried singular, common words left out', A.terms('How does LoadCustomersChain call /shop/v1/customers on the order-create page?').join(','),
    'loadcustomerschain,load,customers,chain,call,/shop/v1/customers,shop,order-create,order,create,customer,/shop/v1/customer');
  T.eq('…"status" stays status', A.terms('the credit status').join(','), 'credit,status');

  T.section('the lines around them');
  const text = ['line one', 'const a = 1;', 'function loadCustomers() {', '  return callRest("shopApi/getCustomers");', '}', 'x', 'y', 'z', 'w', 'v', 'u', 'credit check here', 'end'].join('\n');
  T.eq('numbered as the editor shows them, ±pad lines, windows in order with … between', A.snippets(text, ['customers', 'credit'], { pad: 1 }),
    '2: const a = 1;\n3: function loadCustomers() {\n4:   return callRest("shopApi/getCustomers");\n…\n11: u\n12: credit check here\n13: end');

  T.section('what is gathered');
  const flows = SF.open({ dir: path.join(dir, 'flows') });
  flows.save({ name: 'Order to cash', purpose: 'How an order is taken, invoiced and paid.', area: 'Sales', status: 'approved', lanes: [{ id: 'shop', name: 'Shop REST', kind: 'rest' }],
    actions: [{ id: 'a1', trigger: 'when the page opens', title: 'The clerk opens a new order', steps: [{ id: 's1', system: 'shop', method: 'GET', path: '/shop/v1/customers', endpoint: 'shopApi/getCustomers', object: 'Customers', direction: 'Read', text: 'Reads the customers and their credit' }] }],
    stickies: [{ id: 'n1', text: 'Credit hold blocks the invoice', color: 'pink' }] }, 'Priya Raman');
  const fddRoot = path.join(dir, 'fddroot');
  fs.mkdirSync(path.join(fddRoot, 'webApps/buildrite/resources/fdd'), { recursive: true });
  fs.writeFileSync(path.join(fddRoot, 'webApps/buildrite/resources/fdd/D1.json'), JSON.stringify({ id: 'D1', sections: [{ n: '4.2', t: 'Invoicing an order', l: 2, x: 'An order is invoiced once it ships. A customer on credit hold is not invoiced until the hold is released.' }, { n: '4.3', t: 'Returns', l: 2, x: 'Returns are credited.' }] }));
  const fdd = { root: fddRoot, info: () => ({ ok: true, docs: [{ id: 'D1', name: 'Shop FDD', version: '1.7' }] }) };
  const asked = [];
  let answer = 'The page reads the customers in **LoadCustomersChain** [3], then runs CUSTOMERS_RP [5].\n\n## Steps\n1. GET /shop/v1/customers\n\nSources: [3], [5], [99]\n```followups\n- What does CUSTOMERS_RP return?\n- Where is the credit shown?\n- 3) How is the order saved?\n```';
  const ai = { chat: async (req) => { asked.push(req); return answer === null ? { ok: false, error: 'No API key for OpenAI is saved on this PC', needsSetup: true } : { ok: true, text: answer, provider: 'Stand-in', model: 'test-1', ms: 12 }; } };
  const st = A.open({ dir: path.join(dir, 'convs'), root: ROOT, flows, fdd, ai, scan: I.scan });
  const g = st.gather('How does the New Order page load the customers and their credit status?', {});
  const kinds = g.items.map((x) => x.kind + ':' + x.label);
  T.check('the app at a glance first; the page named (its facts from the code); its integration flow; the code that matches', /^app:The app at a glance: shop$/.test(kinds[0]) && kinds[1] === 'page:Page: New Order'
    && g.items[1].text.indexOf('LoadCustomersChain (on vbEnter)') !== -1 && g.items[1].text.indexOf('GET /shop/v1/customers (shopApi/getCustomers)') !== -1
    && kinds.indexOf('pageflow:Integration flow of the page New Order') !== -1 && kinds.indexOf('file:webApps/shop/flows/orders/pages/order-create-page-chains/LoadCustomersChain.js') !== -1, JSON.stringify(kinds));
  const lcc = g.items.filter((x) => x.label === 'webApps/shop/flows/orders/pages/order-create-page-chains/LoadCustomersChain.js')[0];
  T.check('…the file with its line numbers, and where it starts', /^\d+: /.test(lcc.text) && /shopApi\/getCustomers/.test(lcc.text) && lcc.ref.type === 'file' && lcc.ref.line >= 1, lcc.text.slice(0, 120));
  T.check('…numbered, within the budget', g.items.every((x, i) => x.n === i + 1) && g.chars <= 48000 && g.chars > 1000);
  const gp = st.gather('How is an order invoiced when the customer is on credit hold?', { scope: 'process' });
  const kp = gp.items.map((x) => x.kind);
  T.check('a process question: the saved flow (its steps and notes) and the design sections that match; no code files', kp.indexOf('flow') !== -1 && kp.indexOf('fdd') !== -1 && kp.indexOf('file') === -1
    && /Credit hold blocks the invoice/.test(gp.items.filter((x) => x.kind === 'flow')[0].text) && /4\.2 Invoicing an order/.test(gp.items.filter((x) => x.kind === 'fdd')[0].label), JSON.stringify(gp.items.map((x) => x.label)));
  const gc = st.gather('which endpoint loads orders', { scope: 'code' });
  T.check('scope code: pages and files, no interfaces or flows', gc.items.every((x) => ['app', 'page', 'file'].indexOf(x.kind) !== -1) && gc.items.some((x) => x.kind === 'file'));
  const gpg = st.gather('what does it do?', { page: 'shop/orders/order-detail' });
  T.check('a page chosen: it is in, whatever the words', gpg.items.some((x) => x.kind === 'page' && x.ref.id === 'shop/orders/order-detail'));

  T.section('the question as sent; the answer read back');
  const pr = A.prompt('And the report?', g.items.slice(0, 2), [{ q: 'How does it load?', a: { text: 'It calls GET.' } }], { scope: 'code', pageLabel: 'New Order' });
  T.check('numbered context, the scope and page, the conversation so far, the question', /^CONTEXT \(gathered from the workspace, scope: code, about the page New Order\)/.test(pr) && /\[1\] The app at a glance/.test(pr) && /\[2\] Page: New Order/.test(pr)
    && /CONVERSATION SO FAR\n\nQ: How does it load\?\nA: It calls GET\./.test(pr) && /QUESTION\nAnd the report\?$/.test(pr));
  T.check('the system prompt asks for the format (direct answer, sections, tables, code, callouts, flows) and for sources and follow-ups', /\*\*bold\*\*/.test(A.SYSTEM) && /```flow/.test(A.SYSTEM) && /\[!WARNING\]/.test(A.SYSTEM) && /Sources:/.test(A.SYSTEM) && /```followups/.test(A.SYSTEM) && /never invent/.test(A.SYSTEM));
  const pa = A.parse(answer, g.items);
  T.check('read back: the Sources line and the follow-ups out of the text; the items cited (an unknown number dropped); the follow-ups cleaned', !/Sources:/.test(pa.text) && !/followups/.test(pa.text) && /## Steps/.test(pa.text)
    && pa.cited.join() === '3,5' && pa.followups.join('|') === 'What does CUSTOMERS_RP return?|Where is the credit shown?|How is the order saved?', JSON.stringify(pa));
  T.eq('…inline citations count too, a bold Sources line too', A.parse('Yes [2].\n\n**Sources:** none', g.items).cited.join() + '|' + A.parse('Yes [2].\n\n**Sources:** none', g.items).text, '2|Yes [2].');

  T.section('a conversation');
  const r1 = await st.ask({ question: 'How does the New Order page load the customers and their credit status?', by: 'Priya Raman' });
  T.check('asked: the AI of the feature "AI Assistant", the system prompt, the context; the answer kept with what was looked at', r1.ok && asked[0].feature === 'assistant' && asked[0].system === A.SYSTEM && /\[2\] Page: New Order/.test(asked[0].user)
    && r1.conv.turns.length === 1 && r1.turn.a.cited.join() === '3,5' && r1.turn.a.followups.length === 3 && r1.turn.a.provider === 'Stand-in' && r1.turn.looked.length === g.items.length && /^C-/.test(r1.conv.id) && r1.conv.title.indexOf('How does the New Order') === 0);
  const r2 = await st.ask({ question: 'And what does the report give back?', convId: r1.conv.id });
  T.check('followed up: the conversation so far sent; the earlier question\'s words help find the context', r2.ok && /CONVERSATION SO FAR\n\nQ: How does the New Order page/.test(asked[1].user) && r2.conv.turns.length === 2 && r2.turn.looked.some((x) => x.kind === 'page' && /New Order/.test(x.label)));
  answer = 'Another answer.\n\nSources: none';
  const r3 = await st.ask({ convId: r1.conv.id, redo: true });
  T.check('asked again (the last question): replaced, not added', r3.ok && r3.conv.turns.length === 2 && r3.turn.q === 'And what does the report give back?' && r3.turn.a.text === 'Another answer.');
  answer = null;
  const r4 = await st.ask({ question: 'One more?', convId: r1.conv.id });
  T.check('the AI not set up: said, kept in the conversation', !r4.ok && /No API key/.test(r4.error) && r4.needsSetup && r4.conv.turns.length === 3 && /No API key/.test(r4.conv.turns[2].a.error));
  const l = st.list();
  T.check('listed (newest first), renamed, read back', l.ok && l.convs.length === 1 && l.convs[0].turns === 3 && st.rename(r1.conv.id, 'Customers and credit').ok && st.get(r1.conv.id).conv.title === 'Customers and credit');
  T.check('nothing to ask, or no workspace: said', !(await st.ask({ question: '  ' })).ok && !(await A.open({ dir: '', root: ROOT, ai }).ask({ question: 'x' })).ok && !(await A.open({ dir: path.join(dir, 'c2'), root: ROOT }).ask({ question: 'x' })).ok);
  T.check('removed', st.remove(r1.conv.id).ok && st.list().convs.length === 0 && !st.get(r1.conv.id).ok);

  T.section('a file of the app; questions to start with');
  const f = st.file('webApps/shop/flows/orders/pages/order-create-page-chains/LoadCustomersChain.js');
  T.check('a file shown whole', f.ok && /LoadCustomersChain/.test(f.text) && f.lines > 5);
  T.check('…never one outside the app, nor one it does not read', !st.file('../../package.json').ok && !st.file('/etc/passwd').ok && !st.file('webApps/shop/x.exe').ok);
  const sg = st.suggestions();
  T.check('questions from the app itself (its pages and systems), its pages to choose from', sg.ok && sg.questions.length >= 4 && sg.questions.some((q) => /page work, step by step\?$/.test(q)) && sg.questions.some((q) => /^Which pages call /.test(q)) && sg.pages.some((p) => p.label === 'New Order'), JSON.stringify(sg.questions));
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
T.report();
})();
