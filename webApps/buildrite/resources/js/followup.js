define(['resources/js/exportKit'], function (exportKit) {
  'use strict';

  // "Copy to follow-up" / "Open in Outlook" on the Jira pages: the greeting that addresses the assignees by first name,
  // a few ready email bodies in simple English the user picks from, and the composed email (the message, then the
  // stories as a table, then the sign-off). exportKit builds the table and puts it on the clipboard; the body kept here
  // is plain, email-friendly English — the user can edit every word before they copy or open Outlook.

  function htmlEsc(v) {
    return String(v === undefined || v === null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // "nabil.khan" → "Nabil", "Rahul Kanth Panganamamula" → "Rahul".
  function firstName(assignee) {
    var a = String(assignee || '').trim();
    if (!a || /^nobody$/i.test(a)) return '';
    var first = a.split(/[\s.]+/)[0] || '';
    return first ? first.charAt(0).toUpperCase() + first.slice(1) : '';
  }

  // The distinct first names of the people the picked stories are assigned to.
  function names(rows) {
    var seen = {};
    var out = [];
    (rows || []).forEach(function (r) {
      var n = firstName(r && r.assignee);
      var k = n.toLowerCase();
      if (n && !seen[k]) { seen[k] = true; out.push(n); }
    });
    return out;
  }

  // "Dear Nabil and Rahul," — or "Dear all," when nobody is assigned, or there are too many names to greet by name.
  function greeting(rows) {
    var ns = names(rows);
    if (!ns.length || ns.length > 4) return 'Dear all,';
    var joined = ns.length === 1 ? ns[0] : ns.slice(0, -1).join(', ') + ' and ' + ns[ns.length - 1];
    return 'Dear ' + joined + ',';
  }

  // The bodies the user chooses from (simple English, no greeting and no sign-off — those are added around them).
  var TEMPLATES = [
    { key: 'close', label: 'Ask to close', subject: 'Please close these stories',
      body: 'As we discussed, kindly close the following stories. If a story cannot be closed yet, please reply with the reason and the date you expect to finish.' },
    { key: 'status', label: 'Status update', subject: 'Quick status on these stories',
      body: 'Please share the latest status on the stories below. For anything still open, add a short note on what is left and when it will be done.' },
    { key: 'overdue', label: 'Overdue — act today', subject: 'Overdue stories — action needed',
      body: 'The stories below are due or overdue. Please update them today: move it to Done if finished, or add the blocker and a new date if not.' },
    { key: 'standup', label: 'After standup', subject: 'Follow-up from today’s standup',
      body: 'Thank you for joining the standup. Here are the stories we agreed to move forward. Please update each one with your progress and your next step.' },
    { key: 'testing', label: 'Ready for testing?', subject: 'Are these ready for testing?',
      body: 'Please confirm whether the stories below are ready for testing. If a story is not ready, add what is pending and when it will be ready.' },
    { key: 'sprint', label: 'Sprint closing', subject: 'Sprint closing — please finish or hand over',
      body: 'We are closing the sprint. Please complete or hand over the stories below, and make sure the status on the board is correct.' },
    { key: 'scripts', label: 'Provide test scripts', subject: 'Test scripts needed for these stories',
      body: 'Please share the test scripts for the stories below. For each story, list the steps, the test data and the expected result, and attach them to the story in Jira (or reply with a link) so testing can start.' },
    { key: 'proof', label: 'Provide proof of testing', subject: 'Proof of testing needed before we close these stories',
      body: 'Before we can close the stories below, please attach proof of testing to each one: screenshots or a short recording, the test data used and the result you got. If you found defects, add their numbers and status.' },
    { key: 'info', label: 'Need more info', subject: 'More information needed on these stories',
      body: 'We need more information on the stories below before they can move forward. Please add the missing details to each story: what is needed, the acceptance criteria, and any examples or screens that help. Reply if a short call would be quicker.' },
    { key: 'blocked', label: 'Any blockers?', subject: 'Is anything blocking these stories?',
      body: 'The stories below have not moved for a while. Is anything blocking them? Please reply with the blocker, who can clear it and the date you expect to continue, so we can help.' },
    { key: 'proceed', label: 'Ask how to proceed', subject: 'How should we proceed on these stories?',
      body: 'Please advise how you would like us to proceed on the stories below. For each one, let us know the priority and the next step — carry on, put it on hold, reassign it, or close it — and anything you need from us to decide.' },
    { key: 'uat', label: 'UAT sign-off', subject: 'UAT sign-off needed for these stories',
      body: 'The stories below are ready for user acceptance testing. Please test them and reply with your sign-off, or list what does not work as expected so we can fix it.' },
    { key: 'blank', label: 'Write my own', subject: 'Follow-up', body: '' },
  ];

  // The messages kept in Follow-ups › Messages (desktop/lib/followups.js): yours, and your versions of the built-ins (a
  // row with a built-in's key replaces it, or hides it), in the order you set. merge() makes the one list the dialog
  // shows; use() keeps it for template() / list() (this module is loaded once, so every page sees the same list).
  function merge(stored, order) {
    var rows = (stored || []).filter(function (m) { return m && m.key; });
    var byKey = {};
    rows.forEach(function (m) { byKey[m.key] = m; });
    var out = TEMPLATES.map(function (t) {
      var m = byKey[t.key];
      return {
        key: t.key, label: (m && m.label) || t.label, subject: m ? m.subject : t.subject, body: m ? m.body : t.body,
        hidden: !!(m && m.hidden), builtin: true, edited: !!m && (m.label !== t.label || m.subject !== t.subject || m.body !== t.body),
        updatedAt: (m && m.updatedAt) || '', author: (m && m.author) || '',
        original: { label: t.label, subject: t.subject, body: t.body },
      };
    });
    rows.forEach(function (m) {
      if (TEMPLATES.some(function (t) { return t.key === m.key; })) return;
      out.push({ key: m.key, label: m.label || 'My message', subject: m.subject || '', body: m.body || '', hidden: !!m.hidden,
        builtin: false, edited: false, mine: true, updatedAt: m.updatedAt || '', author: m.author || '' });
    });
    // the order you set first; the rest as they come (built-ins, then yours); "Write my own" always last
    var ord = (order || []).filter(function (k, i, a) { return a.indexOf(k) === i; });
    var pos = function (m) { var i = ord.indexOf(m.key); return i === -1 ? ord.length + out.indexOf(m) : i; };
    var blank = out.filter(function (m) { return m.key === 'blank'; });
    return out.filter(function (m) { return m.key !== 'blank'; }).sort(function (a, b) { return pos(a) - pos(b); }).concat(blank);
  }
  var active = merge([], []);
  function use(stored, order) { active = merge(stored, order); return active; }
  /** The messages the dialog offers (hidden ones left out unless all). */
  function list(all) { return all ? active.slice() : active.filter(function (m) { return !m.hidden; }); }

  function template(key) {
    for (var i = 0; i < active.length; i++) { if (active[i].key === key) return active[i]; }
    for (var j = 0; j < TEMPLATES.length; j++) { if (TEMPLATES[j].key === key) return TEMPLATES[j]; }
    return list()[0] || TEMPLATES[0];
  }

  // Words a message can carry, filled in from the stories when it is picked.
  var WORDS = [
    { word: '{names}', says: 'the assignees\u2019 first names (Priya and Sam)' },
    { word: '{count}', says: 'how many stories (7 stories)' },
    { word: '{sprint}', says: 'the stories\u2019 sprint' },
    { word: '{due}', says: 'the earliest due date' },
    { word: '{today}', says: 'today\u2019s date' },
  ];
  function fill(text, rows) {
    var rs = rows || [];
    var ns = names(rs);
    var who = !ns.length ? 'everyone' : ns.length === 1 ? ns[0] : ns.slice(0, -1).join(', ') + ' and ' + ns[ns.length - 1];
    var sprints = rs.map(function (r) { return r && r.sprint; }).filter(Boolean);
    var dues = rs.map(function (r) { return r && r.due; }).filter(function (d) { return /^\d{4}-\d{2}-\d{2}/.test(String(d || '')); }).sort();
    var today = new Date();
    var iso = today.getFullYear() + '-' + ('0' + (today.getMonth() + 1)).slice(-2) + '-' + ('0' + today.getDate()).slice(-2);
    return String(text || '')
      .replace(/\{names\}/g, who)
      .replace(/\{count\}/g, rs.length + (rs.length === 1 ? ' story' : ' stories'))
      .replace(/\{sprint\}/g, sprints[0] || 'this sprint')
      .replace(/\{due\}/g, dues[0] || 'the due date')
      .replace(/\{today\}/g, iso);
  }

  // The message that fills the box when a template is picked: the greeting, a blank line, then the chosen body.
  function message(rows, key) {
    var b = fill(template(key).body, rows);
    return greeting(rows) + (b ? '\n\n' + b : '\n\n');
  }
  /** The picked message's subject, its words filled in. */
  function subjectFor(rows, key) { return fill(template(key).subject, rows); }

  // The columns the follow-up table shows — short and email-friendly. 'sprint' leads with the item's sprint; 'stories'
  // carries the customer label instead.
  function columns(kind) {
    var base = [];
    if (kind === 'sprint') base.push({ key: 'sprint', label: 'Sprint', value: function (r) { return r.sprint || '—'; } });
    base.push({ key: 'key', label: 'Key', href: function (r) { return r.url; } });
    base.push({ key: 'summary', label: 'Summary' });
    base.push({ key: 'status', label: 'Status' });
    base.push({ key: 'assignee', label: 'Assignee', value: function (r) { return r.assignee || 'Nobody'; } });
    if (kind !== 'sprint') base.push({ key: 'labels', label: 'Customer', value: function (r) { return (r.labels || []).join(', '); } });
    base.push({ key: 'due', label: 'Due', value: function (r) { return r.due || '—'; }, tone: function (r) { return r.overdue ? 'bad' : ''; } });
    return base;
  }

  // Plain text → email paragraphs (escaped; a blank line starts a new paragraph, a single newline is a break).
  function introHtml(text) {
    var t = String(text || '').trim();
    if (!t) return '';
    return t.split(/\n{2,}/).map(function (p) {
      return '<p style="margin:0 0 10px;font:400 14px/1.5 \'Segoe UI\',Arial,sans-serif;color:#1f2937;">' + htmlEsc(p).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  // The header block as plain text lines: the name, the state · dates, and "N items · when".
  function headerText(opts) {
    var o = opts || {};
    var n = (o.rows || []).length;
    var count = n + (n === 1 ? ' item' : ' items') + (o.when ? ' · ' + o.when : '');
    return [o.title || '', o.subtitle || '', count].filter(Boolean).join('\n');
  }

  // Just the stories table (no header, message or sign-off) — for the "Open in Outlook" clipboard, so one Ctrl+V drops
  // the formatted table into the mail's body without repeating the message that is already typed there.
  function tableHtml(opts) {
    var o = opts || {};
    return exportKit.followupHtml({ rows: o.rows || [], columns: columns(o.kind), showCount: false });
  }
  function tableText(opts) {
    var o = opts || {};
    return exportKit.tsv(o.rows || [], columns(o.kind));
  }

  // A mail link carries its body in the system codepage, not UTF-8, so Outlook shows fancy punctuation as mojibake
  // ("—" → "â€""). For the mailto text only, fold the punctuation we add down to plain ASCII.
  function ascii(s) {
    return String(s || '')
      .replace(/—/g, '--').replace(/–/g, '-').replace(/‒/g, '-').replace(/‑/g, '-')
      .replace(/·|•/g, '-').replace(/‘|’/g, "'").replace(/“|”/g, '"').replace(/…/g, '...');
  }

  // The whole email: the header block (name, state · dates, count · when), the message, the stories table, the sign-off.
  // opts { title, subtitle, when, message, signoff, rows, kind }.
  function composeHtml(opts) {
    var o = opts || {};
    return exportKit.followupHtml({
      title: o.title, subtitle: o.subtitle, when: o.when,
      intro: introHtml(o.message), signoff: introHtml(o.signoff), rows: o.rows || [], columns: columns(o.kind),
    });
  }

  // The same email as plain text (for the clipboard's text/plain and as a fallback).
  function composeText(opts) {
    var o = opts || {};
    var tbl = exportKit.tsv(o.rows || [], columns(o.kind));
    return [headerText(o), String(o.message || '').trim(), tbl, String(o.signoff || '').trim()].filter(Boolean).join('\n\n');
  }

  // mailto for "Open in Outlook": recipients, subject, and the message as plain text (with the header). A mail link
  // cannot carry an HTML table, so the body tells the user the table is on their clipboard — one Ctrl+V drops it in.
  function mailtoHref(opts) {
    var o = opts || {};
    var body = [headerText(o), String(o.message || '').trim(),
      '[ Click on this line and press Ctrl+V to paste the stories table. ]',
      String(o.signoff || '').trim()].filter(Boolean).join('\n\n');
    return 'mailto:' + encodeURIComponent(ascii(o.to || '')) + '?'
      + (o.cc ? 'cc=' + encodeURIComponent(ascii(o.cc)) + '&' : '')
      + 'subject=' + encodeURIComponent(ascii(o.subject || '')) + '&body=' + encodeURIComponent(ascii(body));
  }

  // ── Recipient suggestions: the addresses you used before (this PC), then Microsoft 365 / Outlook ──
  var RECENT_KEY = 'br.fu.recips';
  function recentList() {
    try { var a = JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem(RECENT_KEY)) || '[]'); return Array.isArray(a) ? a.filter(function (x) { return x && x.email; }) : []; }
    catch (e) { return []; }
  }
  /** Keep the To / Cc of an email that went out (copied, opened in Outlook, sent, saved): offered first next time. */
  function rememberRecips(to, cc) {
    var list = recentList();
    var now = Date.now();
    recips(to).concat(recips(cc)).forEach(function (r) {
      if (!/@/.test(r.value)) return;
      var k = r.value.toLowerCase();
      var hit = null;
      for (var i = 0; i < list.length; i++) { if (String(list[i].email).toLowerCase() === k) { hit = list[i]; break; } }
      if (hit) { hit.n = (hit.n || 0) + 1; hit.at = now; if (r.label && r.label !== r.value) hit.name = r.label; }
      else list.push({ name: r.label !== r.value ? r.label : '', email: r.value, n: 1, at: now });
    });
    list.sort(function (a, b) { return (b.n || 0) - (a.n || 0) || (b.at || 0) - (a.at || 0); });
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 200))); } catch (e) { /* not kept */ }
    return list.length;
  }
  /** The addresses used before that match what is typed (name or address), most used first: [{ name, email, src }]. */
  function usedBefore(term, extra) {
    var t = String(term || '').trim().toLowerCase();
    var seen = {};
    var out = [];
    recentList().concat(extra || []).forEach(function (x) {
      var email = String(x.email || '').trim();
      var k = email.toLowerCase();
      if (!email || seen[k]) return;
      if (t && (String(x.name || '') + ' ' + email).toLowerCase().indexOf(t) === -1) return;
      seen[k] = true;
      out.push({ name: x.name || email, email: email, src: 'used before' });
    });
    return out;
  }
  /** Used-before first, then what Microsoft 365 / Outlook found, each address once. */
  function mergeSug(first, more) {
    var seen = {};
    var out = [];
    (first || []).concat(more || []).forEach(function (c) {
      var k = String((c && c.email) || '').toLowerCase();
      if (!k || seen[k]) return;
      seen[k] = true;
      out.push({ name: c.name || c.email, email: c.email, src: c.src || '' });
    });
    return out;
  }
  /**
   * The line under To / Cc after a search: why no one was found and where it looked, what to do about it (connect
   * Microsoft 365, it expired, the company directory is off), or '' when there are suggestions. reply = the contacts
   * answer ({ contacts, sources, error, needsSignIn, m365 }); shown = how many suggestions are on screen.
   */
  function sugNote(term, reply, shown) {
    var r = reply || {};
    var m = r.m365 || null;
    var t = String(term || '').trim();
    var typeIt = ' Type the full address and press Enter.';
    if (m && m.expired) return 'Your Microsoft 365 sign-in has expired, so your colleagues cannot be searched. Connect again from the Microsoft 365 button in the top bar.' + typeIt;
    if (shown > 0) return '';
    var looked = (r.sources || []).filter(function (x) { return x && !x.off; });
    var failed = looked.filter(function (x) { return !x.ok && x.error; });
    var where = looked.filter(function (x) { return x.ok; }).map(function (x) { return x.label; });
    var msg = 'No one found for “' + t + '”' + (where.length ? ' in ' + (where.length > 1 ? where.slice(0, -1).join(', ') + ' and ' + where[where.length - 1] : where[0]) : '') + '.';
    if (failed.length) msg += ' ' + failed.map(function (x) { return x.label.charAt(0).toUpperCase() + x.label.slice(1) + ': ' + x.error; }).join(' ');
    if (!m || !m.signedIn) msg += ' Connect Microsoft 365 (top bar) to search your colleagues.';
    else if (!m.directory) msg += ' The company directory is not searched: turn it on from the Microsoft 365 button in the top bar (an admin must approve it).';
    else if (r.error && !failed.length) msg += ' ' + r.error;
    return msg + typeIt;
  }

  /** The recipients in a "a@x; b@y" string, as chips: [{ label, value }] (label is the name part if "Name <email>"). */
  function recips(str) {
    return String(str || '').split(/[;,]/).map(function (s) { return s.trim(); }).filter(Boolean).map(function (v) {
      var m = /^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/.exec(v);
      return m ? { label: m[1].trim(), value: m[2].trim() } : { label: v, value: v };
    });
  }
  /** Add an email/recipient to a "to"/"cc" string (deduped, case-insensitive); returns the new string. */
  function addRecip(str, value) {
    var v = String(value || '').trim();
    if (!v) return String(str || '');
    var list = recips(str).map(function (r) { return r.value; });
    if (list.map(function (x) { return x.toLowerCase(); }).indexOf(v.toLowerCase()) < 0) list.push(v);
    return list.join('; ');
  }
  /** Remove a recipient (by its value/email) from a "to"/"cc" string. */
  function removeRecip(str, value) {
    var v = String(value || '').trim().toLowerCase();
    return recips(str).filter(function (r) { return r.value.toLowerCase() !== v; }).map(function (r) { return r.value; }).join('; ');
  }

  return {
    firstName: firstName, names: names, greeting: greeting, TEMPLATES: TEMPLATES, template: template, message: message,
    merge: merge, use: use, list: list, fill: fill, WORDS: WORDS, subjectFor: subjectFor,
    rememberRecips: rememberRecips, usedBefore: usedBefore, mergeSug: mergeSug, sugNote: sugNote,
    columns: columns, introHtml: introHtml, headerText: headerText, ascii: ascii, tableHtml: tableHtml, tableText: tableText,
    composeHtml: composeHtml, composeText: composeText, mailtoHref: mailtoHref, recips: recips, addRecip: addRecip, removeRecip: removeRecip,
  };
});
