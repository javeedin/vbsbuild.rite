define(['resources/js/exportKit', 'resources/js/fusionSqlKit', 'resources/js/fusionSetupsKit'], (exportKit, K, SK) => {
  'use strict';

  // Fusion SQL: binding helpers. Ctrl+Enter in the editor presses Run; Enter in Ask AI's box presses Ask; Enter in a
  // placeholder's box runs. Listened for once, however many times the page opens. None uses `this`.
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__brFsqlKeys) {
    window.__brFsqlKeys = true;
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      var press = function (id) { var b = document.getElementById(id); if (b && !b.disabled) { e.preventDefault(); b.click(); } };
      if (!t) return;
      if (t.id === 'fsqlEditor' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) press('fsqlRun');
      else if (t.id === 'fsqlAiQ' && e.key === 'Enter') press('fsqlAiGo');
      else if (t.classList && t.classList.contains('nx-fsql-param') && e.key === 'Enter') press('fsqlParamsRun');
    }, true);
  }

  var KINDS = [{ id: 'TABLE', label: 'Tables' }, { id: 'VIEW', label: 'Views' }, { id: 'MVIEW', label: 'Materialized views' }, { id: 'SYNONYM', label: 'Synonyms' },
    { id: 'PACKAGE', label: 'Packages' }, { id: 'PROCEDURE', label: 'Procedures' }, { id: 'FUNCTION', label: 'Functions' }, { id: 'TRIGGER', label: 'Triggers' },
    { id: 'SEQUENCE', label: 'Sequences' }, { id: 'TYPE', label: 'Types' }];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function ago(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  /** The AI's words as HTML (everything escaped): paragraphs, bullets, `code`, **bold**; its ```sql block is shown apart. */
  function mdHtml(text) {
    var t = String(text || '').replace(/```\s*(sql|knowledge|lookup)?\s*\n[\s\S]*?```/gi, '').trim();
    var out = [], list = [];
    var inline = function (s) { return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); };
    var flush = function () { if (list.length) { out.push('<ul>' + list.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ul>'); list = []; } };
    t.split(/\n/).forEach(function (line) {
      var m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
      if (m) { list.push(m[1]); return; }
      flush();
      if (/^\s*#{1,4}\s+/.test(line)) out.push('<b>' + inline(line.replace(/^\s*#+\s+/, '')) + '</b>');
      else if (line.trim()) out.push('<p>' + inline(line) + '</p>');
    });
    flush();
    return out.join('');
  }

  class PageModule {
    formats() { return exportKit.FORMATS; }
    kindList() { return KINDS; }
    ownerList(s) { var l = (s && s.owners && s.owners.length) ? s.owners.slice() : []; if (s && s.owner && l.indexOf(s.owner) === -1) l.unshift(s.owner); return l.length ? l : ['FUSION']; }

    /** "FUSION · 12,345 tables · read 2 h ago" / what a search found. */
    schemaNote(s) {
      if (!s) return '';
      if (s.loading) return 'Reading from Fusion…';
      var kind = (KINDS.filter(function (k) { return k.id === s.kind; })[0] || { label: s.kind }).label.toLowerCase();
      if (s.found) return s.found.length + ' found in Fusion for “' + s.filter + '”';
      var n = (s.names || []).length;
      var shown = K.filter((s.names || []).map(function (x) { return { N: x }; }), ['N'], s.filter).length;
      return (s.filter ? shown + ' of ' : '') + n.toLocaleString() + ' ' + kind + (s.capped ? ' (cut)' : '') + (s.at ? ' · read ' + ago(s.at) : '');
    }
    /** The names shown: the search's, else the cached list filtered by every word typed; at most 300. */
    objectRows(s) {
      if (!s) return [];
      var src = s.found || s.names || [];
      var words = String(s.filter || '').toUpperCase().split(/\s+/).filter(Boolean);
      var list = s.found ? src : src.filter(function (n) { return words.every(function (w) { return n.toUpperCase().indexOf(w) !== -1; }); });
      return list.slice(0, 300).map(function (n) { return { name: n }; });
    }
    qualified(s, name) { return s && s.owner && s.owner !== 'FUSION' && s.owner !== 'PUBLIC' ? s.owner + '.' + name : name; }

    whoText(st) {
      var p = ((st && st.pods) || []).filter(function (x) { return x.active; })[0];
      if (!p) return '';
      return (p.username ? 'as ' + p.username : 'no login yet') + (p.login === 'app' ? ' (your app\'s login)' : '');
    }
    podLine(p) {
      var who = p.login === 'app' ? 'Your app\'s login' + (p.username ? ' (' + p.username + ')' : ' — none on this PC yet') : (p.username || '?') + (p.hasPassword ? '' : ' — no password on this PC');
      return who + ' · ' + p.reportPath + (p.testedAt ? ' · tested ' + ago(p.testedAt) + (p.testOk ? ' ✓' : ' ✗') : '') + (p.deployedAt ? ' · runner deployed ' + ago(p.deployedAt) : '');
    }
    countText(res, grid) {
      if (!res) return '';
      var n = res.rowCount.toLocaleString() + (res.rowCount === 1 ? ' row' : ' rows');
      var f = grid && grid.shown !== grid.total ? grid.shown.toLocaleString() + ' of ' : '';
      return f + n + ' · ' + (res.columns || []).length + ' columns · ' + (res.ms >= 1000 ? (res.ms / 1000).toFixed(1) + ' s' : res.ms + ' ms') + (res.pod ? ' · ' + res.pod : '');
    }
    historyRows(list) {
      return (list || []).map(function (h, i) { return { i: String(i), sql: h.sql, short: String(h.sql).replace(/\s+/g, ' ').slice(0, 160), when: ago(h.at) }; });
    }
    queryRows(list, q) {
      var words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
      return (list || []).filter(function (x) { var hay = (x.name + ' ' + (x.description || '') + ' ' + x.sql).toLowerCase(); return words.every(function (w) { return hay.indexOf(w) !== -1; }); })
        .map(function (x) { return { id: x.id, name: x.name, description: x.description || '', short: String(x.sql).replace(/\s+/g, ' ').slice(0, 180),
          meta: [x.runs ? 'run ' + x.runs + (x.runs === 1 ? ' time' : ' times') : 'not run yet', x.lastRun ? 'last ' + ago(x.lastRun) : '', x.updatedAt ? 'saved ' + ago(x.updatedAt) : '', x.by ? 'by ' + x.by : ''].filter(Boolean).join(' · ') }; });
    }
    aiRows(msgs) {
      return (msgs || []).map(function (m, i) {
        var lookups = (m.steps || []).filter(function (s) { return s.kind === 'lookup'; }).length;
        return { i: String(i), role: m.role, text: m.text, html: m.role === 'assistant' ? mdHtml(m.text) : '', sql: m.sql || '', checked: !!m.checked, checkError: m.checkError || '',
          lookups: lookups, meta: lookups + ' look-up' + (lookups === 1 ? '' : 's') + ' in the data dictionary' + (m.provider ? ' · ' + m.provider : '') };
      });
    }
    stepText(s) {
      var icon = { hints: '🧭', ai: '✨', lookup: '🔎', check: '🧪', checked: s.ok ? '✓' : '✗' }[s.kind] || '•';
      return icon + ' ' + s.label;
    }
    // Fusion Setups
    setupFilters() { return SK.FILTERS; }
    setupRows(su) { return SK.taskRows(su); }
    setupMods(su) { return SK.moduleRows(su); }
    setupShownCount(su) { return SK.shown(su).length; }
    setupPct(t) { return SK.pct(t || {}); }
    podName(st) { var p = ((st && st.pods) || []).filter(function (x) { return x.active; })[0]; return p ? p.name : 'no pod yet'; }
    /** "Check all 83" / "Check the 9 shown". */
    setupCheckLabel(su) {
      var n = SK.shown(su).length;
      var all = (su.tasks || []).filter(function (t) { return t.active !== false; }).length;
      return n === all ? 'Check all ' + n : 'Check the ' + n + ' shown';
    }
    setupRunText(su) {
      var r = su && su.run;
      if (!r) return '';
      return (su.stop ? 'Stopping after this one… ' : 'Checking ') + (r.done + 1 > r.total ? r.total : r.done + 1) + ' of ' + r.total + (r.label ? ': ' + r.label : '') + ' · ' + r.ok + ' done, ' + r.missing + ' not done, ' + r.errors + ' errors';
    }
    setupDataText(sd) {
      if (!sd) return '';
      if (sd.busy) return 'Running its SQL on the pod…';
      var res = sd.res;
      if (!res || !res.ok) return '';
      var g = sd.grid || {};
      return (g.shown !== g.total ? g.shown.toLocaleString() + ' of ' : '') + res.rowCount.toLocaleString() + (res.rowCount === 1 ? ' record' : ' records') + (res.capped ? ' (the first 1,000)' : '')
        + ' · ' + (res.ms >= 1000 ? (res.ms / 1000).toFixed(1) + ' s' : res.ms + ' ms') + (sd.task.fsm ? ' · FSM task: ' + sd.task.fsm : '');
    }
    callRows(list) {
      return (list || []).map(function (c, i) {
        var d = new Date(c.at);
        return { i: i, when: isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 8), kind: c.kind, status: c.status ? 'HTTP ' + c.status : 'no answer', ms: c.ms + ' ms', bad: !c.status || c.status >= 400,
          url: c.url, headers: c.headers, request: c.request, response: c.response, decoded: c.decoded || '' };
      });
    }
  }

  return PageModule;
});
