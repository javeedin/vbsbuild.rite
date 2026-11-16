define([
  'vb/action/actionChain',
  'resources/js/fddClient',
  'resources/js/designDocs',
  'resources/js/shellBus',
], (ActionChain, FC, DD, bus) => {
  'use strict';

  // FDD library → Design documents: every story's functional design (written under Analyze with AI), with its sprint,
  // version and date — Preview, Download (PDF, Markdown), Open in this PC's reader, Delete (committed and pushed when
  // "Commit and push" is ticked above).
  //   act: list | preview | close | download (kind) | open (kind) | folder | remove | story (open Analyze with AI)
  class designChain extends ActionChain {
    async run(context, { act, id, kind }) {
      const v = context.$page.variables;
      const base = context.$application.path;
      if (act === 'list') { const r = await DD.list(base, ''); v.designs = r.docs; v.designsLocal = r.local; return; }
      if (act === 'close') { v.designView = null; return; }
      const doc = (v.designs || []).filter((d) => d.id === id)[0];
      if (!doc) return;
      if (act === 'story') { bus.open({ record: 'jira-analysis', params: { key: doc.key } }); return; }
      if (act === 'remove') {
        let yes = true;
        try { yes = window.confirm('Delete the design ' + doc.key + ' v' + doc.version + ' (its PDF, HTML and Markdown)?' + (v.upCommit ? ' This is committed and pushed to git.' : '')); } catch (e) { /* no DOM */ }
        if (!yes) return;
        const r = await FC.designRemove(doc.id, v.upCommit);
        const b = r.body || {};
        if (!b.ok) { bus.toast(b.error || 'Could not delete it.', 'error'); return; }
        if (v.designView && v.designView.id === doc.id) v.designView = null;
        await this.run(context, { act: 'list' });
        if (v.canUpload) v.git = (await FC.gitStatus()).body || v.git;
        bus.toast('Deleted ' + doc.key + ' v' + doc.version + '.' + (b.git ? (b.git.ok ? (b.git.pushed ? ' Pushed to git.' : '') : ' Git: ' + b.git.error) : ''), b.git && !b.git.ok ? 'error' : 'success');
        return;
      }
      await DD.act(v, act, doc, kind);
      if (act === 'push' && v.canUpload) v.git = (await FC.gitStatus()).body || v.git;
    }
  }
  return designChain;
});
