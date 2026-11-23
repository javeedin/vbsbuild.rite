define([], () => {
  'use strict';

  // Jira · Features: binding helpers (none uses `this`). The work is in the chains; the engine is resources/js/jiraFeatures.js.
  const SEARCHES = [
    { key: 'stories', label: 'All stories' },
    { key: 'open', label: 'Stories not done' },
    { key: 'sprint', label: 'In open sprints' },
    { key: 'epics', label: 'Epics' }
  ];
  class PageModule {
    searches() { return SEARCHES; }
    /** The feature cards for the editor: index, name, description, roll-up chips and the stories. */
    featureRows(model) {
      const feats = (model && model.features) || [];
      return feats.map((f, i) => ({
        idx: i, name: f.name || '', description: f.description || '',
        n: (f.stories || []).length, chips: this.chips(f.rollup),
        stories: (f.stories || []).map((s) => ({ key: s.key, summary: s.summary, status: s.status, url: s.url, cls: this.stClass(s.cat) }))
      }));
    }
    ungrouped(model) {
      const u = (model && model.ungrouped) || [];
      return u.map((s) => ({ key: s.key, summary: s.summary, status: s.status, url: s.url, cls: this.stClass(s.cat) }));
    }
    ungroupedCount(model) { return ((model && model.ungrouped) || []).length; }
    featureCount(model) { return ((model && model.features) || []).length; }
    /** The overall roll-up chips for the header. */
    chips(rollup) {
      const r = rollup || { done: 0, prog: 0, todo: 0 };
      const out = [];
      if (r.done) out.push({ label: r.done + ' done', cls: 'done' });
      if (r.prog) out.push({ label: r.prog + ' in progress', cls: 'prog' });
      if (r.todo) out.push({ label: r.todo + ' to do', cls: 'todo' });
      return out;
    }
    headChips(model) { return this.chips(model && model.rollup); }
    stClass(cat) { return cat === 'done' ? 'done' : cat === 'indeterminate' ? 'prog' : 'todo'; }
    /** The edit key for a feature's name / description box (read back in the chain). */
    editKey(field, idx) { return field + ':' + idx; }
    /** "EQR · 204 stories · 12 features · read 10:42", or what is happening. */
    status(project, stories, model, readAt, isLoading, notConnected, error) {
      if (isLoading) return 'Reading Jira…';
      if (notConnected) return 'Not connected to Jira — connect on the Jira stories screen first.';
      if (error) return error;
      const n = (stories || []).length;
      const bits = [];
      if (project) bits.push(project);
      bits.push(n + ' stor' + (n === 1 ? 'y' : 'ies'));
      if (model) bits.push(this.featureCount(model) + ' feature' + (this.featureCount(model) === 1 ? '' : 's'));
      if (readAt) bits.push('read ' + readAt);
      return bits.join(' · ');
    }
    savedLine(savedAt, savedBy, dirty) {
      if (!savedAt) return dirty ? 'Not saved yet — unsaved changes.' : 'Not saved yet.';
      return 'Saved ' + this.ago(savedAt) + (savedBy ? ' by ' + savedBy : '') + (dirty ? ' · unsaved changes' : '');
    }
    ago(iso) {
      const d = new Date(iso);
      if (!iso || isNaN(d.getTime())) return '';
      const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
      const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
    }
    hasModel(model) { return !!(model && (this.featureCount(model) || this.ungroupedCount(model))); }
    /** The export menu's items. */
    exports() {
      return [
        { act: 'pdf', label: 'PDF (print)', icon: 'oj-ux-ico-file-pdf' },
        { act: 'excel', label: 'Excel (.xlsx)', icon: 'oj-ux-ico-file-excel' },
        { act: 'html', label: 'Web page (.html)', icon: 'oj-ux-ico-file-html' },
        { act: 'csv', label: 'CSV', icon: 'oj-ux-ico-file-csv' }
      ];
    }
    busyLabel(busy, act, idle) { return busy === act ? (act === 'ai' ? 'Drafting…' : act === 'auto' ? 'Grouping…' : act === 'save' ? 'Saving…' : 'Working…') : idle; }
  }
  return PageModule;
});
