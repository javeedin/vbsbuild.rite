define(['resources/js/integrationDiagram', 'resources/js/flowModel', 'resources/js/integrationReport', 'resources/js/flowRun'], (D, FM, R, FR) => {
  'use strict';

  // One saved flow: binding helpers (sfChain does the work). No function uses `this`.
  const n = (x, one, many) => x + ' ' + (x === 1 ? one : (many || one + 's'));
  const kindColor = (k) => (D.KINDS[k] || D.KINDS.rest).color;
  // what is compared to tell unsaved changes: its details and its steps (not comments, history, versions)
  const body = (f) => (f ? JSON.stringify([f.name, f.purpose, f.area, f.owner, f.status, f.story, f.tags, f.lanes, f.actions, f.stickies || []]) : '');
  const stepLabel = (flow) => {
    const out = {};
    (flow && flow.actions || []).forEach((a, ai) => (a.steps || []).forEach((s, si) => { out[s.id] = (ai + 1) + '.' + (si + 1); }));
    return out;
  };

  class PageModule {
    // ── the header ──
    title(f) { return f ? f.name : 'Saved flow'; }
    sub(f) {
      if (!f) return '';
      const steps = (f.actions || []).reduce((a, x) => a + (x.steps || []).length, 0);
      return f.id + ' · ' + FM.statusText(f.status) + ' · version ' + (f.version || 1) + ' · ' + n(steps, 'step') + ', ' + n((f.actions || []).length, 'action') + ', ' + n((f.lanes || []).length, 'system')
        + (f.source && f.source.pageLabel ? ' · from the page ' + f.source.pageLabel : ' · drawn by hand') + (f.updated ? ' · saved ' + R.when(f.updated) + (f.updatedBy ? ' by ' + f.updatedBy : '') : '');
    }
    isDirty(f, saved) { return !!f && !!saved && body(f) !== body(saved); }
    saveText(f, saved, busy) { return busy ? 'Saving…' : PageModule.prototype.isDirty(f, saved) ? 'Save as version ' + (((saved && saved.version) || 1) + 1) : 'Saved'; }
    statusOptions(cur) { return FM.STATUSES.map((s) => ({ id: s[0], text: s[1], on: (cur || 'draft') === s[0] })); }
    statusCls(f) { return 'nx-int-fst nx-int-fst--' + ((f && f.status) || 'draft'); }
    tabCls(cur, k) { return 'nx-sc-tab' + (cur === k ? ' nx-sc-tab--on' : ''); }
    tabSel(cur, k) { return cur === k ? 'true' : 'false'; }
    openComments(f) { return ((f && f.comments) || []).filter((c) => !c.resolved).length; }
    tags(f) { return ((f && f.tags) || []).join(', '); }

    // ── the flow ──
    diaDoc(f, plain) { return f ? D.doc(D.flowSwim(FM.toModel(f), { plain: plain })) : ''; }
    diaStyle(f, plain) { if (!f) return {}; const d = D.flowSwim(FM.toModel(f), { plain: plain }); return { aspectRatio: d.w + ' / ' + d.h }; }
    /** Its steps as rows, with the comments on each. */
    stepRows(f, plain) {
      if (!f) return [];
      const cm = {};
      (f.comments || []).filter((c) => !c.resolved && c.step).forEach((c) => { cm[c.step] = (cm[c.step] || 0) + 1; });
      const ids = [];
      (f.actions || []).forEach((a) => (a.steps || []).forEach((s) => ids.push(s.id)));
      return FM.rows(f, plain).map((r, i) => Object.assign({}, r, { key: ids[i], num: r.action + '.' + r.step, first: r.step === 1, comments: cm[ids[i]] ? n(cm[ids[i]], 'comment') : '',
        cls: 'nx-int-dir nx-int-dir--' + String(r.direction || 'read').toLowerCase(), tech: plain ? '' : r.technical }));
    }

    // ── the editor ──
    kindOptions(cur) { return FM.KIND_OPTIONS.map((k) => ({ id: k[0], text: k[1], on: (cur || 'other') === k[0] })); }
    laneRows(f) { return ((f && f.lanes) || []).map((l) => ({ id: l.id, name: l.name, kind: l.kind, color: kindColor(D.KINDS[l.kind] ? l.kind : 'rest'), used: FM.laneUsed(f, l.id), host: l.host || '' })); }
    actionRows(f) {
      if (!f) return [];
      const lanes = (f.lanes || []);
      const md = FM.toModel(f);
      return (f.actions || []).map((a, ai) => ({
        id: a.id, n: ai + 1, title: a.title || '', ph: D.plainTrigger(a.trigger || '') || 'When …', val: a.title || (a.trigger ? D.plainTrigger(a.trigger) : ''),
        auto: !a.title && !!a.trigger, stickies: PageModule.prototype.stickyRows(f, a.id), trigger: a.trigger ? 'From the app: ' + a.trigger + (a.chain ? ' (' + a.chain + ')' : '') : 'Added by hand', note: a.note || '',
        first: ai === 0, last: ai === f.actions.length - 1,
        steps: (a.steps || []).map((s, si) => {
          const c = md.actions[ai].calls[si];
          const w = FR.what(s);
          return { id: s.id, n: (ai + 1) + '.' + (si + 1), text: s.text || '', ph: D.plainStep(c).sentence, runnable: w.ok,
            runWhy: w.ok ? (s.direction === 'Write' ? 'Run this call — it changes data, so it is sent only once you confirm' : 'Run this call now, against the app\'s backend') : w.why, val: s.text || (s.manual ? '' : D.plainStep(c).sentence), auto: !s.text && !s.manual,
            note: s.note || '', manual: !!s.manual, method: s.method || '',
            tech: s.manual ? 'Added by hand' : (s.method + ' ' + (s.path || s.endpoint)) + (s.object ? ' · ' + s.object : ''), color: kindColor(c.kind),
            lanes: lanes.map((l) => ({ id: l.id, text: l.name, on: l.id === s.system })), dirs: [['Read', 'Reads'], ['Write', 'Writes'], ['Report', 'Report']].map((d) => ({ id: d[0], text: d[1], on: (s.direction || 'Read') === d[0] })),
            first: si === 0 && ai === 0, last: si === a.steps.length - 1 && ai === f.actions.length - 1 };
        })
      }));
    }

    // ── steps run for real (▶ Run) ──
    /** A step's last run as a chip (status, rows, time; held, needs a value, not run). */
    runChip(runs, sid) { const c = FR.chip((runs || {})[sid]); return c ? { text: c.text, title: c.title || 'Show its answer', cls: 'nx-sfp-rchip nx-sfp-rchip--' + c.cls } : { text: '', title: '', cls: '' }; }
    hasRunChip(runs, sid) { return !!FR.chip((runs || {})[sid]); }
    runBtnText(runs, sid) { const r = (runs || {})[sid]; return r && r.busy ? 'Running…' : 'Run'; }
    runAllText(busy, id) { return busy && busy === id ? 'Running…' : (id === 'flow' ? 'Run the flow' : 'Run'); }
    /** A step's run panel (0 or 1 of them, to bind as a list): where its call goes, its values, its answer. */
    runPanels(runs, sid) {
      const r = (runs || {})[sid];
      if (!r || !r.open) return [];
      const str = (x) => (x == null ? '' : String(x));
      const d = r.desc || null;
      const op = d && d.op;
      const vals = r.vals || { params: {}, from: {} };
      const from = vals.from || {};
      const sug = (d && d.suggest) || {};
      const k = r.res || null;
      const t = k && k.table;
      const b = (d && d.backend) || {};
      return [{
        id: sid, domId: 'sfpRun-' + sid, ready: !!op, loading: !op && !!r.busy,
        head: op ? (op.report ? 'BI Publisher report ' + op.reportName : op.method + ' ' + op.path) : (r.msg ? 'It cannot be run' : 'Reading its call…'),
        target: op ? (op.report ? str(b.url) + ' · ' + str(op.reportPath) : str(b.url) + str(op.path)) : '',
        login: op ? str(b.login) : '',
        kind: op ? (op.report ? 'Runs a report' : op.reads ? 'Only reads' : 'Changes data') : '',
        kindCls: 'nx-sfp-rkind' + (op && !op.reads ? ' nx-sfp-rkind--write' : ''),
        writes: !!op && !op.reads,
        params: op ? (op.params || []).map((p) => ({ name: p.name, label: p.name + (p.required ? ' *' : ''), where: p.in === 'report' ? 'report parameter' : p.in,
          value: str(vals.params && vals.params[p.name]), field: 'r.' + sid + '.p.' + p.name, from: from[p.name] && from[p.name] !== 'yours' ? from[p.name] : '',
          hint: str(p.description) || (p.enum && p.enum.length ? 'One of ' + p.enum.join(', ') : ''),
          choices: (sug[p.name] || []).slice(0, 5).map((x) => ({ text: str(x.value), title: 'Seen in ' + str(x.from), key: p.name + '=' + str(x.value) })) })) : [],
        noParams: !!op && !(op.params || []).length && !op.body,
        hasBody: !!(op && op.body), body: str(vals.body), bodyField: 'r.' + sid + '.body', extra: str(vals.extra), extraField: 'r.' + sid + '.extra',
        busy: !!r.busy, sendText: r.busy ? 'Sending…' : (k ? 'Send again' : 'Send'),
        msg: r.msg ? str(r.msg.text) : '', msgCls: 'nx-sfp-rmsg' + (r.msg && r.msg.ok ? '' : ' nx-sfp-rmsg--bad'),
        res: !!k,
        status: k ? (k.status + (k.statusText ? ' ' + k.statusText : '')) : '', statusCls: 'nx-sfp-rstatus nx-sfp-rstatus--' + (!k ? 'none' : !k.ok ? 'fail' : k.shape === 'differs' ? 'warn' : 'ok'),
        facts: FR.facts(k), url: k ? k.method + ' ' + k.url : '', at: k && k.at ? 'sent ' + R.when(k.at) : '',
        problem: k ? (k.fault || k.error) : '', shape: k && k.shape === 'differs' ? 'Its answer differs from the example the page was built with: ' + k.shapeText + '.' : '',
        hasTable: !!(t && t.columns.length), cols: t ? t.columns.map((c, i) => ({ k: String(i), t: c })) : [],
        rows: t ? t.rows.map((row, i) => ({ k: String(i), cells: row.map((c, j) => ({ k: String(j), t: c })) })) : [],
        more: t ? t.more : '', from: k && k.from ? 'Rows from ' + k.from + (k.meta ? ' · ' + k.meta : '') : '',
        pretty: k ? k.pretty : '', cut: !!(k && k.cut)
      }];
    }

    // ── sticky notes ──
    /** The sticky notes of an action ('' = the whole flow): their text, colour, where they sit. */
    stickyRows(f, actionId) {
      if (!f) return [];
      const lanes = f.lanes || [];
      return (f.stickies || []).filter((x) => (x.action || '') === (actionId || '') || (!actionId && !(f.actions || []).some((a) => a.id === x.action))).map((x) => ({
        id: x.id, text: x.text || '', cls: 'nx-sfp-sticky nx-sfp-sticky--' + (x.color || 'yellow'),
        laneOpts: [{ id: '', text: 'The page\'s lane', on: !x.lane }].concat(lanes.map((l) => ({ id: l.id, text: l.name, on: l.id === x.lane }))),
        actionOpts: [{ id: '', text: 'The whole flow (at the top)', on: !x.action }].concat((f.actions || []).map((a, i) => ({ id: a.id, text: 'Action ' + (i + 1) + ' — ' + (a.title || D.plainTrigger(a.trigger || '') || 'When …').slice(0, 50), on: a.id === x.action }))),
        colors: FM.STICKY_COLORS.map((c) => ({ id: c[0], text: c[1], cls: 'nx-sfp-swatch nx-sfp-swatch--' + c[0] + ((x.color || 'yellow') === c[0] ? ' nx-sfp-swatch--on' : '') }))
      }));
    }
    stickyCount(f) { return ((f && f.stickies) || []).length; }
    historyLabel(f) { const k = ((f && f.versions) || []).length + 1; return 'History (' + k + (k === 1 ? ' version' : ' versions') + ')'; }

    // ── comments ──
    commentRows(f, showResolved) {
      const lab = stepLabel(f);
      const md = f ? FM.rows(f, true) : [];
      const says = {};
      let i = 0;
      ((f && f.actions) || []).forEach((a) => (a.steps || []).forEach((s) => { says[s.id] = (md[i++] || {}).says || ''; }));
      return ((f && f.comments) || []).filter((c) => showResolved || !c.resolved).slice().reverse().map((c) => ({ id: c.id, by: c.by || 'someone', at: R.when(c.at), text: c.text,
        on: c.step ? 'On step ' + (lab[c.step] || '?') + (says[c.step] ? ' — ' + says[c.step] : '') : 'On the whole flow', resolved: !!c.resolved,
        resolvedText: c.resolved ? 'Resolved' + (c.resolvedBy ? ' by ' + c.resolvedBy : '') : '', cls: 'nx-sfp-cm' + (c.resolved ? ' nx-sfp-cm--done' : '') }));
    }
    commentCount(f) { const all = ((f && f.comments) || []).length, open = PageModule.prototype.openComments(f); return open + ' open' + (all > open ? ' · ' + (all - open) + ' resolved' : ''); }
    stepOptions(f, cur) {
      const md = f ? FM.rows(f, true) : [];
      const ids = [];
      ((f && f.actions) || []).forEach((a) => (a.steps || []).forEach((s) => ids.push(s.id)));
      return [{ id: '', text: 'The whole flow', on: !cur }].concat(md.map((r, i) => ({ id: ids[i], text: r.action + '.' + r.step + ' — ' + r.says.slice(0, 70), on: cur === ids[i] })));
    }

    // ── history ──
    versionRows(f, viewV) {
      if (!f) return [];
      const steps = (x) => (x.actions || []).reduce((a, y) => a + (y.steps || []).length, 0);
      const cur = { v: f.version || 1, at: R.when(f.updated), by: f.updatedBy || '', note: f.lastNote || '', steps: n(steps(f), 'step'), current: true, on: false };
      return [cur].concat((f.versions || []).slice().reverse().map((x) => ({ v: x.v, at: R.when(x.at), by: x.by || '', note: x.note || '', steps: n(steps(x), 'step'), current: false, on: x.v === viewV })));
    }
    versionDoc(f, v, plain) {
      const x = ((f && f.versions) || []).filter((y) => y.v === v)[0];
      return x ? D.doc(D.flowSwim(FM.toModel(Object.assign({}, f, { name: x.name || f.name, status: x.status || f.status, version: x.v, lanes: x.lanes, actions: x.actions, stickies: x.stickies || [] })), { plain: plain })) : '';
    }
    historyRows(f) { return ((f && f.history) || []).slice().reverse().map((h, i) => ({ key: String(i), at: R.when(h.at), by: h.by || '', what: h.what, note: h.note || '' })); }

    // ── check ──
    checkCls(c) { return 'nx-sfp-check ' + (!c ? '' : c.ok ? 'nx-sfp-check--ok' : 'nx-sfp-check--bad'); }
    checkText(c) { return c ? c.text : 'Compare this flow with the app\'s code now.'; }
    sourceText(f) {
      if (!f || !f.source || f.source.kind !== 'page') return 'Drawn by hand.';
      return 'Made from the page ' + (f.source.pageLabel || '') + ' (' + f.source.page + ')' + (f.source.flow ? ', flow ' + f.source.flow : '') + (f.source.scannedAt ? ', scanned ' + R.when(f.source.scannedAt) : '') + '.';
    }
  }
  return PageModule;
});
