/*
 * followup (resources/js/followup.js): the "Copy to follow-up" / "Open in Outlook" compose helpers on the Jira pages —
 * the greeting that names the assignees, the ready email bodies, the composed email (message + stories table + sign-off)
 * and the mailto link. The table itself is exportKit.followupHtml (tested in exportkit.test.js).
 *
 * Run:  node tests/followup.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const JS = path.join(__dirname, '..', 'webApps', 'buildrite', 'resources', 'js');

function load(name, deps, extra) {
  const sandbox = Object.assign({ console, Date, JSON, Math, Promise, Blob, URL, TextEncoder }, extra || {});
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, name + '.js'), 'utf8'), sandbox, { filename: name + '.js' });
  return mod;
}
const exportKit = load('exportKit');
const F = load('followup', { 'resources/js/exportKit': exportKit });

const ROWS = [
  { key: 'ABC-144', summary: 'Picking Exception <Handling>', status: 'DEVELOPMENT', assignee: 'Priya Raman', due: '2026-06-30', overdue: true, url: 'https://j/ABC-144', in: 'here', labels: ['acme'] },
  { key: 'ABC-205', summary: 'Rental Agreement', status: 'DEVELOPMENT', assignee: 'omar.diaz', due: '2026-06-30', overdue: true, url: 'https://j/ABC-205', in: 'here', labels: ['globex'] },
];

T.section('firstName & greeting');
T.eq('a dotted username → first name', F.firstName('omar.diaz'), 'Omar');
T.eq('a full name → first name', F.firstName('Priya Raman'), 'Priya');
T.eq('nobody / empty → nothing', F.firstName('Nobody') + '|' + F.firstName(''), '|');
T.eq('greeting names the assignees in row order', F.greeting(ROWS), 'Dear Priya and Omar,');
T.eq('one assignee', F.greeting([ROWS[0]]), 'Dear Priya,');
T.eq('three → comma then and', F.greeting([{ assignee: 'Alpha' }, { assignee: 'Beta' }, { assignee: 'Gamma' }]), 'Dear Alpha, Beta and Gamma,');
T.eq('nobody assigned → Dear all', F.greeting([{ assignee: '' }, { assignee: 'Nobody' }]), 'Dear all,');
T.eq('too many to name → Dear all', F.greeting([{ assignee: 'a a' }, { assignee: 'b b' }, { assignee: 'c c' }, { assignee: 'd d' }, { assignee: 'e e' }]), 'Dear all,');

T.section('templates');
T.check('at least seven, each has a subject', F.TEMPLATES.length >= 7 && F.TEMPLATES.every((t) => !!t.subject && !!t.key));
T.check('the sample "ask to close" template exists', F.TEMPLATES.some((t) => t.key === 'close' && /close the following stories/i.test(t.body)));
T.check('a blank template to write your own', F.TEMPLATES.some((t) => t.key === 'blank' && t.body === ''));

T.section('recipient suggestions: why no one was found, the addresses used before');
const reply = (o) => Object.assign({ contacts: [], sources: [{ id: 'people', label: 'people you work with', ok: true, n: 0 }, { id: 'contacts', label: 'your saved contacts', ok: true, n: 0 }, { id: 'directory', label: 'the company directory', ok: false, n: 0, off: true }], m365: { configured: true, signedIn: true, expired: false, directory: false } }, o || {});
T.check('signed in, nothing matches: where it looked, that the company directory is not searched (and how to turn it on), type the address',
  F.sugNote('tes', reply(), 0) === 'No one found for “tes” in people you work with and your saved contacts. The company directory is not searched: turn it on from the Microsoft 365 button in the top bar (an admin must approve it). Type the full address and press Enter.', F.sugNote('tes', reply(), 0));
T.check('an expired sign-in: said, with where to connect again (even with suggestions from used-before)', /sign-in has expired.*Microsoft 365 button in the top bar/.test(F.sugNote('ga', reply({ m365: { signedIn: false, expired: true } }), 2)));
T.check('not connected (Outlook on this PC searched): says to connect Microsoft 365 to search colleagues',
  /No one found for “ga” in Outlook on this PC\. Connect Microsoft 365 \(top bar\)/.test(F.sugNote('ga', { sources: [{ id: 'outlook', label: 'Outlook on this PC', ok: true, n: 0 }], m365: { signedIn: false } }, 0)));
T.check('a source that failed: its error shown', /People you work with: Access denied/.test(F.sugNote('ga', reply({ sources: [{ id: 'people', label: 'people you work with', ok: false, error: 'Access denied' }] }), 0)));
T.check('suggestions on screen: no note', F.sugNote('ga', reply(), 3) === '');
const mem = {};
const ls = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
const FL = load('followup', { 'resources/js/exportKit': exportKit }, { localStorage: ls });
FL.rememberRecips('Mira Lane <mira.lane@example.com>; sam.lee@example.com', 'pm@example.com; not-an-address');
FL.rememberRecips('sam.lee@example.com', '');
const ub = FL.usedBefore('');
T.check('addresses that went out are kept on this PC, most used first (names kept, a word without @ left out)', ub[0].email === 'sam.lee@example.com' && ub.some((x) => x.email === 'mira.lane@example.com' && x.name === 'Mira Lane')
  && !ub.some((x) => /not-an-address/.test(x.email)) && ub.every((x) => x.src === 'used before'), JSON.stringify(ub));
T.check('…offered as you type (by name or address)', FL.usedBefore('mir').map((x) => x.email).join() === 'mira.lane@example.com' && FL.usedBefore('pm@').length === 1 && FL.usedBefore('zzz').length === 0);
T.check('…first, then what Microsoft 365 found, each address once', FL.mergeSug(FL.usedBefore('mir'), [{ name: 'Mira L', email: 'MIRA.LANE@example.com' }, { name: 'Gary', email: 'gary@example.com' }]).map((x) => x.email + ':' + (x.src || '-')).join() === 'mira.lane@example.com:used before,gary@example.com:-');

T.section('the messages you keep (Follow-ups › Messages) merged with the built-ins');
const m0 = F.merge([], []);
T.check('nothing kept: the built-ins, in their order, Write my own last', m0.map((m) => m.key).join() === F.TEMPLATES.map((t) => t.key).join() && m0.every((m) => m.builtin && !m.edited && !m.hidden));
const kept = [
  { key: 'close', label: 'Ask to close', subject: 'Please close these today', body: 'Kindly close {count} today, {names}.' },
  { key: 'sprint', label: 'Sprint closing', subject: 'x', body: 'y', hidden: true },
  { key: 'my-code-review-1a2b', label: 'Code review please', subject: 'Code review for {sprint}', body: 'Please review the code of these {count} by {due}.' },
];
const mm = F.merge(kept, ['my-code-review-1a2b', 'proof', 'blank', 'close']);
T.check('yours added, a built-in changed (marked edited, its original kept), one hidden', mm.some((m) => m.key === 'my-code-review-1a2b' && m.mine && !m.builtin)
  && mm.filter((m) => m.key === 'close')[0].edited && mm.filter((m) => m.key === 'close')[0].original.subject === 'Please close these stories' && mm.filter((m) => m.key === 'sprint')[0].hidden);
T.check('…in the order you set (then the rest as they come); Write my own still last whatever the order says',
  mm[0].key === 'my-code-review-1a2b' && mm[1].key === 'proof' && mm[2].key === 'close' && mm[mm.length - 1].key === 'blank', mm.map((m) => m.key).join());
F.use(kept, ['my-code-review-1a2b']);
T.check('use(): the dialog\'s list leaves out hidden ones (all = every one); template() finds yours', !F.list().some((m) => m.key === 'sprint') && F.list(true).some((m) => m.key === 'sprint')
  && F.template('my-code-review-1a2b').label === 'Code review please' && F.list()[0].key === 'my-code-review-1a2b');
const rowsW = [{ assignee: 'Priya Raman', sprint: '2026-07', due: '2026-08-31' }, { assignee: 'Sam Lee', sprint: '2026-07', due: '2026-08-15' }];
T.check('words filled from the stories: {names} {count} {sprint} {due}', F.message(rowsW, 'close') === 'Dear Priya and Sam,\n\nKindly close 2 stories today, Priya and Sam.'
  && F.subjectFor(rowsW, 'my-code-review-1a2b') === 'Code review for 2026-07' && /these 2 stories by 2026-08-15\.$/.test(F.message(rowsW, 'my-code-review-1a2b')), F.message(rowsW, 'my-code-review-1a2b'));
T.check('…{today} is today; with no dates or sprint, plain words', /^\d{4}-\d{2}-\d{2}$/.test(F.fill('{today}', [])) && F.fill('{sprint} by {due}', [{}]) === 'this sprint by the due date' && F.WORDS.length >= 5);
T.check('a key no longer kept: the first message offered', F.template('gone-key').key === F.list()[0].key);
F.use([], []);
T.check('testing follow-ups: provide test scripts, provide proof of testing, need more info (each with its own subject and body)',
  ['scripts', 'proof', 'info'].every((k) => { const t = F.template(k); return t.key === k && !!t.subject && t.body.length > 40; })
  && /test scripts/i.test(F.template('scripts').body) && /proof of testing/i.test(F.template('proof').body) && /more information/i.test(F.template('info').body)
  && F.template('scripts').label === 'Provide test scripts' && F.template('proof').label === 'Provide proof of testing' && F.template('info').label === 'Need more info');
T.check('…and blockers, UAT sign-off; every key once, Write my own still last', F.template('blocked').key === 'blocked' && F.template('uat').key === 'uat'
  && new Set(F.TEMPLATES.map((t) => t.key)).size === F.TEMPLATES.length && F.TEMPLATES[F.TEMPLATES.length - 1].key === 'blank');
T.check('…its message: the greeting, then the body', /^Dear .*,\n\nBefore we can close the stories below, please attach proof of testing/.test(F.message([{ assignee: 'Priya Raman' }], 'proof')), F.message([{ assignee: 'Priya Raman' }], 'proof').slice(0, 80));
T.check('message() is greeting + the chosen body', F.message(ROWS, 'close').startsWith('Dear Priya and Omar,') && /kindly close/.test(F.message(ROWS, 'close')));
T.check('"Ask how to proceed": a manager message with its own subject and body', F.template('proceed').key === 'proceed'
  && F.template('proceed').label === 'Ask how to proceed' && /how should we proceed/i.test(F.template('proceed').subject)
  && /advise how you would like us to proceed/i.test(F.template('proceed').body)
  && /^Dear .*,\n\nPlease advise how you would like us to proceed/.test(F.message([{ assignee: 'Priya Raman' }], 'proceed')));

T.section('columns');
T.check('sprint columns lead with Sprint and drop the in-sprint column', F.columns('sprint')[0].key === 'sprint' && !F.columns('sprint').some((c) => c.key === 'in'));
T.check('the Sprint column shows the item’s sprint', F.columns('sprint')[0].value({ sprint: '2026-07' }) === '2026-07');
T.check('stories columns include the Customer label', F.columns('stories').some((c) => c.key === 'labels' && c.label === 'Customer'));
T.check('the Key column links to the story', typeof F.columns('stories')[0].href === 'function' && F.columns('stories')[0].href(ROWS[0]) === 'https://j/ABC-144');

T.section('introHtml (message → email paragraphs)');
const intro = F.introHtml('Dear Omar,\n\nPlease close these.\nThanks');
T.check('a paragraph per blank line, a break for a single newline', (intro.match(/<p /g) || []).length === 2 && intro.includes('<br>'));
T.check('text is HTML-escaped', F.introHtml('a <b> & "c"').includes('&lt;b&gt;') && !F.introHtml('a <b>').includes('<b>'));
T.eq('empty message → nothing', F.introHtml('   '), '');

T.section('headerText / composeHtml / composeText');
T.eq('headerText: title, subtitle, N items · when', F.headerText({ title: 'T', subtitle: 'S', when: 'W', rows: ROWS }), 'T\nS\n2 items · W');
const OPTS = { title: 'Follow-up — Sprint 2026-06', subtitle: 'active · 2026-06-01 – 2026-06-30', when: '11/10/2026, 10:43:47 PM',
  message: F.message(ROWS, 'close'), signoff: 'Thanks,\nSam', rows: ROWS, kind: 'stories' };
const html = F.composeHtml(OPTS);
T.check('the email header: title, subtitle, and the count with the timestamp', html.includes('Follow-up — Sprint 2026-06')
  && html.includes('active · 2026-06-01') && html.includes('2 items · 11/10/2026, 10:43:47 PM'));
T.check('then the greeting, the table and the sign-off', html.includes('Dear Priya and Omar,') && html.includes('<table') && html.includes('Thanks,'));
T.check('the summary is escaped inside the table', html.includes('Picking Exception &lt;Handling&gt;'));
const txt = F.composeText(OPTS);
T.check('plain text: the header, the message, a tab-separated table, the sign-off', txt.includes('Follow-up — Sprint 2026-06')
  && txt.includes('2 items · 11/10/2026') && txt.includes('kindly close') && txt.includes('\t') && txt.trim().endsWith('Sam'));

T.section('ascii (mailto-safe punctuation)');
T.eq('folds em/en dash, middot and curly quotes to ASCII', F.ascii('A — B · C – today’s “x”'), 'A -- B - C - today\'s "x"');

T.section('tableHtml / tableText (table only, for Open in Outlook)');
const tonly = F.tableHtml({ rows: ROWS, kind: 'stories' });
T.check('just the stories table with its Customer column', tonly.includes('<table') && tonly.includes('Customer'));
T.check('no greeting or header leaking into the table-only html', !tonly.includes('Dear ') && !/Follow-up/.test(tonly));
T.check('tableText is a tab-separated table', F.tableText({ rows: ROWS, kind: 'stories' }).split('\n').length === 3);

T.section('mailtoHref');
const href = F.mailtoHref({ to: 'a@b.com; c@d.com', subject: 'Please close these stories', title: 'Follow-up — Sprint 2026-06', subtitle: 'active', when: 'now', message: 'Dear all,', signoff: 'Thanks,', rows: ROWS });
T.check('a mailto with the recipients and subject', href.startsWith('mailto:') && href.includes(encodeURIComponent('a@b.com; c@d.com')) && href.includes(encodeURIComponent('Please close these stories')));
const decoded = decodeURIComponent(href);
T.check('the body is plain ASCII (no em dash / middot that Outlook would mojibake)',
  !/[—–·‘’“”]/.test(decoded) && decoded.includes('Follow-up -- Sprint 2026-06') && decoded.includes('press Ctrl+V'));

T.section('recipients as chips (recips / addRecip / removeRecip)');
T.check('recips splits a string into chips, parsing "Name <email>"', JSON.stringify(F.recips('a@b.com; "Omar Diaz" <omar@x.com>'))
  === JSON.stringify([{ label: 'a@b.com', value: 'a@b.com' }, { label: 'Omar Diaz', value: 'omar@x.com' }]));
T.check('addRecip appends and dedupes case-insensitively', F.addRecip('a@b.com', 'C@D.com') === 'a@b.com; C@D.com'
  && F.addRecip('a@b.com; c@d.com', 'A@B.com') === 'a@b.com; c@d.com');
T.check('removeRecip drops the matching recipient', F.removeRecip('a@b.com; c@d.com', 'a@b.com') === 'c@d.com');

T.report();
