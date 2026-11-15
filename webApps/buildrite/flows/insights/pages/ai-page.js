define([], () => {
  'use strict';

  // AI settings: binding helpers (the chains do the work through resources/js/aiClient.js). None uses `this`.
  const labelOf = (st, id) => ((st && st.catalog) || []).filter((c) => c.id === id).map((c) => c.label)[0] || id;
  const ready = (st) => Object.keys((st && st.providers) || {}).filter((k) => st.providers[k].ready);
  const named = (st, id) => labelOf(st, id) + (st.providers[id] && st.providers[id].model ? ' · ' + st.providers[id].model : '');

  class PageModule {
    /** Each AI: set up or not, how it is paid. */
    cards(st, edit) {
      return ((st && st.catalog) || []).map((c) => {
        const p = (st.providers || {})[c.id] || {};
        const sub = c.id === 'claudecode';
        return { id: c.id, label: c.label, note: c.note, ready: !!p.ready,
          pay: sub ? 'sub' : (c.id === 'custom' ? 'other' : 'tokens'), payText: sub ? 'Your subscription' : (c.id === 'custom' ? 'Its own terms' : 'API key · paid per use'),
          state: p.ready ? 'Set up' + (p.model ? ' · ' + p.model : '') + (st.active === c.id ? ' · the default' : '') : 'Not set up',
          cls: 'nx-ai-card' + (p.ready ? ' nx-ai-card--ready' : '') + (edit && edit.provider === c.id ? ' nx-ai-card--on' : '') };
      });
    }
    formTitle(st, edit) { return edit ? (((st.providers || {})[edit.provider] || {}).ready ? 'Change ' : 'Set up ') + labelOf(st, edit.provider) : ''; }
    /** The fields of the AI being set up (a key's box empty: the saved one is kept). */
    fields(st, edit) {
      const c = ((st && st.catalog) || []).filter((x) => x.id === (edit && edit.provider))[0];
      if (!c) return [];
      const p = (st.providers || {})[c.id] || {};
      return c.fields.map((f) => ({ key: f.key, label: f.label, secret: !!f.secret, area: !!f.area, value: f.secret ? '' : (edit[f.key] != null ? edit[f.key] : (p[f.key] || '')),
        placeholder: f.secret ? (p['has_' + f.key] ? 'saved — leave empty to keep it' : 'pasted here, kept encrypted on this PC') : (f.hint || '') }));
    }
    modelOptions(models, edit) {
      const cur = (edit && edit.model) || '';
      const list = (models || []).slice();
      if (cur && !list.some((m) => m.id === cur)) list.unshift({ id: cur, label: cur });
      if (!list.length) list.push({ id: '', label: edit && edit.provider === 'claudecode' ? 'Default (your Claude Code setting)' : 'Load models first' });
      return list.map((m) => ({ id: m.id, label: m.label || m.id, on: m.id === cur }));
    }
    defaultOptions(st) {
      const ids = ready(st);
      const out = ids.map((id) => ({ id, label: named(st, id), on: st.active === id }));
      out.unshift({ id: '', label: ids.length ? 'None' : 'Set up an AI first (above)', on: !st.active });
      return out;
    }
    featureRows(st, tests) {
      const ids = ready(st);
      return ((st && st.features) || []).map((f) => {
        const own = (st.uses || {})[f.id] || '';
        const t = (tests || {})[f.id];
        return { id: f.id, label: f.label, note: f.note,
          options: [{ id: '', label: 'The default' + (st.active ? ' (' + labelOf(st, st.active) + ')' : ''), on: !own }].concat(ids.map((id) => ({ id, label: named(st, id), on: own === id }))),
          test: !t ? '' : t.busy ? 'Asking…' : (t.ok ? '✓ ' + t.text : '✗ ' + t.text) };
      });
    }
  }
  return PageModule;
});
