define(['resources/js/codeFixClient', 'resources/js/storyAnalysis'], function (FX, SA) {
  'use strict';

  // How a Code Fix (desktop/lib/codeFix.js) is shown — its status, the change, the checks and tests, and what to do once
  // it is applied — for every screen that shows one: Application pages (its Code fix tab) and Change requests. Pure:
  // no `this`, no DOM (a binding may call these detached).

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function when(at) {
    var d = new Date(at);
    if (isNaN(d.getTime())) return '';
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ', ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  var inWs = function (f) { return !!(f && f.workspace); };
  /** The AI's analysis split by its ## headings → { 'lower-case heading': plain text } (Markdown made plain). */
  function sectionsOf(md) {
    var out = {}, cur = null;
    String(md || '').replace(/\r\n/g, '\n').split('\n').forEach(function (l) {
      var h = /^#{1,3}\s+(.+?)\s*#*$/.exec(l);
      if (h) { cur = h[1].toLowerCase().replace(/[*_`:]/g, '').trim(); out[cur] = ''; return; }
      if (cur === null) return;
      var t = l.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^\s*[-*]\s+/, '• ');
      out[cur] += (out[cur] ? '\n' : '') + t;
    });
    Object.keys(out).forEach(function (k) { out[k] = out[k].replace(/\n{3,}/g, '\n\n').trim(); if (/^(none|n\/a|-)\.?$/i.test(out[k])) out[k] = ''; });
    return out;
  }

  var V = {
    when: when,
    kinds: function () { return [{ id: 'fix', label: 'Fix a bug' }, { id: 'enhance', label: 'Enhance' }, { id: 'change', label: 'Change' }]; },
    status: function (s) {
      return { proposed: 'Proposed — waiting for your approval', 'needs-redo': 'Not usable as it is (see below): ask again', questions: 'The AI has questions first', applied: 'Applied — not saved yet',
        committed: 'Saved', undone: 'Undone', discarded: 'Discarded', stale: 'Out of date: the code changed' }[s] || s;
    },
    statusClass: function (s) { return 'nx-fx-st nx-fx-st--' + (s || 'none'); },
    folder: function (i) {
      if (!i) return '';
      if (i.workspace) return 'Your workspace ' + i.workspace.label + ' — its working folder, branch ' + (i.branch || i.workspace.branch) + '. Changes stay on this PC until Apply to main, then Push, in its project\'s tab.';
      return (i.branch ? 'branch ' + i.branch + (i.upstream ? ' → ' + i.upstream : ' (not pushed anywhere)') : '') + (i.isDefault ? ' · the project this app runs from' : '');
    },
    inWs: inWs,
    refsText: function (f) { var r = (f && f.refs) || {}, i = (f && f.issue) || {}; var jira = i.jira || r.jira, iss = i.number || r.issue; return [jira ? 'Jira story ' + jira : '', iss ? 'Issue ' + iss : ''].filter(Boolean).join(' · '); },
    notesText: function (f) { var n = (f && f.applied && f.applied.notes) || 0; return n + ' change note' + (n === 1 ? '' : 's') + ' written in the code beside the change: what was asked, who asked and who changed it, when, the Jira story and the issue (see The change above).'; },
    approveText: function (f, i) {
      var n = f ? f.files.length : 0;
      var note = ' A note goes into the code beside the change: who asked, who changed it, when, the Jira story and the issue.';
      if (f && f.workspace) return 'Writes the ' + n + ' file(s) in your workspace\'s working folder (' + f.workspace + '), checks them and saves them there (a commit, on this PC only) — if something breaks it is not saved, for you to look first. Nothing is pulled or pushed: Apply to main, then Push, in the project\'s tab, send it to VB Studio.' + note;
      return 'Pulls ' + (i ? i.branch : 'the branch') + ' first, runs the related tests, writes the ' + n + ' file(s), tests again and commits them when nothing broke (not pushed: Push sends it).' + note;
    },
    appliedText: function (f) {
      var a = (f && f.applied) || {};
      var saved = f && f.status === 'committed' && f.commit;
      var held = f && f.status === 'applied' && (f.saveHeld || f.saveError || (f.tests && !f.tests.ok));
      return (saved ? '✓ Applied and saved ' : (held ? '⚠ Applied ' : 'Applied ')) + when(a.at) + (inWs(f) ? ' in your workspace\'s working folder (' + a.branch + ')' : ' on ' + a.branch) + (saved ? ' — commit ' + f.commit.sha : '');
    },
    /** After "Applied …": where it is, in one line (a workspace: on this PC only; a checkout: what the pull did). */
    appliedSub: function (f) {
      if (!f || !f.applied) return '';
      if (inWs(f)) return f.status === 'committed' ? 'on this PC only: nothing pulled or pushed — not in VB Studio yet.' : (f.saveHeld || f.saveError ? 'NOT saved: ' + (f.saveError || 'something broke (see the checks below).') : 'written on this PC only: nothing pulled, saved or pushed yet.');
      return (f.applied.pull && f.applied.pull.text) || '';
    },
    /** What now, step 1: how to see the change. */
    tryText: function (f, route, canRun) {
      if (inWs(f) && canRun) return 'Opens ' + (route || 'the page') + ' from your working copy, in the Run window — check that the change shows and works.';
      if (f && f.applied && f.applied.live) return 'Reload the page in this app and check that the change shows and works.';
      return 'Open the page in your app and check that the change shows and works.';
    },
    /** What now, step 2: how to keep it. */
    keepText: function (f, i) {
      var saved = f && f.status === 'committed';
      if (inWs(f)) return saved ? 'When you are happy with it: Apply to main, then Push, in its project\'s tab — that sends it to VB Studio.'
        : 'Something broke, so it was not saved: look at the checks, then Save anyway (a commit in your working folder, on this PC only) — or Undo.';
      if (saved) return (f.commit && f.commit.pushed) ? 'Pushed to ' + f.commit.upstream + '.' : 'Saved on ' + ((f.commit && f.commit.branch) || 'the branch') + ', not pushed: Push sends it to its remote.';
      return 'Something broke, so it was not committed: look at the checks, then Commit anyway — or Undo.';
    },
    committedText: function (f) {
      var c = (f && f.commit) || {};
      if (inWs(f)) return 'Saved in working: commit ' + c.sha + ' on ' + c.branch + ', on this PC only. ' + (c.next || '');
      return 'Committed ' + c.sha + ' on ' + c.branch + (c.pushed ? ', pushed to ' + c.upstream : ' (not pushed)');
    },
    meta: function (f) { return !f ? '' : (f.provider || 'AI') + (f.model ? ' (' + f.model + ')' : '') + ' · ' + when(f.at) + (f.by ? ' · asked by ' + f.by : '') + (f.ms ? ' · ' + Math.round(f.ms / 1000) + ' s' : '') + (f.retried ? ' · asked twice' : ''); },
    stats: function (f) {
      var d = (f && f.diff) || [];
      return d.length + ' file' + (d.length === 1 ? '' : 's') + ' · +' + d.reduce(function (n, x) { return n + x.added; }, 0) + ' −' + d.reduce(function (n, x) { return n + x.removed; }, 0);
    },
    line: function (t) { return 'nx-fx-l nx-fx-l--' + (t === '+' ? 'add' : t === '-' ? 'del' : 'ctx'); },
    sign: function (t) { return t === ' ' ? '' : (t === '-' ? '−' : t); },
    check: function (c) { return c.ok ? '✓' : (c.warn ? '⚠' : (c.already ? '•' : '✗')); },
    checkClass: function (c) { return 'nx-fx-check ' + (c.ok ? 'nx-fx-check--ok' : (c.warn ? 'nx-fx-check--warn' : (c.already ? 'nx-fx-check--old' : 'nx-fx-check--bad'))); },
    checkText: function (c) { return c.name + (c.detail ? ': ' + c.detail : '') + (!c.ok && c.already ? ' (already so before the change)' : ''); },
    checksOk: function (list) { return (list || []).every(function (c) { return c.ok || c.already; }); },
    unit: function (u) { return u.ok ? '✓ ' + u.passed + ' passed' : (u.newFailures.length ? '✗ ' + u.newFailures.length + ' new failure' + (u.newFailures.length === 1 ? '' : 's') : '• ' + u.failed + ' failing, as before the fix'); },
    unitClass: function (u) { return 'nx-fx-check ' + (u.ok ? 'nx-fx-check--ok' : (u.newFailures.length ? 'nx-fx-check--bad' : 'nx-fx-check--old')); },
    testsText: function (t) {
      if (!t) return '';
      return (t.ok ? '✓ Nothing broke' : '✗ Something broke') + ' — tested ' + when(t.at) + (t.none ? '. No unit test names this page; the checks ran.' : '.');
    },
    /** The checks' summary line (folded): how many passed. */
    testsCount: function (t) {
      if (!t) return '';
      var cs = t.checks || [], u = t.unit || [];
      var ok = cs.filter(function (c) { return c.ok || c.already; }).length;
      return ok + ' of ' + cs.length + ' checks' + (u.length ? ' · ' + u.length + ' unit test file' + (u.length === 1 ? '' : 's') : '') + ' — click to see them';
    },
    shot: function (f, which) { return FX.shotUrl(f, which); },
    imgUrl: function (f, n) { return FX.imgUrl(f, n); },
    imgSize: function (x) { return (x.w ? x.w + '×' + x.h + ' · ' : '') + Math.max(1, Math.round((x.size || 0) / 1024)) + ' KB'; },
    canApply: function (f) { return !!f && !f.shared && (f.status === 'proposed' || f.status === 'undone'); },
    listText: function (x) { return (x.status ? ({ proposed: 'proposed', applied: 'applied', committed: 'saved', undone: 'undone', discarded: 'discarded', 'needs-redo': 'not usable', questions: 'questions', stale: 'out of date' }[x.status] || x.status) : '') + ' · ' + when(x.at) + (x.by ? ' · ' + x.by : ''); },
    /**
     * How it was fixed, as a story a person reads top to bottom: what was asked, how it worked before, what was changed
     * and why, after the change, the risks, how it was tested (the steps to try, the checks and tests that ran) and
     * where the change is now. From the AI's analysis (its ## sections), the fix's checks and tests, and its state.
     * → [{ key, n, title, text, tone }]  (text: plain, line breaks kept; tone: ok | bad | '')
     */
    story: function (f, cr) {
      if (!f) return [];
      var secs = sectionsOf(f.markdown);
      var pick = function () { for (var i = 0; i < arguments.length; i++) { var k = secs[arguments[i]]; if (k) return k; } return ''; };
      var out = [];
      var add = function (key, title, text, tone) { if (String(text || '').trim()) out.push({ key: key, n: out.length + 1, title: title, text: String(text).trim(), tone: tone || '' }); };
      var kind = { fix: 'Fix a bug', enhance: 'Enhance', change: 'Change' }[(cr && cr.kind) || f.kind] || 'Change';
      add('asked', 'What was asked', (cr && cr.request ? cr.request : f.request) + (f.refine ? '\nThen: ' + f.refine : '') + '\n(' + kind + (cr && cr.requestedBy ? ', asked by ' + cr.requestedBy : (f.by ? ', asked by ' + f.by : '')) + (cr && cr.customer ? ' for ' + cr.customer : '') + ')');
      add('before', 'How it worked before', pick('how it works today', 'today', 'current behaviour', 'current behavior', 'the problem', 'cause'));
      add('change', 'What was changed, and why', [pick('summary'), pick('what changes', 'the fix', 'solution')].filter(Boolean).join('\n\n'));
      add('after', 'After the change', pick('after the change', 'result'));
      add('risks', 'Risks', pick('risks', 'risk'));
      var t = f.tests;
      var tested = [pick('how to test', 'testing', 'test steps')];
      if (t) {
        var cs = t.checks || [], u = t.unit || [];
        tested.push((t.ok ? '✓ Nothing broke' : '✗ Something broke') + ' — ' + cs.filter(function (c) { return c.ok || c.already; }).length + ' of ' + cs.length + ' checks passed'
          + (u.length ? '; related tests: ' + u.map(function (x) { return x.file + (x.ok ? ' ✓' : (x.newFailures.length ? ' ✗' : ' (failing as before)')); }).join(', ') : '; no unit test names this page') + ' (' + when(t.at) + ').');
      } else if ((f.checks || []).length) tested.push('Checks on the proposed code: ' + f.checks.filter(function (c) { return c.ok || c.already; }).length + ' of ' + f.checks.length + ' passed (not applied yet).');
      add('tested', 'How it was tested', tested.filter(Boolean).join('\n\n'), t ? (t.ok ? 'ok' : 'bad') : '');
      var where = '';
      var c = f.commit;
      if (f.status === 'committed' && c) where = 'Saved: commit ' + c.sha + ' on ' + c.branch + (c.pushed ? ', pushed to ' + c.upstream + '.' : (inWs(f) ? ', in your workspace\'s working folder (on this PC). Apply to main, then Push, sends it to VB Studio.' : ', not pushed yet.'));
      else if (f.status === 'applied') where = 'Applied ' + when(f.applied && f.applied.at) + ', not saved yet' + (f.saveHeld ? ': something broke, so it was held for a look.' : '.');
      else if (f.status === 'undone') where = 'Undone ' + (f.undone ? when(f.undone.at) + (f.undone.revert ? ' — its commit reverted (' + f.undone.revert + ')' : '') : '') + ': the files are as they were.';
      else if (f.status === 'proposed') where = 'Proposed — not written to the code yet (waiting for approval).';
      else where = V.status(f.status);
      add('where', 'Where the change is now', where, f.status === 'committed' ? 'ok' : (f.status === 'undone' ? 'bad' : ''));
      return out;
    },
    /** The fix's steps (asked, proposed, approved and applied, tested, saved, pushed, undone…) with when and who. */
    steps: function (f) { return ((f && f.events) || []).map(function (e) { return { what: e.what, when: when(e.at), by: e.by || '', detail: e.detail || '' }; }); },
    /** The AI's analysis in a small styled document for its sandboxed iframe. */
    doc: function (text) {
      return '<!doctype html><meta charset="utf-8"><style>'
        + 'body{font:14px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#161513;margin:0;padding:14px}'
        + 'h2,h3,h4{color:#00688c;margin:16px 0 6px;font-size:15px;font-weight:700}h3:first-child{margin-top:0}'
        + 'ul,ol{margin:0 0 12px;padding-left:20px}li{margin-bottom:5px}p{margin:0 0 10px}code{background:#eef2f4;padding:1px 5px;border-radius:4px;font-size:12px}'
        + '</style>' + SA.renderHtml(text || '');
    }
  };
  return V;
});
