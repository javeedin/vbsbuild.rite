define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
  'resources/js/minutesClient',
  'resources/js/featuresClient',
  'resources/js/jiraFeatures',
], (ActionChain, Actions, J, M, FE, JFEAT) => {
  'use strict';

  // Reading Jira for Features: the stories of the chosen search (the connection's project, or every project), whether an
  // AI is set up, and the project's saved feature list (the grouping). The model is then rebuilt live from that grouping
  // and the stories on screen, so a story added since the draft shows up as "not grouped yet". A 401/403 means Jira is not
  // connected (Jira stories is where to connect). The tab keeps its work: a plain re-entry does not re-read (Refresh does).
  const clock = () => { const d = new Date(); const p2 = (n) => (n < 10 ? '0' : '') + n; return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  const toDraft = (model) => ((model && model.features) || []).map((f) => ({ name: f.name, description: f.description, storyKeys: (f.stories || []).map((s) => s.key) }));

  class loadChain extends ActionChain {
    async run(context, params) {
      const v = context.$page.variables;
      const force = !!(params && params.force);
      if (!force && (v.stories || []).length) return; // the tab kept its stories and its draft
      v.isLoading = true; v.error = ''; v.notConnected = false; v.note = '';
      try {
        try { await J.desktopSettings(); } catch (e) { /* outside the desktop app: the search spans every project */ }
        try { const a = await M.aiSettings(); v.aiReady = !!(a.ok && a.body && a.body.active); } catch (e) { v.aiReady = false; }
        const project = J.PROJECT || '';
        v.project = project;
        const presets = J.presets(project);
        const sel = presets.filter((p) => p.key === v.search)[0] || presets[0];
        v.search = sel.key;
        const today = new Date().toISOString().slice(0, 10);
        const res = await J.load(context, Actions, sel.jql);
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) v.notConnected = true;
          else v.error = res.message || 'Could not read the stories from Jira.';
          v.stories = []; v.model = null; v.draft = null;
          return;
        }
        J.peopleOf(res.issues || []);
        v.stories = (res.issues || []).map((i) => J.fromIssue(i, { today: today, site: J.SITE }));
        v.readAt = clock();
        // The project's saved grouping, rebuilt against the stories on screen. No saved list → the Start card (draft it).
        let saved = null;
        try { saved = await FE.get(project); } catch (e) { /* no store (browser) or none saved */ }
        if (saved && Array.isArray(saved.features) && saved.features.length) {
          v.model = JFEAT.build(v.stories, saved.features);
          v.draft = toDraft(v.model);
          v.savedAt = saved.at || ''; v.savedBy = saved.by || ''; v.dirty = false;
        } else {
          v.model = null; v.draft = null; v.savedAt = ''; v.savedBy = ''; v.dirty = false;
        }
      } catch (e) {
        v.error = String((e && e.message) || e);
      } finally {
        v.isLoading = false;
      }
    }
  }
  return loadChain;
});
