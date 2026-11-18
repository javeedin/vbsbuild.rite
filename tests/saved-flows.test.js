#!/usr/bin/env node
'use strict';
/**
 * Saved flows: the flow model (webApps/buildrite/resources/js/flowModel.js) and the store (desktop/lib/savedFlows.js),
 * on the sample app's scan — plain English (a call as a sentence, what sets it off in words); a flow made from a page
 * (its systems as lanes, its actions and calls as steps), drawn in swimlanes (technical and plain, a step's own words and
 * notes shown); edited (words, notes, steps moved / added by hand / removed, actions, lanes); checked against the app
 * (a step the page no longer makes, a call it makes that the flow lacks; added back); printed; saved (FL-0001, the
 * version before kept, a copy, comments resolved and removed, history), listed and searched, removed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const I = require('../desktop/lib/integrations');
const SF = require('../desktop/lib/savedFlows');

const T = H.makeAsserter();
const JS = path.join(__dirname, '..', 'webApps', 'buildrite', 'resources', 'js');
let D = null, M = null;
new Function('define', fs.readFileSync(path.join(JS, 'integrationDiagram.js'), 'utf8'))((deps, f) => { D = f(); });
new Function('define', fs.readFileSync(path.join(JS, 'flowModel.js'), 'utf8'))((deps, f) => { M = f(D); });
const m = I.scan(path.join(__dirname, 'fixtures', 'vb-sample'));
const NO = 'shop/orders/order-create';

T.section('plain English');
T.eq('a call as a sentence: read, create, update, delete, a report, an integration, an action on an object, a child, a list of values',
  [{ method: 'GET', object: 'Bu org mappings', systemName: 'Our backend', direction: 'Read' }, { method: 'POST', object: 'Orders', systemName: 'Shop', direction: 'Write' },
    { method: 'PATCH', object: 'Purchase requisitions', systemName: 'Oracle Fusion', direction: 'Write' }, { method: 'DELETE', object: 'Staging', systemName: 'Shop', direction: 'Write' },
    { method: 'POST', object: 'Customers report (CUSTOMERS_RP)', systemName: 'BI Publisher', direction: 'Report', kind: 'bip' }, { method: 'POST', object: 'Project (integration)', systemName: 'OIC', direction: 'Write' },
    { method: 'POST', object: 'Equipment import', action: 'promote', systemName: 'Shop', direction: 'Write' }, { method: 'GET', object: 'Sales orders › lines', systemName: 'Oracle Fusion', direction: 'Read' },
    { method: 'GET', object: 'Projects LOV', systemName: 'Oracle Fusion', direction: 'Read' }].map((c) => D.plainStep(c).sentence).join(' | '),
  'Reads the BU org mappings from Our backend | Creates the orders in Shop | Updates the purchase requisitions in Oracle Fusion | Deletes the staging from Shop | Runs the customers report in BI Publisher (CUSTOMERS_RP)'
    + ' | Starts the Project integration in OIC | Promotes the equipment import in Shop | Reads the lines of sales orders from Oracle Fusion | Reads the list of projects from Oracle Fusion');
T.eq('what sets it off, in words', ['when the page opens', '"Fetch" (button)', 'the page\'s data (a table or list loads it)', '"oj-table: first selected row changed" (button)', 'run by SyncFromFusionChain',
  '"Edit" (button); "Submit" (button); "Delete" (button)', '"Project: value item changed" (button); when the page opens'].map(D.plainTrigger).join(' | '),
  'When the page opens | When the user clicks "Fetch" | When the page\'s list loads | When the user selects a row | When the page runs "Sync from fusion" | When the user clicks "Edit", "Submit" or "Delete"'
    + ' | When the user changes the project or when the page opens');
const plainSvg = D.pageFlow(m, NO, { plain: true }).svg;
T.check('the page\'s flow in plain English: sentences, what sets it off in words, no paths or chains', />When the page opens</.test(plainSvg) && /fill="#1d4f91">Reads</.test(plainSvg) && />the customers</.test(plainSvg)
  && />Runs</.test(plainSvg) && />When the user clicks</.test(plainSvg) && />&quot;Submit&quot;</.test(plainSvg) && !/\/shop\/v1\/customers</.test(plainSvg) && !/>LoadCustomersChain</.test(plainSvg), plainSvg.slice(0, 200));

T.section('a flow made from a page');
const f0 = M.fromPage(m, NO, { name: 'Order intake', purpose: 'How a new order is taken', area: 'Sales', owner: 'Priya Raman', status: 'review', story: 'ABC-12', tags: 'orders, intake' });
T.check('its details, its source page, its systems as lanes, its actions and calls as steps', f0.name === 'Order intake' && f0.status === 'review' && f0.tags.join() === 'orders,intake' && f0.source.page === NO && f0.source.pageLabel === 'New Order'
  && f0.lanes.map((l) => l.id).join() === 'shop,bipService' && f0.actions.length === 2 && f0.actions[0].steps.map((s) => s.system + ':' + s.method).join() === 'shop:GET,bipService:POST' && f0.actions[1].steps[0].row === 'INT-0004', JSON.stringify(f0).slice(0, 400));
T.check('…no name given: the page\'s', M.fromPage(m, NO, {}).name === 'New Order flow' && M.fromPage(m, 'nope', {}) === null);
const md = M.toModel(f0);
T.check('its drawing\'s model: the name, status, steps, a lane name on each call', md.label === 'Order intake' && md.kicker === 'In review' && md.sub === 'New Order · 3 steps' && md.actions[0].calls[1].systemName === 'Oracle BI Publisher (SOAP)');

T.section('editing');
let f = M.edit(f0, 'set', { what: 'a.a1.title', value: 'When a clerk opens a new order' });
f = M.edit(f, 'set', { what: 's.s1.text', value: 'Looks up the customer list' });
f = M.edit(f, 'set', { what: 's.s2.note', value: 'Credit status comes from this report' });
f = M.edit(f, 'addLane', { name: 'E-mail', kind: 'email' });
f = M.edit(f, 'addStep', { action: 'a2', system: 'e-mail', text: 'E-mails the order confirmation to the customer' });
f = M.edit(f, 'addAction', { title: 'Every night' });
f = M.edit(f, 'set', { what: 'name', value: 'Order intake and confirmation' });
T.check('reworded, a note, a lane and a step added by hand, an action added; the original untouched', f.actions[0].title === 'When a clerk opens a new order' && f.actions[0].steps[0].text === 'Looks up the customer list'
  && f.actions[0].steps[1].note === 'Credit status comes from this report' && f.lanes[2].id === 'e-mail' && f.lanes[2].kindLabel === 'E-mail' && f.actions[1].steps[1].manual && f.actions[1].steps[1].id === 's4'
  && f.actions.length === 3 && f.actions[2].title === 'Every night' && f.name === 'Order intake and confirmation' && f0.actions[0].title === '' && f0.lanes.length === 2, JSON.stringify(f.actions).slice(0, 300));
let g = M.edit(f, 'moveStep', { id: 's2', by: -1 });
T.check('a step moved up', g.actions[0].steps.map((s) => s.id).join() === 's2,s1');
g = M.edit(g, 'moveStep', { id: 's2', by: -1 });
T.check('…up out of the first action: stays first (no action before)', g.actions[0].steps[0].id === 's2');
g = M.edit(g, 'moveStep', { id: 's4', by: 1 });
T.check('…down out of an action: the start of the next one', g.actions[1].steps.map((s) => s.id).join() === 's3' && g.actions[2].steps.map((s) => s.id).join() === 's4');
g = M.edit(g, 'removeLane', { id: 'e-mail' });
T.check('a lane with steps stays; an empty one goes', g.lanes.length === 3 && M.edit(M.edit(f, 'addLane', { name: 'Fax' }), 'removeLane', { id: 'fax' }).lanes.length === 3 && M.laneUsed(g, 'e-mail'));
g = M.edit(M.edit(g, 'removeStep', { id: 's4' }), 'removeAction', { id: 'a3' });
T.check('a step and an action removed; an action moved', g.actions.length === 2 && !g.actions.some((a) => a.steps.some((s) => s.id === 's4')) && M.edit(g, 'moveAction', { id: 'a2', by: -1 }).actions[0].id === 'a2');
const swT = D.flowSwim(M.toModel(f), {}).svg, swP = D.flowSwim(M.toModel(f), { plain: true }).svg;
T.check('drawn: the step added by hand in its own lane (E-mail), its own words (two lines); the note shown; the reworded action', />E-mail</.test(swT) && />E-mails the order</.test(swT) && />confirmation to the customer</.test(swT)
  && /<title>Note: Credit status comes from this report<\/title>/.test(swT) && />Note: Credit status comes from this/.test(swP) && />Looks up the customer list</.test(swP) && />When a clerk opens a new</.test(swP) && />order</.test(swP), swP.slice(0, 200));

T.section('descriptions and sticky notes');
T.eq('a step\'s and an action\'s automatic wording', M.autoText(f0, 's1') + ' | ' + M.autoTitle(f0, 'a2'), 'Reads the customers from The shop\'s REST backend | When the user clicks "Submit"');
let w = M.edit(f0, 'set', { what: 's.s1.text', value: 'Reads the customers from The shop\'s REST backend' });
w = M.edit(w, 'set', { what: 'a.a2.title', value: 'When the user clicks "Submit"' });
T.check('a description left as it started (the automatic wording): kept empty, so it follows the app', w.actions[0].steps[0].text === '' && w.actions[1].title === '');
w = M.edit(w, 'set', { what: 's.s1.text', value: 'Reads the customer list (with their credit)' });
T.check('…edited: kept in your words', w.actions[0].steps[0].text === 'Reads the customer list (with their credit)');
let sn = M.edit(f0, 'addSticky', { action: 'a1', lane: 'bipService', text: 'BI Publisher is slow at month end — the page waits for it.' });
sn = M.edit(sn, 'addSticky', { action: '', text: 'Reviewed with the sales team.', color: 'blue' });
sn = M.edit(sn, 'set', { what: 'n.n1.color', value: 'pink' });
sn = M.edit(sn, 'set', { what: 'n.n2.color', value: 'purple' });
T.check('sticky notes: one on an action in a lane, one on the whole flow; a colour set (an unknown one: yellow)', sn.stickies.length === 2 && sn.stickies[0].action === 'a1' && sn.stickies[0].lane === 'bipService' && sn.stickies[0].color === 'pink'
  && sn.stickies[1].action === '' && sn.stickies[1].color === 'yellow' && !f0.stickies, JSON.stringify(sn.stickies));
const sw = D.flowSwim(M.toModel(sn), { plain: true }).svg;
const at = (t) => { const mm = new RegExp('<title>Sticky note: ' + t + '[^<]*</title><path d="M(\\d+(?:\\.\\d+)?) (\\d+(?:\\.\\d+)?)').exec(sw); return mm ? { x: Number(mm[1]), y: Number(mm[2]) } : null; };
const n1 = at('BI Publisher is slow'), n2 = at('Reviewed with');
const firstPill = Number((/<rect x="36" y="(\d+(?:\.\d+)?)" width="196"/.exec(sw) || [])[1]);
T.check('drawn: the action\'s note in BI Publisher\'s lane (under its step), the whole flow\'s at the top, above the first action; the text and the colour', !!n1 && !!n2 && n1.x >= 660 && n2.y < firstPill && n1.y > firstPill
  && /fill="#ffdbe4"/.test(sw) && />BI Publisher is slow at month end/.test(sw), JSON.stringify({ n1, n2, firstPill }));
T.check('…in the technical drawing too', /<title>Sticky note: BI Publisher is slow/.test(D.flowSwim(M.toModel(sn), {}).svg));
const gone = M.edit(sn, 'removeAction', { id: 'a1' });
T.check('an action removed: its sticky note stays, on the whole flow', gone.stickies.length === 2 && gone.stickies[0].action === '');
let ln = M.edit(M.edit(f0, 'addLane', { name: 'Fax' }), 'addSticky', { action: 'a1', lane: 'fax', text: 'x' });
ln = M.edit(ln, 'removeLane', { id: 'fax' });
T.check('a lane removed: its sticky notes move to the page\'s lane', ln.stickies[0].lane === '' && ln.lanes.length === 2);
T.check('…removed', M.edit(sn, 'removeSticky', { id: 'n1' }).stickies.map((x) => x.id).join() === 'n2');
T.check('…printed: Sticky notes, where each sits', /<h2>Sticky notes<\/h2>/.test(M.html(sn, {})) && /Action 1 · Oracle BI Publisher \(SOAP\)/.test(M.html(sn, {})) && /On the whole flow/.test(M.html(sn, {})));

T.section('sticky notes placed by hand (dragged on the Flow tab)');
const live = D.flowSwim(M.toModel(sn), { plain: true, live: true });
T.check('live: the notes not drawn (the page draws them over it, to drag) — where each one is, said', !/<title>Sticky note:/.test(live.svg) && live.notes.length === 2 && live.notes.every((x) => !x.free && x.w > 0 && x.h > 0)
  && live.bands.length === 2 && live.bands[0].action === 0, JSON.stringify(live.notes));
// the whole flow's note (n2, in the band at the top) dropped over action 1's step, 20 below its band's top
const band0 = live.bands[0];
const placedN = M.edit(sn, 'placeSticky', { id: 'n2', x: 400.4, y: band0.y + 20, w: 300, h: 140 });
const live2 = D.flowSwim(M.toModel(placedN), { plain: true, live: true });
const p2 = placedN.stickies.filter((x) => x.id === 'n2')[0];
T.check('placed: where it was dropped and its size (whole units); the band it took at the top is gone; it moved up with the band it was dropped on', p2.x === 400 && p2.w === 300 && p2.h === 140 && M.placed(p2)
  && live2.h < live.h && live2.bands[0].y < band0.y && p2.y === live2.bands[0].y + 20, JSON.stringify({ p2, b0: band0.y, b1: live2.bands[0].y }));
T.check('…drawn over everything there (not live), its size kept, its lines kept', /<title>Sticky note: Reviewed with the sales team/.test(D.flowSwim(M.toModel(placedN), {}).svg)
  && /<path d="M400 \d+ H700 V\d+/.test(D.flowSwim(M.toModel(placedN), {}).svg));
const lines3 = M.edit(placedN, 'set', { what: 'n.n2.text', value: 'Line one\nLine two\n\nLine four' });
const svg3 = D.flowSwim(M.toModel(lines3), {}).svg;
T.check('several lines: each kept (an empty one too), not run together', />Line one</.test(svg3) && />Line two</.test(svg3) && />Line four</.test(svg3) && D.noteLines('Line one\nLine two\n\nLine four', 300, 8).join('|') === 'Line one|Line two||Line four');
T.eq('a long text in a small note: cut with … to fit its height', D.noteLines('one two three four five six seven eight nine ten eleven twelve', 110, 2).length + ' ' + /…$/.test(D.noteLines('one two three four five six seven eight nine ten eleven twelve', 110, 2)[1]), '2 true');
const moved2 = M.edit(placedN, 'placeSticky', { id: 'n2', x: 20, y: 30, w: 10, h: 99999 });
const q2 = moved2.stickies.filter((x) => x.id === 'n2')[0];
T.check('moved again: no band moves (it took no room) — where it was dropped; its size kept within limits', q2.x === 20 && q2.y === 30 && q2.w === 80 && q2.h === 1200, JSON.stringify(q2));
const beyond = D.flowSwim(M.toModel(M.edit(placedN, 'placeSticky', { id: 'n2', x: 3000, y: 2000, w: 230, h: 100 })), {});
T.check('…placed beyond the diagram: the drawing grows to hold it', beyond.w >= 3242 && beyond.h >= 2112, beyond.w + 'x' + beyond.h);
const backN = M.edit(placedN, 'set', { what: 'n.n2.action', value: 'a1' });
T.check('an action chosen on Edit steps: back under its steps, laid out (no longer where it was dragged); "where it was dragged" chosen: as it is', !M.placed(backN.stickies.filter((x) => x.id === 'n2')[0])
  && M.placed(M.edit(placedN, 'set', { what: 'n.n2.action', value: '__placed' }).stickies.filter((x) => x.id === 'n2')[0]));
const addedFree = M.edit(sn, 'addSticky', { x: 262, y: 90, w: 230, h: 110 });
T.check('added on the Flow tab: placed where you look', M.placed(addedFree.stickies[2]) && addedFree.stickies[2].x === 262 && addedFree.stickies[2].h === 110);
T.check('…printed: "Placed on the diagram", its lines kept', /Placed on the diagram/.test(M.html(lines3, {})) && /white-space:pre-wrap">Line one\nLine two/.test(M.html(lines3, {})));
const cleanFlow = SF.open({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'br-sfn-')) });
const sv = cleanFlow.save(Object.assign({}, M.blank({ name: 'Notes' }), { stickies: [{ id: 'n1', text: 'a', x: 12.6, y: 'x', w: 50, h: 5000 }, { id: 'n2', text: 'b', x: 10.2, y: 20.7, w: 50, h: 5000 }] }), 'Priya Raman');
T.check('the store keeps a note\'s place and size only when it has both numbers, within limits', sv.ok && sv.flow.stickies[0].x === undefined && sv.flow.stickies[1].x === 10 && sv.flow.stickies[1].y === 21 && sv.flow.stickies[1].w === 80 && sv.flow.stickies[1].h === 1200,
  JSON.stringify(sv.flow && sv.flow.stickies));

T.section('checked against the app');
T.check('the flow just made: matches the app', M.check(f0, m).ok && M.check(f0, m).same === 3);
const less = M.edit(f0, 'removeStep', { id: 's3' });
const r1 = M.check(less, m);
T.check('a call the page makes that the flow lacks: found', !r1.ok && r1.added.length === 1 && /POST \/shop\/v1\/orders/.test(r1.added[0].label) && r1.missing.length === 0 && /1 new call the flow does not have/.test(r1.text), JSON.stringify(r1));
const back = M.addFromApp(less, m);
T.check('…added back under the action that makes it ("Submit")', M.check(back, m).ok && back.actions[1].steps.some((s) => s.method === 'POST' && s.note === 'Added from the app'));
const odd = JSON.parse(JSON.stringify(f0));
odd.actions[0].steps[0].endpoint = 'shopApi/goneAway';
const r2 = M.check(odd, m);
T.check('a step the page no longer makes: found (and the call it makes instead)', !r2.ok && r2.missing.length === 1 && r2.missing[0].id === 's1' && r2.added.length === 1, JSON.stringify(r2));
T.check('a page that makes no call now; a flow drawn by hand', M.check(Object.assign({}, f0, { source: { kind: 'page', page: 'shop/x/y', pageLabel: 'Y' } }), m).pageGone && M.check(M.blank({ name: 'X' }), m).skipped);
const doc = M.html(f, { plain: true });
T.check('printed: its details, the diagram, its steps (what happens, system, note), plain without the technical column', /^<!doctype html>/.test(doc) && /<h1>Order intake and confirmation<\/h1>/.test(doc) && /<svg/.test(doc) && /Looks up the customer list/.test(doc)
  && /Credit status comes from this report/.test(doc) && !/<th>Technical<\/th>/.test(doc) && /<th>Technical<\/th>/.test(M.html(f, {})));

T.section('the store');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-flows-'));
try {
  let clock = Date.parse('2026-11-18T10:00:00Z');
  const st = SF.open({ dir, now: () => new Date(clock) });
  T.check('no name: refused', !st.save(Object.assign({}, f0, { name: ' ' }), 'Priya').ok);
  const a = st.save(f0, 'Priya Raman', { note: 'first cut' });
  T.check('saved: FL-0001, version 1, who and when, the history', a.ok && a.flow.id === 'FL-0001' && a.flow.version === 1 && a.flow.createdBy === 'Priya Raman' && a.flow.history[0].what === 'created' && /from the page New Order/.test(a.flow.history[0].note), JSON.stringify(a).slice(0, 300));
  clock += 60000;
  const b = st.save(Object.assign({}, f, { id: 'FL-0001' }), 'Sam Lee', { note: 'added the e-mail step' });
  T.check('saved again: version 2, the version before kept, what changed said', b.ok && b.flow.version === 2 && b.flow.versions.length === 1 && b.flow.versions[0].v === 1 && b.flow.versions[0].name === 'Order intake'
    && /added the e-mail step/.test(b.flow.history[1].note) && /name: Order intake → Order intake and confirmation/.test(b.flow.history[1].note) && /3 → 4 steps/.test(b.flow.history[1].note), JSON.stringify(b.flow.history));
  T.check('…a step\'s own fields kept (its words, a note, by hand)', b.flow.actions[1].steps[1].manual && b.flow.actions[1].steps[1].text === 'E-mails the order confirmation to the customer' && b.flow.lanes[2].kind === 'email');
  const c = st.comment('FL-0001', { text: 'Who gets the confirmation if the customer has no e-mail?', step: 's4' }, 'Priya Raman');
  T.check('a comment on a step: kept at once, no new version', c.ok && c.flow.comments.length === 1 && c.flow.comments[0].step === 's4' && c.flow.version === 2 && !st.comment('FL-0001', { text: ' ' }, 'x').ok);
  const c2 = st.resolve('FL-0001', 'c1', true, 'Sam Lee');
  T.check('…resolved, by whom; removed', c2.ok && c2.flow.comments[0].resolved && c2.flow.comments[0].resolvedBy === 'Sam Lee' && st.uncomment('FL-0001', 'c1', 'Sam Lee').flow.comments.length === 0);
  const cp = st.save(Object.assign({}, b.flow, { name: 'Order intake — draft B' }), 'Priya Raman', { copy: true });
  T.check('saved as a copy: FL-0002, version 1, where it came from', cp.ok && cp.flow.id === 'FL-0002' && cp.flow.version === 1 && cp.flow.copiedFrom === 'FL-0001' && /copy of FL-0001/.test(cp.flow.history[0].what));
  const l = st.list('');
  T.check('the list: newest first, with counts (steps, actions, open comments, earlier versions), no earlier versions in it', l.ok && l.flows.map((x) => x.id).join() === 'FL-0002,FL-0001' && l.flows[1].steps === 4 && l.flows[1].versionCount === 1
    && l.flows[1].versions === undefined && l.flows[1].statusText === 'In review');
  T.check('…searched: words in its name, systems, tags, page', st.list('draft b').flows.length === 1 && st.list('e-mail').flows.length === 2 && st.list('intake orders').flows.length === 2 && st.list('nothing-like-it').flows.length === 0);
  T.check('a saved flow that is gone: said so', !st.save(Object.assign({}, f0, { id: 'FL-0099' }), 'x').ok && !st.get('FL-0099').ok);
  T.check('removed', st.remove('FL-0002').ok && st.list('').flows.length === 1);
  const withNotes = st.save(Object.assign({}, st.get('FL-0001').flow, { stickies: sn.stickies }), 'Priya Raman', { note: 'sticky notes' });
  T.check('sticky notes kept (a new version: they count as a change), in the version before too', withNotes.ok && withNotes.flow.stickies.length === 2 && withNotes.flow.stickies[0].color === 'pink' && withNotes.flow.version === 3
    && withNotes.flow.versions[withNotes.flow.versions.length - 1].stickies.length === 0, JSON.stringify(withNotes.flow.stickies));
  T.check('no workspace: said so', !SF.open({ dir: '' }).list('').ok);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
T.report();
