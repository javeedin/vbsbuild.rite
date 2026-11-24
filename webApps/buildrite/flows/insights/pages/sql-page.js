define(['resources/js/exportKit', 'resources/js/sqlWorksheet', 'resources/js/infolets'], (exportKit, W, I) => {
  'use strict';

  // The SQL worksheet's binding helpers, and its keys as in SQL Developer: Ctrl+Enter runs the statement under the
  // cursor, F5 the script. A key in the editor presses the matching button, so a key does exactly what the button does
  // (and nothing while the button is disabled). Listened for once, whatever number of times the page opens.
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__eqrSqlKeys) {
    window.__eqrSqlKeys = true;
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      // Enter in the Ask AI box asks.
      if (t && t.id === 'sqlAiAsk' && e.key === 'Enter') { e.preventDefault(); var go = document.getElementById('sqlAiGo'); if (go && !go.disabled) go.click(); return; }
      if (!t || t.id !== 'sqlEditor') return;
      var id = (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ? 'sqlRun' : (e.key === 'F5' ? 'sqlRunScript' : '');
      if (!id) return;
      e.preventDefault();
      var b = document.getElementById(id);
      if (b && !b.disabled) b.click();
    }, true);
  }

  class PageModule {
    formats() { return exportKit.FORMATS; }

    colors() { return W.COLORS; }

    /** A connection's colour dot (none: an outline). */
    dot(color) { return color ? { background: color, borderColor: color } : { background: 'transparent' }; }

    text(v) { return v == null ? '' : '' + v; }

    /** The result grid's column template (sqlWorksheet.grid). */
    gridStyle(style) { return style || {}; }

    took(ms) { return W.took(ms); }

    lines(list) { return (list || []).join('\n'); }

    historyRows(list) { return W.historyRows(list); }

    /** What the chosen LLM needs, in a line. */
    provNote(catalog, id) { var c = (catalog || []).filter(function (p) { return p.id === id; })[0]; return c ? c.note : ''; }

    /** A field's value in the Ask AI settings form. */
    fieldVal(form, key) { return form && form[key] != null ? form[key] : ''; }

    /** Redwood view (your menu, Look): the general overview page's primary action, the current look's New connection. */
    rwPrimary(available) { return { label: 'New connection', icon: 'oj-ux-ico-plus', display: available ? 'on' : 'off' }; }

    // ── infolets / dashboards ──
    /** The chart kinds a person can pick for an infolet, as segmented-button options. */
    infoletKinds(chosen) {
      const names = { kpi: 'Number', bar: 'Bar', column: 'Column', line: 'Line', pie: 'Pie', table: 'Table' };
      return I.KINDS.map((k) => ({ value: k, label: names[k] || k, cls: 'nx-seg-btn' + (k === chosen ? ' nx-seg-btn--on' : '') }));
    }
    kindLabel(k) { return ({ kpi: 'Number', bar: 'Bar', column: 'Column', line: 'Line', pie: 'Pie', table: 'Table' })[k] || (k || 'Table'); }
    /** Column names of the current result (for the label / value selects in the Save-as-infolet dialog). */
    columnNames(raw) { return ((raw && raw.columns) || []).map((c) => (c && typeof c === 'object' ? c.name : c)); }
    aggOptions(chosen) {
      return [{ value: 'sum', label: 'Sum' }, { value: 'avg', label: 'Average' }, { value: 'count', label: 'Count' }, { value: 'none', label: 'First value' }]
        .map((o) => Object.assign({ sel: o.value === chosen }, o));
    }
    /** Saved-dashboard rows for the list. */
    dashRows(list) { return (list || []).map((d) => ({ id: d.id, name: d.name, description: d.description || '', count: String(d.count || 0) + (d.count === 1 ? ' infolet' : ' infolets'), by: d.by || '' })); }
    /** The open board's slots as cards (the body is filled by the chain). */
    boardSlots(board) {
      return ((board && board.slots) || []).map((s) => ({ id: s.infoletId, slot: 'sqlSlot-' + s.infoletId, name: s.name || '', kind: this.kindLabel(s.kind),
        w: s.w, style: { gridColumn: 'span ' + Math.max(1, Math.min(12, s.w || 6)) } }));
    }
    infoletRows(list) { return (list || []).map((x) => ({ id: x.id, name: x.name, kind: this.kindLabel(x.kind), conn: x.conn || '', description: x.description || '' })); }

    // ── Saved reports ──
    /** The left list of reports (saved queries + infolets), filtered by the search box; the one being viewed is marked. */
    reportList(list, q, active) {
      const needle = String(q || '').trim().toLowerCase();
      return (list || [])
        .filter((r) => !needle || (r.name + ' ' + (r.conn || '') + ' ' + (r.description || '')).toLowerCase().indexOf(needle) !== -1)
        .map((r) => ({ id: r.rid, name: r.name, conn: r.conn || '', description: r.description || '',
          kind: r.kind, isInfolet: r.kind === 'infolet', icon: r.kind === 'infolet' ? 'oj-ux-ico-bar-charts' : 'oj-ux-ico-table',
          cls: 'nx-sql-reprow' + (r.rid === active ? ' nx-sql-reprow--on' : '') }));
    }
    /** The open report tabs in the central panel. */
    reportTabs(tabs, active) {
      return (tabs || []).map((t) => ({ id: t.id, name: t.name, cls: 'nx-sql-reptab' + (t.id === active ? ' nx-sql-reptab--on' : ''), active: t.id === active }));
    }
    reportActiveName(tabs, active) { const t = (tabs || []).filter((x) => x.id === active)[0]; return t ? t.name : ''; }
  }

  return PageModule;
});
