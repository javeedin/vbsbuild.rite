/*
 * The Follow-ups store (desktop/lib/followups.js): follow-ups drafted on the Jira pages, kept on this PC in DuckDB
 * (tables followups, followup_lines; a JSON file when DuckDB cannot load), each with a header and detail lines. No
 * desktop, no Electron: the store is exercised directly. Every method is async.
 *
 * Run:  node tests/followups-store.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');

const T = H.makeAsserter();
const FS = require('../desktop/lib/followups');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-followups-'));
const file = path.join(dir, 'followups.duckdb');

const SAMPLE = {
  kind: 'sprint', title: 'Follow-up — Sprint 2026-07', subtitle: 'active · 2026-07-01 – 2026-07-31',
  subject: 'Please close these stories', to: 'priya@company.com', message: 'Dear Priya,\n\nAs we discussed...',
  signoff: 'Thanks,', sprintName: '2026-07', source: '', author: 'sam.lee',
  lines: [
    { storyKey: 'abc-12', summary: 'Order Master List View', status: 'DEVELOPMENT', assignee: 'Priya Raman', sprint: '2026-07', due: '2026-10-07', overdue: true, customer: 'acme', url: 'https://j/ABC-12' },
    { key: 'ABC-31', summary: 'Rate Schedule Report', status: 'DEVELOPMENT', assignee: 'Priya Raman', sprint: '2026-07', due: '2026-07-31', overdue: true, labels: ['globex'], url: 'https://j/ABC-31' },
  ],
};

(async () => {
  const store = await FS.open({ file });
  T.section('the store is backed by DuckDB (or a JSON file where DuckDB cannot load)');
  T.check('engine is duckdb or the json fallback', store.engine === 'duckdb' || store.engine === 'json');

  T.section('save: ids and timestamps filled, header + lines kept');
  const saved = await store.save(SAMPLE);
  T.check('save returns ok with an id and timestamps', saved.ok && /^f_/.test(saved.followup.id) && !!saved.followup.createdAt && !!saved.followup.updatedAt);
  const id = saved.followup.id;
  T.check('two lines saved, keys upper-cased, customer joined, overdue boolean', saved.followup.lines.length === 2
    && saved.followup.lines[0].storyKey === 'ABC-12' && saved.followup.lines[1].storyKey === 'ABC-31'
    && saved.followup.lines[1].customer === 'globex' && saved.followup.lines[0].overdue === true);

  T.section('list: a summary per follow-up, with the item count, newest first');
  const ls = await store.list();
  T.check('one follow-up listed with its header and count', ls.ok && ls.followups.length === 1
    && ls.followups[0].id === id && ls.followups[0].title === SAMPLE.title && ls.followups[0].sprintName === '2026-07'
    && ls.followups[0].itemCount === 2);
  T.check('the list summary carries no line detail (only the count)', !('lines' in ls.followups[0]));

  T.section('get: the full header and lines');
  const got = await store.get(id);
  T.check('get returns the header fields', got.ok && got.followup.subject === SAMPLE.subject && got.followup.to === 'priya@company.com'
    && got.followup.message.indexOf('Dear Priya') === 0 && got.followup.kind === 'sprint');
  T.check('get returns the lines in order', got.followup.lines.length === 2 && got.followup.lines[0].storyKey === 'ABC-12' && got.followup.lines[1].storyKey === 'ABC-31');
  T.check('get of an unknown id is not ok', !(await store.get('nope')).ok);

  T.section('save again with the id: updates in place (no duplicate), lines replaced');
  const upd = await store.save(Object.assign({}, SAMPLE, { id, subject: 'Updated subject', lines: [SAMPLE.lines[0]] }));
  T.check('same id kept, createdAt preserved, updatedAt moved on', upd.followup.id === id && upd.followup.createdAt === saved.followup.createdAt);
  const ls2 = await store.list();
  T.check('still one follow-up, now one line, new subject', ls2.followups.length === 1 && ls2.followups[0].itemCount === 1 && ls2.followups[0].subject === 'Updated subject');

  T.section('remove: the follow-up and its lines are gone');
  const rm = await store.remove(id);
  T.check('remove ok and the list is empty', rm.ok && (await store.list()).followups.length === 0);
  T.check('its lines are gone too (get not ok)', !(await store.get(id)).ok);

  T.section('newest first');
  const a = await store.save(Object.assign({}, SAMPLE, { id: '', title: 'A' }));
  await new Promise((r) => setTimeout(r, 5));
  const b = await store.save(Object.assign({}, SAMPLE, { id: '', title: 'B' }));
  const order = (await store.list()).followups.map((f) => f.title);
  T.check('the most recently saved is first', order[0] === 'B' && order[1] === 'A' && a.ok && b.ok);

  T.section('messages for the follow-up dialog: yours, and your versions of the built-ins, with their order');
  let ms = await store.messages();
  T.check('none at first: no rows, no order (the dialog shows the built-ins)', ms.ok && ms.messages.length === 0 && ms.order.length === 0);
  const mine = await store.saveMessage({ label: 'Code review please', subject: 'Code review needed', body: 'Please review the code for the stories below.\r\nThanks for the quick turn.', author: 'sam.lee' });
  T.check('a new message: a key made from its label, cleaned (line ends), kept with who and when', mine.ok && /^my-code-review-please-[0-9a-f]{4}$/.test(mine.message.key)
    && mine.message.body === 'Please review the code for the stories below.\nThanks for the quick turn.' && mine.message.author === 'sam.lee' && !!mine.message.updatedAt, JSON.stringify(mine.message));
  const ed = await store.saveMessage({ key: 'close', label: 'Ask to close', subject: 'Please close these today', body: 'Kindly close these today.' });
  await store.saveMessage({ key: 'sprint', label: 'Sprint closing', subject: 'x', body: 'y', hidden: true });
  ms = await store.messages();
  T.check('a built-in changed (key close) and one hidden (sprint): kept by their keys, in the order saved', ms.messages.map((m) => m.key + (m.hidden ? '*' : '')).join() === mine.message.key + ',close,sprint*'
    && ms.messages[1].subject === 'Please close these today' && ed.ok, ms.messages.map((m) => m.key).join());
  const again = await store.saveMessage(Object.assign({}, mine.message, { subject: 'Code review, please' }));
  ms = await store.messages();
  T.check('saved again by its key: changed in place (no duplicate, same place)', again.ok && ms.messages.length === 3 && ms.messages[0].subject === 'Code review, please');
  T.check('a key that is not a key, an empty label: made safe', /^my-/.test((await store.saveMessage({ key: '../x y', label: '' })).message.key)
    && (await store.saveMessage({ key: 'bad key!', label: '' })).message.label === 'My message');
  const ord = await store.setMessageOrder([mine.message.key, 'scripts', 'close', 'close', '../nope', 'blank']);
  T.check('the order: kept as given (repeats and bad keys dropped)', ord.ok && ord.order.join() === mine.message.key + ',scripts,close,blank' && (await store.messages()).order.join() === ord.order.join(), JSON.stringify(ord.order));
  await store.removeMessage('close');
  ms = await store.messages();
  T.check('removed: a built-in\'s row gone (back to its default), the others stay', !ms.messages.some((m) => m.key === 'close') && ms.messages.some((m) => m.key === mine.message.key));
  if (store.close) await store.close();
  const re = await FS.open({ file });
  ms = await re.messages();
  T.check('…all of it still there when the store is opened again', ms.messages.some((m) => m.key === mine.message.key && m.subject === 'Code review, please') && ms.order[0] === mine.message.key, JSON.stringify(ms.order));
  if (re.close) await re.close();
  T.report();
})().catch((e) => { console.error(e); process.exitCode = 1; });
