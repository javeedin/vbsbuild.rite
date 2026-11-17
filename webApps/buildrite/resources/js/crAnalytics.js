define([], function () {
  'use strict';

  // Change requests › Analytics (pure — no DOM, no `this`): from the change requests as the list has them
  // (desktop/lib/changeRequests.js view: status, kind, priority, page, customer, people, dates, fixSum = its Code Fix in
  // short), the figures a lead looks at: how many, how many fixed and how fast, page by page what changed and what
  // kind of change, who asks and for whom, which files move most, the weeks' trend, what is late and how old the open
  // ones are.
  //
  //   model(requests, { now, weeks }) → { total, kpis, status, kinds, priorities, pages, areas, customers, requesters,
  //                                      fixers, files, weeks, ageing, overdue, recent }

  var DAY = 86400000;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var STATUS = [['new', 'New'], ['progress', 'In progress'], ['fixed', 'Fixed'], ['hold', 'On hold'], ['closed', 'Closed']];
  var KINDS = [['fix', 'Fix a bug'], ['enhance', 'Enhance'], ['change', 'Change']];
  var PRIS = [['urgent', 'Urgent'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
  var AGES = [[0, 7, 'Up to a week'], [8, 30, '8–30 days'], [31, 90, '1–3 months'], [91, Infinity, 'Over 3 months']];

  function groupOf(r) {
    var s = r && r.status;
    if (s === 'fixed') return 'fixed';
    if (s === 'hold') return 'hold';
    if (s === 'closed' || s === 'rejected') return 'closed';
    if (!s || s === 'new') return 'new';
    return 'progress';
  }
  /** A day (YYYY-MM-DD, or an ISO time) as ms at local midnight; NaN when there is none. */
  function dayMs(v) {
    var s = String(v || '');
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return NaN;
    if (s.length > 10) { var d = new Date(s); if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  }
  function dayText(ms) { if (isNaN(ms)) return ''; var d = new Date(ms); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); }
  var asked = function (r) { var a = dayMs(r.requestedOn); return isNaN(a) ? dayMs(r.createdAt) : a; };
  var fixedAt = function (r) { var f = dayMs(r.fixedOnShown || r.fixedOn); return isNaN(f) && r.fixSum ? dayMs(r.fixSum.savedAt) : f; };
  var daysToFix = function (r) { var a = asked(r), f = fixedAt(r); return isNaN(a) || isNaN(f) ? NaN : Math.max(0, Math.round((f - a) / DAY)); };
  var pct = function (n, of) { return of ? Math.round((n / of) * 100) : 0; };
  var width = function (n, max) { return max ? Math.max(n ? 2 : 0, Math.round((n / max) * 100)) + '%' : '0%'; };
  function median(list) { if (!list.length) return NaN; var s = list.slice().sort(function (a, b) { return a - b; }); var h = Math.floor(s.length / 2); return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; }
  function daysText(n) { return isNaN(n) ? '—' : (n < 1 ? 'same day' : (Math.round(n * 10) / 10) + (n === 1 ? ' day' : ' days')); }
  /** The Monday a day falls in (local). */
  function weekOf(ms) { var d = new Date(ms); var back = (d.getDay() + 6) % 7; return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime(); }

  /** Counted by a key, the biggest first (ties by name): [{ key, label, n, fixed, open, … }]. */
  function tally(list, keyOf, labelOf) {
    var m = {};
    list.forEach(function (r) {
      var k = keyOf(r);
      if (!k) return;
      var x = m[k] || (m[k] = { key: k, label: labelOf ? labelOf(r, k) : k, n: 0, fixed: 0, open: 0, closed: 0 });
      x.n++;
      var g = groupOf(r);
      if (g === 'fixed') x.fixed++; else if (g === 'closed') x.closed++; else x.open++;
    });
    var none = function (x) { return /^\(/.test(String(x.label)) ? 1 : 0; }; // (no customer), (not said): last
    var out = Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return none(a) - none(b) || b.n - a.n || String(a.label).localeCompare(String(b.label)); });
    var max = out.reduce(function (n, x) { return Math.max(n, x.n); }, 0);
    out.forEach(function (x) { x.w = width(x.n, max); x.wFixed = width(x.fixed, max); x.pctFixed = pct(x.fixed, x.n); });
    return out;
  }

  function model(requests, opts) {
    var o = opts || {};
    var now = o.now != null ? Number(o.now) : Date.now();
    var today = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime();
    var list = (requests || []).filter(Boolean);
    var total = list.length;
    var by = function (g) { return list.filter(function (r) { return groupOf(r) === g; }); };
    var fixedList = by('fixed');
    var open = list.filter(function (r) { var g = groupOf(r); return g === 'new' || g === 'progress' || g === 'hold'; });
    var days = fixedList.map(daysToFix).filter(function (n) { return !isNaN(n); });
    var avg = days.length ? days.reduce(function (a, b) { return a + b; }, 0) / days.length : NaN;
    var firstTime = fixedList.filter(function (r) { return (r.attempts || 0) <= 1; }).length;
    var added = 0, removed = 0, fileSet = {}, pageSet = {};
    list.forEach(function (r) {
      if (r.page) pageSet[r.page] = true;
      var s = r.fixSum;
      if (!s || (s.status !== 'committed' && s.status !== 'applied')) return;
      added += s.added || 0; removed += s.removed || 0;
      (s.files || []).forEach(function (f) { fileSet[f.file] = true; });
    });
    var overdue = open.filter(function (r) { return r.dueOn && dayMs(r.dueOn) < today; });
    var attempts = list.filter(function (r) { return r.attempts; });

    var kpis = [
      { key: 'total', n: String(total), label: 'change requests', sub: Object.keys(pageSet).length + ' page' + (Object.keys(pageSet).length === 1 ? '' : 's') },
      { key: 'open', n: String(open.length), label: 'open', sub: by('progress').length + ' in progress · ' + by('new').length + ' new' },
      { key: 'fixed', n: String(fixedList.length), label: 'fixed', sub: pct(fixedList.length, total - by('closed').length) + '% of those not closed' },
      { key: 'speed', n: daysText(avg), label: 'average time to fix', sub: 'median ' + daysText(median(days)) },
      { key: 'first', n: fixedList.length ? pct(firstTime, fixedList.length) + '%' : '—', label: 'fixed at the first try', sub: attempts.length ? (function (x) { return x + ' AI attempt' + (x === 1 ? '' : 's') + ' on average'; }(Math.round((attempts.reduce(function (a, r) { return a + r.attempts; }, 0) / attempts.length) * 10) / 10)) : 'no attempt yet' },
      { key: 'lines', n: '+' + added + ' −' + removed, label: 'lines changed', sub: Object.keys(fileSet).length + ' file' + (Object.keys(fileSet).length === 1 ? '' : 's') + ' touched' },
      { key: 'late', n: String(overdue.length), label: 'overdue', sub: overdue.length ? 'past their due date, not fixed' : 'nothing late', tone: overdue.length ? 'bad' : 'ok' }
    ];

    var status = STATUS.map(function (s) { var n = by(s[0]).length; return { key: s[0], label: s[1], n: n, pct: pct(n, total), w: total ? (n / total) * 100 + '%' : '0%' }; });
    var kinds = KINDS.map(function (k) {
      var of = list.filter(function (r) { return (r.kind || 'change') === k[0]; });
      var f = of.filter(function (r) { return groupOf(r) === 'fixed'; }).length;
      return { key: k[0], label: k[1], n: of.length, fixed: f, pct: pct(of.length, total), w: total ? (of.length / total) * 100 + '%' : '0%', pctFixed: pct(f, of.length) };
    });
    var priorities = PRIS.map(function (p) {
      var of = list.filter(function (r) { return (r.priority || 'medium') === p[0]; });
      return { key: p[0], label: p[1], n: of.length, fixed: of.filter(function (r) { return groupOf(r) === 'fixed'; }).length, open: of.filter(function (r) { var g = groupOf(r); return g === 'new' || g === 'progress' || g === 'hold'; }).length };
    });
    var pmax = priorities.reduce(function (n, x) { return Math.max(n, x.n); }, 0);
    priorities.forEach(function (x) { x.w = width(x.n, pmax); });

    // page by page: how many, of which kind, fixed or not, the lines and files its fixes changed, the last one
    var pages = tally(list, function (r) { return r.page; }, function (r, k) { return r.pageLabel || String(k).split('/').pop(); });
    pages.forEach(function (p) {
      var of = list.filter(function (r) { return r.page === p.key; });
      p.kinds = { fix: 0, enhance: 0, change: 0 };
      p.progress = 0; p.added = 0; p.removed = 0;
      var files = {}, last = 0, d = [];
      of.forEach(function (r) {
        p.kinds[r.kind || 'change'] = (p.kinds[r.kind || 'change'] || 0) + 1;
        if (groupOf(r) === 'progress') p.progress++;
        var s = r.fixSum;
        if (s && (s.status === 'committed' || s.status === 'applied')) { p.added += s.added || 0; p.removed += s.removed || 0; (s.files || []).forEach(function (f) { files[f.file] = true; }); }
        var at = dayMs(r.updatedAt || r.createdAt);
        if (!isNaN(at) && at > last) last = at;
        var dd = daysToFix(r);
        if (groupOf(r) === 'fixed' && !isNaN(dd)) d.push(dd);
      });
      p.files = Object.keys(files).length;
      p.last = dayText(last);
      p.avgDays = d.length ? daysText(d.reduce(function (a, b) { return a + b; }, 0) / d.length) : '—';
      p.overdue = of.filter(function (r) { var g = groupOf(r); return r.dueOn && g !== 'fixed' && g !== 'closed' && dayMs(r.dueOn) < today; }).length;
      // the kinds as one bar (of this page's requests)
      p.kindBar = KINDS.map(function (k) { return { key: k[0], label: k[1], n: p.kinds[k[0]] || 0, w: p.n ? ((p.kinds[k[0]] || 0) / p.n) * 100 + '%' : '0%' }; }).filter(function (x) { return x.n; });
      p.kindText = KINDS.filter(function (k) { return p.kinds[k[0]]; }).map(function (k) { return p.kinds[k[0]] + ' ' + k[1].toLowerCase(); }).join(' · ');
      var flowParts = String(p.key).split('/');
      p.area = flowParts.length >= 2 ? flowParts[0] + '/' + flowParts[1] : p.key;
    });
    // an area: the app's flow the pages are in
    var areas = tally(list, function (r) { var x = String(r.page || '').split('/'); return x.length >= 2 ? x[0] + '/' + x[1] : r.page; }, function (r, k) { return k; });

    var customers = tally(list, function (r) { return String(r.customer || '').trim() || '(no customer)'; }).slice(0, 10);
    var requesters = tally(list, function (r) { return String(r.requestedBy || '').trim() || '(not said)'; }).slice(0, 10);
    var fx = {};
    fixedList.forEach(function (r) {
      var who = String(r.fixedByShown || r.fixedBy || (r.fixSum && r.fixSum.approvedBy) || '').trim() || '(not said)';
      var x = fx[who] || (fx[who] = { key: who, label: who, n: 0, lines: 0, days: [] });
      x.n++; x.lines += r.fixSum ? (r.fixSum.added || 0) + (r.fixSum.removed || 0) : 0;
      var dd = daysToFix(r); if (!isNaN(dd)) x.days.push(dd);
    });
    var fixers = Object.keys(fx).map(function (k) { var x = fx[k]; x.avgDays = x.days.length ? daysText(x.days.reduce(function (a, b) { return a + b; }, 0) / x.days.length) : '—'; delete x.days; return x; })
      .sort(function (a, b) { return b.n - a.n || a.label.localeCompare(b.label); });
    var fmax = fixers.reduce(function (n, x) { return Math.max(n, x.n); }, 0);
    fixers.forEach(function (x) { x.w = width(x.n, fmax); });

    // the files their saved changes touch most
    var fm = {};
    list.forEach(function (r) {
      var s = r.fixSum;
      if (!s || (s.status !== 'committed' && s.status !== 'applied')) return;
      (s.files || []).forEach(function (f) { var x = fm[f.file] || (fm[f.file] = { file: f.file, name: f.file.split('/').pop(), n: 0, added: 0, removed: 0 }); x.n++; x.added += f.added || 0; x.removed += f.removed || 0; });
    });
    var files = Object.keys(fm).map(function (k) { return fm[k]; }).sort(function (a, b) { return b.n - a.n || (b.added + b.removed) - (a.added + a.removed) || a.file.localeCompare(b.file); }).slice(0, 10);

    // the weeks: asked and fixed, each week (Monday) of the last n
    var nW = Math.max(4, Math.min(26, Number(o.weeks) || 12));
    var w0 = weekOf(today) - (nW - 1) * 7 * DAY;
    var weeks = [];
    for (var i = 0; i < nW; i++) {
      var ws = w0 + i * 7 * DAY, we = ws + 7 * DAY;
      var inW = function (ms) { return !isNaN(ms) && ms >= ws && ms < we; };
      weeks.push({ start: ws, label: dayText(ws).replace(/ \d{4}$/, ''), asked: list.filter(function (r) { return inW(asked(r)); }).length, fixed: fixedList.filter(function (r) { return inW(fixedAt(r)); }).length, current: i === nW - 1 });
    }
    var wmax = weeks.reduce(function (n, x) { return Math.max(n, x.asked, x.fixed); }, 0);
    weeks.forEach(function (x) { x.hAsked = width(x.asked, wmax); x.hFixed = width(x.fixed, wmax); x.tip = 'Week of ' + dayText(x.start) + ': ' + x.asked + ' asked, ' + x.fixed + ' fixed'; });

    // how old the open ones are
    var ageing = AGES.map(function (a) {
      var of = open.filter(function (r) { var d0 = asked(r); var age = isNaN(d0) ? 0 : Math.round((today - d0) / DAY); return age >= a[0] && age <= a[1]; });
      return { label: a[2], n: of.length };
    });
    var amax = ageing.reduce(function (n, x) { return Math.max(n, x.n); }, 0);
    ageing.forEach(function (x) { x.w = width(x.n, amax); });

    var late = overdue.map(function (r) { return { id: r.id, code: r.code, title: r.title || String(r.request || '').slice(0, 70), page: r.pageLabel || r.page, due: dayText(dayMs(r.dueOn)), days: Math.round((today - dayMs(r.dueOn)) / DAY), priority: r.priority || 'medium' }; })
      .sort(function (a, b) { return b.days - a.days; });
    var recent = fixedList.map(function (r) { return { id: r.id, code: r.code, title: r.title || String(r.request || '').slice(0, 70), page: r.pageLabel || r.page, at: fixedAt(r), when: dayText(fixedAt(r)), took: daysText(daysToFix(r)), lines: r.fixSum ? '+' + (r.fixSum.added || 0) + ' −' + (r.fixSum.removed || 0) : '' }; })
      .sort(function (a, b) { return (b.at || 0) - (a.at || 0); }).slice(0, 6);

    return { total: total, kpis: kpis, status: status, kinds: kinds, priorities: priorities, pages: pages, areas: areas, customers: customers, requesters: requesters, fixers: fixers,
      files: files, weeks: weeks, ageing: ageing, overdue: late, recent: recent };
  }

  return { model: model, groupOf: groupOf, daysToFix: daysToFix, STATUS: STATUS, KINDS: KINDS };
});
