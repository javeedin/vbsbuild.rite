define([
  'vb/action/actionChain',
  'resources/js/storyAnalysisRun',
  'resources/js/designDocs',
  'resources/js/shellBus',
], (ActionChain, R, DD, bus) => {
  'use strict';

  // Create the functional design (under the AI analysis): the FDD, wireframes, TDD, integration touch points and a
  // developer reference for this story, written by the AI from the story, its analysis, the FDD and the app's code (the
  // working folder), printed to PDF and saved with the FDD library — pushed to git when "Push to git" is ticked.
  //   act: create | list | preview | close | download (kind) | open (kind) | folder | push | library | togglePush
  class designChain extends ActionChain {
    async run(context, { act, id, kind }) {
      const v = context.$page.variables;
      const base = context.$application.path;
      const key = (v.story && v.story.key) || '';
      const list = async () => {
        if (!key) return;
        v.designs = (await DD.list(base, key)).docs;
      };
      if (act === 'list') { await list(); return; }
      if (act === 'togglePush') { v.designPush = !v.designPush; return; }
      if (act === 'library') { bus.open({ navId: 'fdd-library' }); return; }
      if (act === 'close') { v.designView = null; return; }
      if (act === 'create') {
        if (!key || v.design.busy) return;
        if (!v.aiReady) { bus.toast('Set up AI first: Tools → AI settings.', 'error'); return; }
        const t0 = Date.now();
        v.design = { busy: true, secs: 0, doc: null, git: null, error: '', pdfError: '' };
        const tick = setInterval(() => { if (v.design && v.design.busy) v.design = Object.assign({}, v.design, { secs: Math.round((Date.now() - t0) / 1000) }); }, 1000);
        let r;
        try { r = await R.design(v, base, !!v.designPush); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; } finally { clearInterval(tick); }
        v.design = { busy: false, secs: Math.round((Date.now() - t0) / 1000), doc: r.ok ? r.doc : null, git: r.git || null, error: r.ok ? '' : r.error, pdfError: r.pdfError || '', analysisUsed: !!r.analysisUsed };
        if (!r.ok) { bus.toast(r.error, 'error'); return; }
        await list();
        const g = r.git;
        bus.toast('The functional design of ' + key + ' v' + r.doc.version + ' is saved' + (g ? (g.ok ? (g.pushed ? ' and pushed to git' : ' and committed') : ' — git: ' + (g.error || 'not saved')) : ' on this PC') + '.', g && !g.ok ? 'error' : 'success');
        return;
      }
      const doc = (v.designs || []).filter((d) => d.id === id)[0] || (v.design && v.design.doc && v.design.doc.id === id ? v.design.doc : null);
      if (!doc) return;
      const g = await DD.act(v, act, doc, kind);
      if (act === 'push' && g && v.design && v.design.doc && v.design.doc.id === doc.id) v.design = Object.assign({}, v.design, { git: g });
    }
  }

  return designChain;
});
