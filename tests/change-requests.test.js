/*
 * Change requests (desktop/lib/changeRequests.js): a change asked of one page, logged with who asked and why, then made
 * with Code Fix. Saved with the next CR number, its fields kept within their sizes, its status following its Code Fix
 * (or the state set by hand), the fixed date from the change saved, its history, the list found by words.
 *
 * Run:  node tests/change-requests.test.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const C = require('../desktop/lib/changeRequests');

const T = H.makeAsserter();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-cr-'));
let clock = new Date('2026-11-17T09:00:00.000Z');
const tick = () => { clock = new Date(clock.getTime() + 60000); return clock; };
const store = C.open({ dir: () => path.join(dir, 'crs'), now: () => tick() });
const fixes = {};
const fixOf = (id) => fixes[id] || null;

try {
  T.section('saved: the next CR number, the fields kept within their sizes');
  T.check('a page is needed, and what should change', !store.save({ title: 'x' }, 'ann').ok && /Pick the page/.test(store.save({ title: 'x' }, 'ann').error)
    && /Say what should change/.test(store.save({ page: 'shop/orders/order-create' }, 'ann').error));
  const a = store.save({ page: 'shop/orders/order-create', pageLabel: 'New Order', title: 'Home button before Next', request: 'Add a Home button before the Next button.', kind: 'enhance',
    priority: 'high', customer: 'Acme Corp', jira: 'ABC-12', issue: 'ISS-4', dueOn: '2026-11-20', requestedOn: '2026-11-16' }, 'priya.raman', fixOf);
  T.check('CR-0001, its fields, who asked (the person saving), created by them; its history says created', a.ok && a.request.code === 'CR-0001' && a.request.kindText === 'Enhance' && a.request.priorityText === 'High'
    && a.request.customer === 'Acme Corp' && a.request.requestedBy === 'priya.raman' && a.request.createdBy === 'priya.raman' && a.request.requestedOn === '2026-11-16' && a.request.dueOn === '2026-11-20'
    && a.request.events.length === 1 && a.request.events[0].what === 'created' && /CR-0001 — Home button before Next/.test(a.request.events[0].note), JSON.stringify(a.request).slice(0, 300));
  T.check('…status New (no Code Fix yet), state Open', a.request.status === 'new' && a.request.statusText === 'New' && a.request.stateText === 'Open');
  const b = store.save({ page: 'shop/orders/order-list', title: 'Wider table', kind: 'nonsense', priority: 'nope', jira: 'ABC-<script>13', dueOn: 'tomorrow', requestedBy: 'Sam Lee' }, 'priya.raman', fixOf);
  T.check('CR-0002; an unknown kind / priority as change / medium; a bad date left out; unsafe characters out of the refs; who asked as given', b.request.code === 'CR-0002' && b.request.kind === 'change'
    && b.request.priority === 'medium' && b.request.dueOn === '' && b.request.jira === 'ABC- script 13' && b.request.requestedBy === 'Sam Lee', JSON.stringify(b.request).slice(0, 300));
  const a2 = store.save({ id: a.request.id, state: 'hold', priority: 'urgent' }, 'dana', fixOf);
  T.check('saved again: the other fields kept; what changed written in its history (state, priority); updated by', a2.request.code === 'CR-0001' && a2.request.title === 'Home button before Next' && a2.request.customer === 'Acme Corp'
    && a2.request.statusText === 'On hold' && /state: Open → On hold; priority: High → Urgent/.test(a2.request.events[1].note) && a2.request.updatedBy === 'dana', JSON.stringify(a2.request.events));
  store.save({ id: a.request.id, state: 'open' }, 'dana', fixOf);

  T.section('its Code Fix: the status follows it; fixed when its change is saved');
  fixes.fx1 = { id: 'fx1', status: 'proposed' };
  let r = store.link(a.request.id, 'fx1', 'priya.raman', 'analyzed', fixOf);
  T.check('an attempt linked: Proposed, 1 attempt, written in its history', r.ok && r.request.status === 'proposed' && r.request.attempts === 1 && r.request.fixId === 'fx1' && r.request.events.slice(-1)[0].what === 'analyzed');
  fixes.fx2 = { id: 'fx2', status: 'applied' };
  r = store.link(a.request.id, 'fx2', 'priya.raman', 'asked again', fixOf);
  T.check('…asked again: the new attempt shown (2 attempts), Applied — testing', r.request.attempts === 2 && r.request.fixId === 'fx2' && r.request.statusText === 'Applied — testing');
  fixes.fx2 = { id: 'fx2', status: 'committed', commit: { sha: 'abc1234', at: '2026-11-18T10:00:00.000Z' }, applied: { by: 'dana' } };
  r = store.get(a.request.id, fixOf);
  T.check('its change saved: Fixed, fixed on the commit\'s day, by who applied it', r.request.status === 'fixed' && r.request.fixedOnShown === '2026-11-18' && r.request.fixedByShown === 'dana', JSON.stringify([r.request.fixedOnShown, r.request.fixedByShown]));
  r = store.event(a.request.id, 'saved in working', 'dana', 'commit abc1234', fixOf);
  T.check('…"saved in working" in its history fixes the date and who (kept)', r.request.fixedOn === '2026-11-17' && r.request.fixedBy === 'dana' && r.request.events.slice(-1)[0].note === 'commit abc1234', JSON.stringify([r.request.fixedOn, r.request.fixedBy]));
  fixes.fx2.status = 'undone';
  T.check('undone: Undone (the state set by hand still wins: rejected)', store.get(a.request.id, fixOf).request.statusText === 'Undone'
    && store.save({ id: a.request.id, state: 'rejected' }, 'dana', fixOf).request.statusText === 'Rejected');
  store.save({ id: a.request.id, state: 'open' }, 'dana', fixOf);
  T.check('a due date passed and not fixed: overdue', store.get(b.request.id, fixOf).request.overdue === false && store.save({ id: b.request.id, dueOn: '2026-11-01' }, 'x', fixOf).request.overdue === true);

  T.section('the list');
  const l = store.list('', fixOf);
  T.check('newest number first', l.ok && l.requests.map((x) => x.code).join() === 'CR-0002,CR-0001');
  T.check('found by words: a customer, a Jira story, a person, a code, a status', store.list('acme', fixOf).requests.length === 1 && store.list('abc-12', fixOf).requests[0].code === 'CR-0001'
    && store.list('sam lee', fixOf).requests[0].code === 'CR-0002' && store.list('cr-0002', fixOf).requests.length === 1 && store.list('undone', fixOf).requests[0].code === 'CR-0001');
  T.check('removed: gone from the list', store.remove(b.request.id).ok && store.list('', fixOf).requests.length === 1 && !store.get(b.request.id).ok);
  T.check('the next one still takes the next number (CR-0002 again is free: the highest kept + 1)', store.save({ page: 'p/q/r', title: 't' }, 'x', fixOf).request.code === 'CR-0002');
  const none = C.open({ dir: () => '' });
  T.check('no workspace: said so', !none.list('').ok && /Set up your workspace/.test(none.list('').error) && !none.save({ page: 'a', title: 'b' }).ok);
} finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
}
T.report();
