define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
  'resources/js/minutesClient',
  'resources/js/featuresClient',
  'resources/js/jiraFeatures',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, Actions, J, M, FE, JFEAT, exportKit, bus) => {
  'use strict';

  // Features: the search (read again), Draft with AI / Auto-group (group every story into features), editing a feature's
  // name or one-line description, Save (keep the grouping for the project), Export (PDF / Excel / web page / CSV), open a
  // story in Jira stories, Refresh. The working draft mirrors the model's features (so an edit's index is stable); the
  // model is rebuilt from it and the stories after every change.
  const SEARCHES = { stories: 'All stories', open: 'Stories not done', sprint: 'In open sprints', epics: 'Epics' };
  const toDraft = (model) => ((model && model.features) || []).map((f) => ({ name: f.name, description: f.description, storyKeys: (f.stories || []).map((s) => s.key) }));
  const rebuild = (v) => { v.model = JFEAT.build(v.stories || [], v.draft || []); v.draft = toDraft(v.model); };
  const fileBase = (v) => 'features-' + (v.project ? String(v.project).toLowerCase() : 'all');
  const meta = (v) => ({ project: v.project || 'every project', date: new Date().toISOString().slice(0, 10), by: v.savedBy || '', source: SEARCHES[v.search] || 'All stories' });

  let said = null;
  const flash = (v, msg) => { v.note = msg; if (said) clearTimeout(said); said = setTimeout(() => { v.note = ''; }, 6000); };

  class actChain extends ActionChain {
    async run(context, { act, key, value }) {
      const v = context.$page.variables;

      if (act === 'search') {
        const s = String(value || 'stories');
        if (s === v.search && (v.stories || []).length) return;
        v.search = s; v.note = '';
        await Actions.callChain(context, { chain: 'loadChain', params: { force: true } });
        return;
      }
      if (act === 'refresh') {
        v.note = '';
        await Actions.callChain(context, { chain: 'loadChain', params: { force: true } });
        return;
      }
      if (act === 'open' && key) { bus.focus('jira', { key: String(key) }); return; }

      if (act === 'draftAi') {
        if (v.busy || !(v.stories || []).length) return;
        if (!v.aiReady) { v.error = 'Ask AI is not set up. Set it up on the Jira stories screen, or use Auto-group.'; return; }
        v.busy = 'ai'; v.error = '';
        try {
          const p = JFEAT.prompt(v.stories);
          const r = await M.aiChat(p.system, p.user, 'features');
          if (!(r.ok && r.body && r.body.ok && r.body.text)) { v.error = (r.body && r.body.error) || 'The AI did not answer.'; return; }
          const drafted = JFEAT.parse(r.body.text);
          if (!drafted.length) { v.error = 'The AI did not return a feature list. Try again, or use Auto-group.'; return; }
          v.draft = drafted; rebuild(v); v.dirty = true;
          flash(v, 'Drafted ' + JFEAT.build(v.stories, v.draft).counts.features + ' features with AI. Edit the names, then Save.');
        } catch (e) {
          v.error = String((e && e.message) || e);
        } finally {
          v.busy = '';
        }
        return;
      }
      if (act === 'draftAuto') {
        if (v.busy || !(v.stories || []).length) return;
        v.busy = 'auto'; v.error = '';
        try {
          v.draft = JFEAT.autoDraft(v.stories); rebuild(v); v.dirty = true;
          flash(v, 'Grouped into ' + v.model.counts.features + ' features (by epic, label, then type). Edit the names, then Save.');
        } finally {
          v.busy = '';
        }
        return;
      }
      if (act === 'edit') {
        const m = /^(name|desc):(\d+)$/.exec(String(key || ''));
        if (!m || !v.draft) return;
        const i = Number(m[2]);
        if (!v.draft[i]) return;
        if (m[1] === 'name') v.draft[i].name = String(value || '').slice(0, 200);
        else v.draft[i].description = String(value || '').slice(0, 600);
        rebuild(v); v.dirty = true;
        return;
      }

      if (act === 'save') {
        if (v.busy || !v.draft) return;
        v.busy = 'save'; v.error = '';
        try {
          const saved = await FE.save({ project: v.project, features: v.draft, source: SEARCHES[v.search] || '' });
          if (!saved) { v.error = 'Could not save the feature list.'; return; }
          v.savedAt = saved.at || new Date().toISOString(); v.savedBy = saved.by || v.savedBy || ''; v.dirty = false;
          flash(v, 'Saved the feature list for ' + (v.project || 'every project') + '.');
        } catch (e) {
          v.error = String((e && e.message) || e);
        } finally {
          v.busy = '';
        }
        return;
      }

      // export
      if (act === 'pdf' || act === 'html' || act === 'excel' || act === 'csv') {
        if (!v.model) return;
        try {
          if (act === 'pdf') { exportKit.printDocument(JFEAT.documentHtml(v.model, meta(v))); flash(v, 'Choose "Save as PDF" in the print dialog.'); return; }
          if (act === 'html') { exportKit.download(fileBase(v) + '.html', 'text/html;charset=utf-8', JFEAT.documentHtml(v.model, meta(v))); flash(v, 'The feature list was saved as a web page.'); return; }
          const res = await exportKit.run(act === 'excel' ? 'xlsx' : 'csv', { rows: JFEAT.rows(v.model), columns: JFEAT.COLUMNS, name: fileBase(v), title: 'Feature list — ' + (v.project || 'every project') });
          flash(v, (res && res.message) || 'Exported.');
        } catch (e) {
          v.error = 'The export failed: ' + String((e && e.message) || e);
        }
      }
    }
  }
  return actChain;
});
