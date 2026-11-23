define(['resources/js/integrationDiagram'], function (D) {
  'use strict';

  // Saved flows (Application → Page Flows → Saved flows): a page's integration flow saved under a name, then edited —
  // its steps reworded for a business reader, notes, steps and actions added by hand, systems (lanes) named — and checked
  // against the app later. Pure (no DOM, no server): the pages and the tests use the same functions.
  //
  //   A flow: { id (FL-0001, given by the store), name, purpose, area, owner, status (draft | review | approved |
  //     retired), story, tags [], app, source { kind: 'page' | 'blank', page, pageLabel, flow, scannedAt }, lanes [{ id,
  //     name, kind, kindLabel, host }], actions [{ id, trigger, title, note, chain, chains, steps [{ id, system (a lane
  //     id), method, path, endpoint, object, action, direction, summary, via, row, text, note, manual }] }], stickies
  //     [{ id, text, color (yellow | pink | green | blue), action (an action's id; '' = the whole flow), lane (a lane's
  //     id; '' = the page's lane) }], comments,
  //     versions, history, version, created / updated (+ by) }
  //   fromPage(m, page, details)  a new flow from a page of the scan (its steps as the app makes them)
  //   blank(details)               a new flow with nothing in it (to draw by hand)
  //   toModel(flow)                the drawing's model (D.flowSwim) — a step's own words and notes shown
  //   edit(flow, op, args)         a new flow with one change: set (a field of the flow, an action, a step, a lane, a
  //                                sticky note), moveStep / removeStep / addStep, moveAction / removeAction /
  //                                addAction, addLane / removeLane, addSticky / removeSticky. A step's words or an
  //                                action's set to its automatic wording are kept empty (the wording follows the app)
  //   autoText(flow, stepId) / autoTitle(flow, actionId)  the automatic wording of a step / an action
  //   check(flow, m)               the flow against the app now: { ok, pageGone, missing (its steps the page no longer
  //                                makes), added (calls the page makes that the flow does not have), same }
  //   addFromApp(flow, m)          the calls the page makes now that the flow lacks, added under the action that
  //                                makes them
  //   html(flow, { plain, by })    a printable document (PDF): its details, the diagram, its steps, its comments

  var STICKY_COLORS = [['yellow', 'Yellow'], ['pink', 'Pink'], ['green', 'Green'], ['blue', 'Blue']];
  var STATUSES = [['draft', 'Draft'], ['review', 'In review'], ['approved', 'Approved'], ['retired', 'Retired']];
  var statusText = function (k) { var s = STATUSES.filter(function (x) { return x[0] === k; })[0]; return s ? s[1] : 'Draft'; };
  var KIND_OPTIONS = Object.keys(D.KINDS).filter(function (k) { return k !== 'unknown'; }).map(function (k) { return [k, D.KINDS[k].label]; })
    .concat([['email', 'E-mail'], ['file', 'File / SFTP'], ['person', 'A person'], ['other', 'Other system']]);
  var kindLabelOf = function (k) { var x = KIND_OPTIONS.filter(function (y) { return y[0] === k; })[0]; return x ? x[1] : 'Other system'; };
  var str = function (v) { return v === undefined || v === null ? '' : String(v); };
  var clone = function (x) { return JSON.parse(JSON.stringify(x)); };
  var keyOf = function (s) { return str(s.endpoint || s.path) + '|' + str(s.method).toUpperCase(); };

  function details(d) {
    var x = d || {};
    return { name: str(x.name).trim(), purpose: str(x.purpose), area: str(x.area), owner: str(x.owner), status: STATUSES.some(function (s) { return s[0] === x.status; }) ? x.status : 'draft',
      story: str(x.story).trim(), tags: (Array.isArray(x.tags) ? x.tags : str(x.tags).split(',')).map(function (t) { return str(t).trim(); }).filter(Boolean) };
  }

  /** A new flow from a page of the scan: its systems as lanes, its actions and their calls as steps. */
  function fromPage(m, page, d) {
    var pm = D.pageModel(m, page);
    if (!pm) return null;
    var n = 0;
    var f = Object.assign(details(d), {
      app: str(m.app), source: { kind: 'page', page: pm.id, pageLabel: pm.label, flow: (pm.sub || '').split(' · ')[0], scannedAt: str(m.at) },
      lanes: pm.lanes.map(function (s) { return { id: s.id, name: s.name, kind: s.kind, kindLabel: s.kindLabel, host: s.host || '' }; }),
      actions: pm.actions.map(function (a, i) {
        return { id: 'a' + (i + 1), trigger: a.trigger, title: '', note: '', chain: a.chain || '', chains: a.chains || [],
          steps: a.calls.map(function (c) { n++; return { id: 's' + n, system: c.system, method: c.method, path: c.path, endpoint: c.endpoint, object: c.object, action: c.action || '', direction: c.direction,
            summary: c.summary || '', via: c.via || '', row: c.id || '', text: '', note: '', manual: false }; }) };
      })
    });
    if (!f.name) f.name = pm.label + ' flow';
    return f;
  }
  function blank(d) {
    var f = Object.assign(details(d), { app: '', source: { kind: 'blank' }, lanes: [], actions: [{ id: 'a1', trigger: '', title: 'When …', note: '', chain: '', chains: [], steps: [] }] });
    if (!f.name) f.name = 'New flow';
    return f;
  }

  // ── a flow from a recording ("Record from the app"): the pages walked become actions, the API calls each page made
  //    (in the order they fired, page scaffolding left out) become its steps, and the systems they talk to become lanes. ──
  function recPath(c) { var s = str(c.path || ''); if (!s) { s = str(c.url).replace(/#.*$/, ''); var q = s.indexOf('?'); s = (q === -1 ? s : s.slice(0, q)).replace(/^[a-z]+:\/\/[^/]+/i, ''); } return s.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/'; }
  /** A captured call that is page scaffolding (a script, style, image, descriptor…), not a business API call. */
  function recIsAsset(c) {
    if (!c || typeof c !== 'object') return true;
    var u = str(c.url);
    var p = recPath(c);
    if (!p || p === '/') return true;
    if (/\.(css|js|mjs|cjs|map|json|jsonp|xml|html?|txt|md|markdown|wasm|woff2?|ttf|eot|otf|svg|png|jpe?g|gif|ico|webp|avif|bmp|mp4|webm|csv)$/i.test(p)) return true;
    if (/\/version_\d+\/|\/resources\/|\/webapps\/|\/deployments\/|\/dynamicLayouts?\/|requirejs|\/vb\/|\/fnd\/|openapi3?|app-flow|\/_currentuser\b|\/describe\b/i.test(u)) return true;
    if (/(^|\/)(fonts?|images?|img|icons?|assets|static|cdn|css|js)\//i.test(p)) return true;
    return false;
  }
  /** Which system a call talks to (a lane): BI Publisher, Oracle Fusion REST, Oracle APEX (ORDS), else the application. */
  function recLane(c) {
    var s = str(c.url) + ' ' + recPath(c);
    if (/\/xmlpserver\//i.test(s)) return { id: 'bip', name: 'BI Publisher', kind: 'soap' };
    if (/\/(fscm|hcm|crm|scm|prc|fin|expenses|atk)RestApi\//i.test(s) || /oraclecloud/i.test(str(c.url))) return { id: 'fusion', name: 'Oracle Fusion', kind: 'rest' };
    if (/\/ords\//i.test(s)) return { id: 'ords', name: 'Oracle APEX (ORDS)', kind: 'rest' };
    return { id: 'app', name: 'Application', kind: 'rest' };
  }
  /** The business object a path names: its last meaningful segment (ids, {params} and version tags left out). */
  function recObject(path) {
    var segs = str(path).split('/').filter(Boolean).filter(function (s) { return !/^\{.*\}$/.test(s) && !/^:/.test(s) && !/^\d+$/.test(s) && !/^v\d+$/i.test(s); });
    return segs[segs.length - 1] || '';
  }

  /** A new flow from a recorded Process Flow ({ id, name, pages:[{ page, name, calls:[…] }] }): actions per page, steps per call. */
  function fromRecording(recorded, d) {
    var rf = recorded && typeof recorded === 'object' ? recorded : {};
    var lanesById = {};
    var laneOrder = [];
    var actions = [];
    var n = 0;
    (Array.isArray(rf.pages) ? rf.pages : []).forEach(function (p, pi) {
      var calls = (Array.isArray(p && p.calls) ? p.calls : []).filter(function (c) { return !recIsAsset(c); });
      if (!calls.length) return;
      var steps = calls.map(function (c) {
        var lane = recLane(c);
        if (!lanesById[lane.id]) { lanesById[lane.id] = { id: lane.id, name: lane.name, kind: lane.kind, kindLabel: kindLabelOf(lane.kind), host: '' }; laneOrder.push(lane.id); }
        n++;
        var path = recPath(c);
        return { id: 's' + n, system: lane.id, method: str(c.method || 'GET').toUpperCase(), path: path, endpoint: path, object: recObject(path),
          action: '', direction: 'out', summary: '', via: '', row: '', text: '', note: '', manual: false };
      });
      actions.push({ id: 'a' + (actions.length + 1), trigger: 'On ' + (str(p.name) || str(p.page) || ('page ' + (pi + 1))), title: '', note: '', chain: '', chains: [], steps: steps });
    });
    if (!actions.length) return null;
    var f = Object.assign(details(d), {
      app: str(rf.app || ''),
      source: { kind: 'recording', flowId: str(rf.id || ''), flowName: str(rf.name || ''),
        pages: (Array.isArray(rf.pages) ? rf.pages : []).map(function (p) { return str(p.name || p.page || ''); }).filter(Boolean),
        recordedAt: str(rf.recordedAt || rf.updated || rf.at || '') },
      lanes: laneOrder.map(function (id) { return lanesById[id]; }), actions: actions });
    if (!f.name) f.name = (str(rf.name) || 'Recording') + ' flow';
    return f;
  }

  /** The drawing's model (D.flowSwim): its lanes, its actions and steps — a step's own words and notes shown. */
  function toModel(flow) {
    var f = flow || {};
    var lanes = (f.lanes || []).map(function (l) { return { id: l.id, name: l.name || l.id, kind: D.KINDS[l.kind] ? l.kind : 'rest', kindLabel: l.kindLabel || kindLabelOf(l.kind), host: l.host || '' }; });
    var nameOf = function (id) { var l = lanes.filter(function (x) { return x.id === id; })[0]; return l ? l.name : id; };
    var kindOf = function (id) { var l = lanes.filter(function (x) { return x.id === id; })[0]; return l ? l.kind : 'rest'; };
    var steps = (f.actions || []).reduce(function (a, x) { return a + (x.steps || []).length; }, 0);
    return { id: f.id || '', label: f.name || 'Flow', kicker: (f.id ? f.id + ' · ' : '') + statusText(f.status) + (f.version ? ' · v' + f.version : ''),
      sub: (f.source && f.source.pageLabel ? f.source.pageLabel + ' · ' : '') + steps + ' step' + (steps === 1 ? '' : 's'), title: f.name || 'Flow',
      lanes: lanes,
      actions: (f.actions || []).map(function (a) {
        return { trigger: a.trigger || a.title || 'When …', title: a.title || '', note: a.note || '', chain: a.chain || '', chains: a.chains || [],
          calls: (a.steps || []).map(function (s) { return Object.assign({}, s, { systemName: nameOf(s.system), kind: kindOf(s.system) }); }) };
      }),
      // sticky notes: on an action (its index) in a lane ('' = the page's), or on the whole flow (action -1); one placed
      // by hand (dragged on the Flow tab) keeps where it was put and its size
      stickies: (f.stickies || []).map(function (n) {
        var o = { id: n.id, text: n.text || '', color: n.color || 'yellow', action: (f.actions || []).map(function (a) { return a.id; }).indexOf(n.action), lane: lanes.some(function (l) { return l.id === n.lane; }) ? n.lane : '' };
        if (placed(n)) { o.x = n.x; o.y = n.y; o.w = n.w; o.h = n.h; }
        return o;
      }) };
  }

  /** A sticky note placed by hand (x, y — dragged on the Flow tab), not laid out under an action. */
  function placed(n) { return !!n && typeof n.x === 'number' && typeof n.y === 'number' && isFinite(n.x) && isFinite(n.y); }
  var clampN = function (v, lo, hi, d) { var k = Number(v); return isFinite(k) ? Math.max(lo, Math.min(hi, Math.round(k))) : d; };

  // ── editing: each change gives a new flow ──
  var allSteps = function (f) { return (f.actions || []).reduce(function (a, x) { return a.concat(x.steps || []); }, []); };
  var nextId = function (prefix, ids) { var n = ids.reduce(function (m, id) { var k = Number(String(id).replace(prefix, '')); return isNaN(k) ? m : Math.max(m, k); }, 0); return prefix + (n + 1); };
  var findStep = function (f, sid) { for (var i = 0; i < f.actions.length; i++) { var j = (f.actions[i].steps || []).map(function (s) { return s.id; }).indexOf(sid); if (j !== -1) return { a: i, s: j }; } return null; };
  var slug = function (t) { return str(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'system'; };
  var FIELDS = { flow: ['name', 'purpose', 'area', 'owner', 'status', 'story', 'tags'], a: ['title', 'note', 'trigger'], s: ['text', 'note', 'system', 'method', 'object', 'direction'], l: ['name', 'kind', 'host'], n: ['text', 'color', 'action', 'lane'] };
  /** A step's automatic wording (its plain-English sentence) and an action's (when it happens, in words). */
  function autoText(flow, sid) {
    var md = toModel(flow);
    for (var i = 0; i < md.actions.length; i++) { var c = md.actions[i].calls.filter(function (x) { return x.id === sid; })[0]; if (c) return c.manual ? '' : D.plainStep(c).sentence; }
    return '';
  }
  function autoTitle(flow, aid) { var a = ((flow && flow.actions) || []).filter(function (x) { return x.id === aid; })[0]; return a && a.trigger ? D.plainTrigger(a.trigger) : ''; }

  function edit(flow, op, args) {
    var f = clone(flow || {});
    var x = args || {};
    f.actions = f.actions || [];
    f.lanes = f.lanes || [];
    if (op === 'set') {
      // what: 'name' (the flow) | 'a.<id>.title' | 's.<id>.text' | 'l.<id>.name' …
      var p = str(x.what).split('.');
      if (p.length === 1 && FIELDS.flow.indexOf(p[0]) !== -1) {
        if (p[0] === 'tags') f.tags = str(x.value).split(',').map(function (t) { return t.trim(); }).filter(Boolean);
        else f[p[0]] = p[0] === 'status' ? details({ status: x.value }).status : str(x.value);
      } else if (p[0] === 'a' && FIELDS.a.indexOf(p[2]) !== -1) {
        var a = f.actions.filter(function (y) { return y.id === p[1]; })[0];
        // its automatic wording left as it was: kept empty, so it follows the app
        if (a) a[p[2]] = p[2] === 'title' && str(x.value).trim() === autoTitle(f, a.id) ? '' : str(x.value);
      } else if (p[0] === 's' && FIELDS.s.indexOf(p[2]) !== -1) {
        var at = findStep(f, p[1]);
        if (at) {
          var st = f.actions[at.a].steps[at.s];
          st[p[2]] = p[2] === 'text' && !st.manual && str(x.value).trim() === autoText(f, st.id) ? '' : str(x.value);
          if (p[2] === 'method' && st.manual) st.direction = /^(GET|HEAD)$/i.test(st.method) ? 'Read' : st.method ? 'Write' : st.direction;
        }
      } else if (p[0] === 'n' && FIELDS.n.indexOf(p[2]) !== -1) {
        var nt = (f.stickies || []).filter(function (y) { return y.id === p[1]; })[0];
        if (nt && (p[2] === 'action' || p[2] === 'lane') && x.value === '__placed') return f; // "where it was dragged": as it is
        if (nt) nt[p[2]] = p[2] === 'color' ? (STICKY_COLORS.some(function (c) { return c[0] === x.value; }) ? x.value : 'yellow') : str(x.value);
        // an action or a lane chosen: the note goes back there (laid out under its steps), no longer where it was dragged
        if (nt && (p[2] === 'action' || p[2] === 'lane')) { delete nt.x; delete nt.y; delete nt.w; delete nt.h; }
      } else if (p[0] === 'l' && FIELDS.l.indexOf(p[2]) !== -1) {
        var l = f.lanes.filter(function (y) { return y.id === p[1]; })[0];
        if (l) { l[p[2]] = str(x.value); if (p[2] === 'kind') l.kindLabel = kindLabelOf(l.kind); }
      }
      return f;
    }
    if (op === 'moveStep' || op === 'removeStep') {
      var w = findStep(f, x.id);
      if (!w) return f;
      var list = f.actions[w.a].steps;
      if (op === 'removeStep') { list.splice(w.s, 1); return f; }
      var to = w.s + (Number(x.by) || 0);
      if (to >= 0 && to < list.length) { var t0 = list[to]; list[to] = list[w.s]; list[w.s] = t0; }
      else if (to < 0 && w.a > 0) f.actions[w.a - 1].steps.push(list.splice(w.s, 1)[0]); // up out of the first place: the end of the action before
      else if (to >= list.length && w.a < f.actions.length - 1) f.actions[w.a + 1].steps.unshift(list.splice(w.s, 1)[0]);
      return f;
    }
    if (op === 'addStep') {
      var a2 = f.actions.filter(function (y) { return y.id === x.action; })[0] || f.actions[f.actions.length - 1];
      if (!a2) { a2 = { id: nextId('a', []), trigger: '', title: 'When …', note: '', chain: '', chains: [], steps: [] }; f.actions.push(a2); }
      var lane = x.system || (a2.steps.length ? a2.steps[a2.steps.length - 1].system : (f.lanes[0] || {}).id);
      if (!lane) { f.lanes.push({ id: 'system-1', name: 'A system', kind: 'other', kindLabel: kindLabelOf('other'), host: '' }); lane = 'system-1'; }
      a2.steps.push({ id: nextId('s', allSteps(f).map(function (s) { return s.id; })), system: lane, method: '', path: '', endpoint: '', object: '', action: '', direction: 'Read', summary: '', via: '', row: '',
        text: str(x.text) || 'New step — say what happens', note: '', manual: true });
      return f;
    }
    if (op === 'moveAction' || op === 'removeAction') {
      var i = f.actions.map(function (y) { return y.id; }).indexOf(x.id);
      if (i === -1) return f;
      if (op === 'removeAction') {
        // its sticky notes stay, on the whole flow
        (f.stickies || []).forEach(function (n) { if (n.action === x.id) n.action = ''; });
        f.actions.splice(i, 1);
        return f;
      }
      var j = i + (Number(x.by) || 0);
      if (j >= 0 && j < f.actions.length) { var t1 = f.actions[j]; f.actions[j] = f.actions[i]; f.actions[i] = t1; }
      return f;
    }
    if (op === 'addAction') {
      f.actions.push({ id: nextId('a', f.actions.map(function (y) { return y.id; })), trigger: '', title: str(x.title) || 'When …', note: '', chain: '', chains: [], steps: [] });
      return f;
    }
    if (op === 'addLane') {
      var name = str(x.name).trim() || 'New system';
      var id = slug(name);
      while (f.lanes.some(function (y) { return y.id === id; })) id += '-2';
      f.lanes.push({ id: id, name: name, kind: x.kind || 'other', kindLabel: kindLabelOf(x.kind || 'other'), host: '' });
      return f;
    }
    if (op === 'removeLane') {
      if (allSteps(f).some(function (s) { return s.system === x.id; })) return f; // a lane with steps stays
      f.lanes = f.lanes.filter(function (y) { return y.id !== x.id; });
      (f.stickies || []).forEach(function (n) { if (n.lane === x.id) n.lane = ''; }); // its sticky notes: the page's lane
      return f;
    }
    if (op === 'addSticky') {
      f.stickies = f.stickies || [];
      var nn = { id: nextId('n', f.stickies.map(function (y) { return y.id; })), text: str(x.text), color: STICKY_COLORS.some(function (c) { return c[0] === x.color; }) ? x.color : 'yellow',
        action: f.actions.some(function (a) { return a.id === x.action; }) ? x.action : '', lane: f.lanes.some(function (l) { return l.id === x.lane; }) ? x.lane : '' };
      // added on the Flow tab: placed where you are looking, ready to drag
      if (x.x != null && x.y != null) { nn.x = clampN(x.x, 0, 20000, 0); nn.y = clampN(x.y, 0, 20000, 0); nn.w = clampN(x.w, 80, 1200, 230); nn.h = clampN(x.h, 40, 1200, 96); }
      f.stickies.push(nn);
      return f;
    }
    // a sticky note dragged or resized on the Flow tab (diagram units). One laid out until now (under an action) takes no
    // room any more, so the action band it was dropped on may move up: it moves with it, staying over what it was put on.
    if (op === 'placeSticky') {
      var sn = (f.stickies || []).filter(function (y) { return y.id === x.id; })[0];
      if (!sn) return f;
      var px = clampN(x.x, 0, 20000, 0), py = clampN(x.y, 0, 20000, 0), pw = clampN(x.w, 80, 1200, 230), ph = clampN(x.h, 40, 1200, 96);
      var before = placed(sn) ? null : D.flowSwim(toModel(f), { live: true });
      sn.x = px; sn.y = py; sn.w = pw; sn.h = ph;
      if (before) {
        var at = py + 10;
        var b0 = before.bands.filter(function (b) { return at >= b.y && at < b.y + b.h; })[0];
        var after = b0 ? D.flowSwim(toModel(f), { live: true }) : null;
        var b1 = after ? after.bands.filter(function (b) { return b.action === b0.action; })[0] : null;
        if (b1) sn.y = Math.max(0, py + (b1.y - b0.y));
      }
      return f;
    }
    if (op === 'removeSticky') { f.stickies = (f.stickies || []).filter(function (y) { return y.id !== x.id; }); return f; }
    return f;
  }
  /** Can this lane go (no step is in it)? */
  var laneUsed = function (f, id) { return allSteps(f || {}).some(function (s) { return s.system === id; }); };

  /** The flow against the app now: the steps the page no longer makes, the calls it makes that the flow does not have. */
  function check(flow, m) {
    var f = flow || {};
    if (f.source && f.source.kind === 'recording') return { ok: true, skipped: true, missing: [], added: [], same: 0, text: 'Built from a recording of the app — nothing to re-check against a page. Record again for a fresh capture.' };
    if (!f.source || f.source.kind !== 'page') return { ok: true, skipped: true, missing: [], added: [], same: 0, text: 'Drawn by hand — nothing to check against the app.' };
    var pf = ((m && m.pageFlows) || []).filter(function (x) { return x.page === f.source.page; })[0];
    if (!pf) return { ok: false, pageGone: true, missing: [], added: [], same: 0, text: 'The page ' + (f.source.pageLabel || f.source.page) + ' makes no call now (or is gone).' };
    var mine = allSteps(f).filter(function (s) { return !s.manual; });
    var now = {};
    pf.steps.forEach(function (st) { st.calls.forEach(function (c) { var k = keyOf(c); if (!now[k]) now[k] = { call: c, trigger: st.trigger }; }); });
    var have = {};
    mine.forEach(function (s) { have[keyOf(s)] = true; });
    var missing = mine.filter(function (s) { return !now[keyOf(s)]; }).map(function (s) { return { id: s.id, label: (s.method ? s.method + ' ' : '') + (s.path || s.endpoint), object: s.object }; });
    var added = Object.keys(now).filter(function (k) { return !have[k]; }).map(function (k) { var c = now[k].call; return { label: c.method + ' ' + (c.path || c.endpoint), object: c.object, system: c.systemName, trigger: now[k].trigger }; });
    var same = mine.length - missing.length;
    var ok = !missing.length && !added.length;
    return { ok: ok, pageGone: false, missing: missing, added: added, same: same,
      text: ok ? 'Matches the app: all ' + same + ' of its app steps are still made, and the page makes no call it lacks.'
        : [missing.length ? missing.length + ' step' + (missing.length === 1 ? '' : 's') + ' the page no longer makes' : '', added.length ? added.length + ' new call' + (added.length === 1 ? '' : 's') + ' the flow does not have' : ''].filter(Boolean).join(' · ') };
  }
  /** The calls the page makes now that the flow lacks: added under the action that makes them (a new action when none). */
  function addFromApp(flow, m) {
    var f = clone(flow || {});
    var r = check(f, m);
    if (r.skipped || r.pageGone || !r.added.length) return f;
    var pf = m.pageFlows.filter(function (x) { return x.page === f.source.page; })[0];
    var have = {};
    allSteps(f).forEach(function (s) { have[keyOf(s)] = true; });
    pf.steps.forEach(function (st) {
      st.calls.forEach(function (c) {
        if (have[keyOf(c)]) return;
        have[keyOf(c)] = true;
        if (!f.lanes.some(function (l) { return l.id === c.system; })) {
          var sys = (m.systems || []).filter(function (s) { return s.id === c.system; })[0] || { id: c.system, name: c.systemName, kind: c.kind, kindLabel: '' };
          f.lanes.push({ id: sys.id, name: sys.name, kind: sys.kind, kindLabel: sys.kindLabel, host: sys.host || '' });
        }
        var a = f.actions.filter(function (x) { return x.trigger === st.trigger; })[0];
        if (!a) { a = { id: nextId('a', f.actions.map(function (x) { return x.id; })), trigger: st.trigger, title: '', note: '', chain: st.chain || '', chains: st.chains || [], steps: [] }; f.actions.push(a); }
        a.steps.push({ id: nextId('s', allSteps(f).map(function (s) { return s.id; })), system: c.system, method: c.method, path: c.path, endpoint: c.endpoint, object: c.object, action: c.action || '', direction: c.direction,
          summary: c.summary || '', via: c.via || '', row: c.id || '', text: '', note: 'Added from the app', manual: false });
      });
    });
    return f;
  }

  /** Its steps as rows: [{ action, step, when, says, system, technical, note, manual }]. */
  function rows(flow, plain) {
    var md = toModel(flow);
    var out = [];
    md.actions.forEach(function (a, ai) {
      a.calls.forEach(function (c, si) {
        var ps = D.plainStep(c);
        out.push({ action: ai + 1, step: si + 1, when: a.title || D.plainTrigger(a.trigger), trigger: a.trigger, says: c.text || ps.sentence, system: c.systemName,
          technical: c.manual ? '(added by hand)' : c.method + ' ' + (c.path || c.endpoint), note: c.note || '', manual: !!c.manual, direction: c.direction });
      });
    });
    return out;
  }

  var esc = D.esc;
  /** A printable document: its details, the diagram (plain or technical), its steps, its comments. */
  function html(flow, o) {
    var opt = o || {};
    var f = flow || {};
    var d = D.flowSwim(toModel(f), { plain: !!opt.plain });
    var rs = rows(f);
    var det = [['Flow', (f.id ? f.id + ' · ' : '') + (f.name || '')], ['Status', statusText(f.status) + (f.version ? ' · version ' + f.version : '')], ['Purpose', f.purpose], ['Business area', f.area], ['Owner', f.owner],
      ['Jira story', f.story], ['Tags', (f.tags || []).join(', ')], ['From', f.source && f.source.pageLabel ? f.source.pageLabel + ' (' + f.source.page + ')' : 'Drawn by hand'],
      ['Updated', (f.updated || '').slice(0, 16).replace('T', ' ') + (f.updatedBy ? ' by ' + f.updatedBy : '')]].filter(function (x) { return x[1]; });
    var comments = (f.comments || []).filter(function (c) { return !c.resolved; });
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(f.name || 'Flow') + '</title><style>'
      + '@page{size:A4 landscape;margin:12mm 10mm}body{margin:0;font:11px/1.45 Inter,"Segoe UI",Roboto,Arial,sans-serif;color:#16212c}h1{font-size:24px;margin:0 0 6px}h2{font-size:15px;color:#00506c;margin:16px 0 6px}'
      + 'table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:5px 6px;border-bottom:1px solid #e4e9ef;vertical-align:top}th{background:#eef3f7;font-size:10px;text-transform:uppercase;color:#3b4a58}'
      + '.det th{width:140px;background:none;text-transform:none;font-size:11px;color:#5b6876}.dia svg{width:100%;height:auto;border:1px solid #e4e9ef;border-radius:8px}.brk{page-break-before:always}.note{color:#8a5a00}.muted{color:#6b7889}'
      + '</style></head><body><div class="muted">Integration flow' + (opt.plain ? ' · in plain English' : '') + '</div><h1>' + esc(f.name || 'Flow') + '</h1>'
      + '<table class="det">' + det.map(function (x) { return '<tr><th>' + esc(x[0]) + '</th><td>' + esc(x[1]) + '</td></tr>'; }).join('') + '</table>'
      + '<h2>The flow</h2><div class="dia">' + d.svg + '</div>'
      + '<h2 class="brk">Its steps</h2><table><thead><tr><th>#</th><th>When</th><th>What happens</th><th>System</th>' + (opt.plain ? '' : '<th>Technical</th>') + '<th>Note</th></tr></thead><tbody>'
      + rs.map(function (r) { return '<tr><td>' + r.action + '.' + r.step + '</td><td>' + (r.step === 1 ? esc(r.when) : '') + '</td><td>' + esc(r.says) + '</td><td>' + esc(r.system) + '</td>' + (opt.plain ? '' : '<td>' + esc(r.technical) + '</td>') + '<td class="note">' + esc(r.note) + '</td></tr>'; }).join('')
      + '</tbody></table>'
      + ((f.stickies || []).length ? '<h2>Sticky notes</h2><table><tbody>' + f.stickies.map(function (n) {
        var a = (f.actions || []).map(function (y) { return y.id; }).indexOf(n.action), l = (f.lanes || []).filter(function (y) { return y.id === n.lane; })[0];
        return '<tr><td style="width:220px" class="muted">' + esc(placed(n) ? 'Placed on the diagram' : a === -1 ? 'On the whole flow' : 'Action ' + (a + 1) + (l ? ' · ' + l.name : ' · the page')) + '</td><td style="white-space:pre-wrap">' + esc(n.text) + '</td></tr>';
      }).join('') + '</tbody></table>' : '')
      + (comments.length ? '<h2>Comments</h2><table><tbody>' + comments.map(function (c) { return '<tr><td style="width:180px" class="muted">' + esc((c.by || '') + ' · ' + str(c.at).slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(c.text) + '</td></tr>'; }).join('') + '</tbody></table>' : '')
      + '</body></html>';
  }

  return { STICKY_COLORS: STICKY_COLORS, placed: placed, autoText: autoText, autoTitle: autoTitle, STATUSES: STATUSES, statusText: statusText, KIND_OPTIONS: KIND_OPTIONS, kindLabelOf: kindLabelOf, details: details, fromPage: fromPage, blank: blank, fromRecording: fromRecording, toModel: toModel, edit: edit, laneUsed: laneUsed,
    check: check, addFromApp: addFromApp, rows: rows, html: html, keyOf: keyOf };
});
