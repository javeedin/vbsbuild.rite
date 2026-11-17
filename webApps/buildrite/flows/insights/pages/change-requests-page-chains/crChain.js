define(['vb/action/actionChain', 'resources/js/codeFixClient', 'resources/js/pagesClient', 'resources/js/shellBus', 'resources/js/codeView', 'resources/js/crAnalytics', 'resources/js/fddClient', 'resources/js/crKnowledge'],
  (ActionChain, FX, PC, bus, CV, CRA, FC, K) => {
  'use strict';

  // Change requests. The screen opens on the list; + New change request (or a row) opens one in a tab of its own: its
  // header (the page, what kind, priority, customer, who asked and when, Jira story, issue, due, fixed on / by, state),
  // then Request (what should change), Code fix (made with Code Fix, the same as Application pages → Code fix: the AI's
  // proposal, approved = applied and saved, then what now: try it, send it on, or undo) and History.
  // list: load | list | listField (key, value) | listStatus (key) | newCr (key = page) | openCr (key) | deleteRow (key)
  // one:  field (key, value) | save | delete | tab (key) | openPage
  //   Code fix: ask | refine | apply | applyNoPull | run | commit | push | openProject | undo | undoForce | test | discard
  //   | openFix (key) | newAttempt
  //   New page: field np.* (title, name, flow, group, label, icon, after) — the app's menu and where a page like it is
  //   registered read again as the group / place changes. Knowledge base: field kb.fdd / kb.notes / kbQ | kbFilter (key)
  //   | kbToggle (key) | kbSuggest | kbClear; ask with key 'force' goes on without one.
  const copy = (o) => JSON.parse(JSON.stringify(o || null));
  class crChain extends ActionChain {
    async run(context, { act, key, value }) {
      const v = context.$page.variables;
      const ask = (text) => (typeof window === 'undefined' || !window.confirm ? true : window.confirm(text));
      const say = (r, text) => { v.result = r.ok ? (text ? { ok: true, text } : null) : { ok: false, text: (r.body && r.body.error) || 'It did not work.' }; if (text || !r.ok) bus.toast(r.ok ? text : v.result.text, r.ok ? 'success' : 'error'); };
      const changed = () => { try { bus.emit('change-requests-changed', { at: Date.now() }); } catch (e) { /* no listeners */ } };
      const tabId = () => 'change-request:' + v.crId;
      const labelOf = (pid) => ((v.pages || []).filter((p) => p.id === pid)[0] || {}).label || String(pid || '').split('/').pop();
      const retitle = () => { if (v.crId && v.cr && v.cr.id) { try { bus.rename(tabId(), (v.cr.code ? v.cr.code + ' · ' : '') + (v.cr.title || String(v.cr.request || '').split('\n')[0].slice(0, 50) || 'Change request')); } catch (e) { /* no shell */ } } };

      // ── the list ──
      // a new page: the app's menu, its flows, where a page like it is registered (for the group / place chosen)
      const loadMenu = async () => {
        if (!v.cr || v.cr.kind !== 'page' || !v.cr.page) { v.menuInfo = null; return; }
        const np = v.cr.newPage || {};
        const r = await FX.appMenu(v.cr.page, np.group || '', np.after || '');
        v.menuInfo = r.ok ? r.body : { error: (r.body && r.body.error) || 'The app\'s menu could not be read.' };
        if (r.ok && !np.flow) v.cr = Object.assign({}, v.cr, { newPage: Object.assign({}, np, { flow: r.body.likeFlow || '' }) });
      };
      // the knowledge base's FDD, with its sections
      const loadDoc = async () => {
        const id = v.cr && v.cr.knowledge && v.cr.knowledge.fdd;
        if (!id) { v.kbDoc = null; return; }
        if (v.kbDoc && v.kbDoc.id === id) return;
        const d = (v.fddLib || []).filter((x) => x.id === id)[0];
        const r = await FC.doc(context.$application.path, id, d ? d.uploadedAt : '');
        v.kbDoc = r.ok ? Object.assign({ id: id }, r.body) : null;
      };
      const kb = () => Object.assign({ fdd: '', fddLabel: '', sections: [], notes: '' }, (v.cr && v.cr.knowledge) || {});
      const setKb = (patch) => { v.cr = Object.assign({}, v.cr, { knowledge: Object.assign(kb(), patch) }); };
      const kebab = (t) => String(t || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, 'p-$1').slice(0, 60);
      const loadList = async () => { const l = await FX.crList(''); if (l.ok) { v.all = l.body.requests || []; v.an = CRA.model(v.all, { weeks: 12 }); } else say(l); };
      // ── one change request: its Code Fix attempts (Code Fix's own list for its page, the ones it made) ──
      const loadAttempts = async () => {
        const ids = (v.cr && v.cr.fixes) || [];
        if (!v.cr || !v.cr.page || !ids.length) { v.attempts = []; return; }
        const l = await FX.list(v.cr.page);
        const fixes = (l.body && l.body.fixes) || [];
        v.attempts = fixes.filter((x) => ids.indexOf(x.id) !== -1);
      };
      const loadFix = async () => {
        const id = v.cr && v.cr.fixId;
        if (!id) { v.fix = null; return; }
        const g = await FX.get(id);
        v.fix = g.ok ? g.body.fix : null;
      };
      // the change gone to: scrolled into view in the code frame
      const goChange = () => {
        const rs = (v.codeView === 'before' ? v.code && v.code.beforeRegions : v.code && v.code.regions) || [];
        const r = rs[v.codeAt];
        if (r) CV.scrollTo('crCodeFrame', Math.max(1, r.from));
      };
      const loadCode = async (file) => {
        if (!v.fix) { v.code = null; return; }
        v.codeBusy = true;
        try {
          const r = await FX.code(v.fix.id, file);
          if (r.ok) { v.code = r.body; v.codeAt = 0; if (v.code.created && v.codeView === 'before') v.codeView = 'after'; goChange(); } else { v.code = null; say(r); }
        } finally { v.codeBusy = false; }
      };
      const reload = async () => {
        if (!v.cr || !v.cr.id) return;
        const g = await FX.crGet(v.cr.id);
        if (g.ok) v.cr = copy(g.body.request);
        await loadAttempts();
        retitle();
        changed();
      };
      const blank = (page) => ({ page: page || '', pageLabel: page ? labelOf(page) : '', title: '', kind: 'change', request: '', priority: 'medium', customer: '', requestedBy: '', requestedOn: new Date().toISOString().slice(0, 10),
        jira: '', issue: '', dueOn: '', fixedOn: '', fixedBy: '', state: 'open', notes: '', fixes: [], events: [], status: 'new', statusText: 'New' });
      const openOne = async () => {
        v.fix = null; v.attempts = []; v.result = null; v.fixResult = null; v.refine = ''; v.crTab = 'request';
        v.menuInfo = null; v.kbDoc = null; v.kbAsk = false; v.kbSkip = false;
        if (/^new/.test(String(v.crId))) { v.cr = blank(v.page); return; }
        const g = await FX.crGet(v.crId);
        if (!g.ok) { say(g); v.cr = null; return; }
        v.cr = copy(g.body.request);
        await Promise.all([loadAttempts(), loadFix(), loadMenu(), loadDoc()]);
        retitle();
      };
      const save = async () => {
        if (!v.cr) return { ok: false, body: { error: 'No change request.' } };
        const r = await FX.crSave(v.cr);
        if (r.ok) { v.cr = copy(r.body.request); retitle(); changed(); }
        return r;
      };

      if (act === 'load') {
        const [c, i, lib] = await Promise.all([PC.catalog(context.$application.path), FX.info(), FC.library(context.$application.path)]);
        v.fddLib = lib && lib.ok ? (lib.body.docs || []) : [];
        v.pages = c && c.ok && c.body ? (c.body.pages || []) : [];
        v.fixInfo = i.ok ? i.body : { ok: false, error: (i.body && i.body.error) || 'Code Fix needs the desktop app.' };
        if (v.crId) { await openOne(); return; }
        await loadList();
        return;
      }
      if (act === 'list') { if (!v.crId) await loadList(); return; }
      if (act === 'listField') { if (key === 'q') v.listQ = String(value || ''); return; }
      if (act === 'listStatus') { v.listStatus = String(key || 'all'); return; }
      // Analytics: the view; a status or a page clicked shows those requests in the list
      if (act === 'listView') { v.listView = key === 'analytics' ? 'analytics' : 'list'; await loadList(); return; }
      if (act === 'anStatus') { v.listStatus = String(key || 'all'); v.listQ = ''; v.listView = 'list'; return; }
      if (act === 'anPage') { v.listQ = String(key || ''); v.listStatus = 'all'; v.listView = 'list'; return; }
      if (act === 'newCr') { bus.open({ record: 'change-request', params: { crId: 'new-' + Date.now().toString(36), page: String(key || ''), title: 'New change request' } }); return; }
      if (act === 'openCr') {
        const r0 = (v.all || []).filter((x) => x.id === key)[0];
        bus.open({ record: 'change-request', params: { crId: key, title: r0 ? (r0.code ? r0.code + ' · ' : '') + (r0.title || 'Change request') : 'Change request' } });
        return;
      }
      if (act === 'deleteRow') {
        const r0 = (v.all || []).filter((x) => x.id === key)[0];
        if (!r0 || !ask('Delete ' + (r0.code || 'this change request') + (r0.title ? ' — ' + r0.title : '') + '?\n\nIts Code Fix changes stay in the change history (and in the code if saved).')) return;
        const r = await FX.crRemove(key);
        say(r, r.ok ? (r0.code || 'It') + ' deleted.' : '');
        if (r.ok) { await loadList(); changed(); try { bus.close('change-request:' + key); } catch (e) { /* not open */ } }
        return;
      }

      // ── one change request ──
      if (!v.cr) return;
      if (act === 'field') {
        if (key === 'refine') { v.refine = String(value == null ? '' : value); return; }
        const val = String(value == null ? '' : value);
        // a new page: what it is and where it goes in the menu
        if (/^np\./.test(key)) {
          const k = key.slice(3);
          const np = Object.assign({ title: '', name: '', flow: '', group: '', label: '', icon: '', after: '' }, v.cr.newPage || {});
          if (k === 'title' && (!np.name || np.name === kebab(np.title))) np.name = kebab(val); // the name follows the title until it is typed
          if (k === 'title' && (!np.label || np.label === np.title)) np.label = val;
          if (k === 'group') np.after = '';
          np[k] = k === 'name' ? kebab(val) : val;
          v.cr = Object.assign({}, v.cr, { newPage: np }, k === 'title' && !v.cr.title ? { title: val } : {});
          if (k === 'group' || k === 'after') await loadMenu();
          return;
        }
        // the knowledge base: the FDD, the notes, the sections' search
        if (key === 'kb.fdd') {
          const d = (v.fddLib || []).filter((x) => x.id === val)[0];
          setKb({ fdd: val, fddLabel: d ? d.name + (d.version ? ' v' + d.version : '') : '', sections: val === kb().fdd ? kb().sections : [] });
          v.kbDoc = null;
          await loadDoc();
          return;
        }
        if (key === 'kb.notes') { setKb({ notes: val }); return; }
        if (key === 'kbQ') { v.kbQ = val; return; }
        const patch = {};
        patch[key] = String(value == null ? '' : value);
        if (key === 'page') patch.pageLabel = labelOf(patch.page);
        // a new page: made like the page picked; its title from the request's title to start with
        if (key === 'kind' && patch.kind === 'page' && !v.cr.newPage) patch.newPage = { title: v.cr.title || '', name: kebab(v.cr.title), flow: '', group: '', label: v.cr.title || '', icon: '', after: '' };
        v.cr = Object.assign({}, v.cr, patch);
        if ((key === 'kind' || key === 'page') && v.cr.kind === 'page') await loadMenu();
        return;
      }
      if (act === 'tab') {
        v.crTab = String(key || 'request');
        if ((v.crTab === 'fix' || v.crTab === 'how') && v.cr.fixId && !v.fix) await loadFix();
        if (v.crTab === 'how' && v.fix && (!v.code || v.code.fix !== v.fix.id || v.code.status !== v.fix.status)) await loadCode('');
        return;
      }
      // How it was fixed: one changed file in full (with the change / as it was / only the change); its changes one by one
      if (act === 'codeFile') { await loadCode(String(key || '')); return; }
      if (act === 'codeView') { v.codeView = String(key || 'after'); v.codeAt = 0; goChange(); return; }
      if (act === 'codePrev' || act === 'codeNext') {
        const n = ((v.codeView === 'before' ? v.code && v.code.beforeRegions : v.code && v.code.regions) || []).length;
        v.codeAt = Math.max(0, Math.min(n - 1, v.codeAt + (act === 'codeNext' ? 1 : -1)));
        goChange();
        return;
      }
      if (act === 'save') { const r = await save(); say(r, r.ok ? (r.body.request.code + ' saved.') : ''); return; }
      if (act === 'delete') {
        if (!v.cr.id) { try { bus.close(tabId()); } catch (e) { /* no shell */ } return; }
        if (!ask('Delete ' + (v.cr.code || 'this change request') + '?\n\nIts Code Fix changes stay in the change history (and in the code if saved).')) return;
        const r = await FX.crRemove(v.cr.id);
        say(r, r.ok ? 'Deleted.' : '');
        if (r.ok) { changed(); try { bus.close(tabId()); } catch (e) { /* no shell */ } }
        return;
      }
      // its page in Application pages (its sheet; its own Code fix tab there too)
      if (act === 'openPage') { if (v.cr.page) bus.focus('app-pages', { id: v.cr.page }); return; }
      if (act === 'openProject') {
        const w = v.fixInfo && v.fixInfo.workspace;
        if (w && w.key) bus.open({ record: 'vbs-project', params: { key: w.key, name: w.name, ws: w.ws } });
        return;
      }
      // the knowledge base: filter, tick a section, suggest from the request, clear
      if (act === 'kbFilter') { v.kbFilter = String(key || 'all'); return; }
      if (act === 'kbToggle') { const ks = kb().sections.slice(); const i = ks.indexOf(key); if (i === -1) ks.push(key); else ks.splice(i, 1); setKb({ sections: ks }); return; }
      if (act === 'kbSuggest') {
        if (!v.kbDoc) { say({ ok: false, body: { error: 'Choose an FDD first.' } }); return; }
        const np = v.cr.newPage || {};
        const got = K.suggest(v.kbDoc, [v.cr.title, v.cr.request, np.title].filter(Boolean).join('. '));
        const ks = kb().sections.slice();
        got.forEach((k) => { if (ks.indexOf(k) === -1) ks.push(k); });
        setKb({ sections: ks });
        say({ ok: true }, got.length ? got.length + ' section' + (got.length === 1 ? '' : 's') + ' of the FDD match the request: ticked.' : 'No section of this FDD matches the request\'s words: tick them by hand.');
        return;
      }
      if (act === 'kbClear') { setKb({ sections: [] }); return; }
      if (act === 'openFix') { const g = await FX.get(key); if (g.ok) { v.fix = g.body.fix; v.fixResult = null; v.code = null; } else say(g); return; }
      if (act === 'newAttempt') { v.fix = null; v.fixResult = null; v.refine = ''; return; }

      // ── Code fix: one at a time ──
      if (v.fixBusy) return;
      const fail = (r, text) => { const b = (r && r.body) || {}; v.fixResult = { ok: false, text: b.error || text || 'It did not work.', canSkipPull: !!b.canSkipPull, canForce: !!b.canForce }; };
      const show = (r, text) => { if (r.body && r.body.fix) v.fix = r.body.fix; if (r.ok) v.fixResult = text ? { ok: true, text: text } : null; else fail(r); };
      const note = async (what, text) => { if (v.cr.id) { const e = await FX.crEvent(v.cr.id, what, text || ''); if (e.ok) v.cr = copy(e.body.request); } };
      const ai = (v.fixInfo && v.fixInfo.ai && v.fixInfo.ai.provider) || 'the AI';
      v.fixBusy = true;
      v.fixResult = null;
      try {
        if (act === 'ask' || act === 'refine') {
          const refine = act === 'refine';
          if (!v.cr.page) { v.fixResult = { ok: false, text: 'Pick the page this change is for (in the header) first.' }; return; }
          const request = String(v.cr.request || v.cr.title || '').trim();
          if (!refine && !request) { v.fixResult = { ok: false, text: 'Say what should change first (Request tab).' }; return; }
          const isPage = v.cr.kind === 'page';
          const np = Object.assign({}, v.cr.newPage || {});
          if (isPage && !refine) {
            if (!np.title) { v.crTab = 'request'; v.fixResult = { ok: false, text: 'Give the new page a title (Request tab, The new page).' }; return; }
            np.name = np.name || kebab(np.title);
            np.flow = np.flow || (v.menuInfo && v.menuInfo.likeFlow) || '';
            // before the AI makes a page: what should it build it from? (asked once; "Ask the AI now" goes on without)
            const has = kb().sections.length || String(kb().notes || '').trim();
            if (!has && key !== 'force' && !v.kbSkip) { v.crTab = 'kb'; v.kbAsk = true; return; }
          }
          if (key === 'force') v.kbSkip = true;
          v.kbAsk = false;
          if (v.cr.knowledge && v.cr.knowledge.fdd) await loadDoc();
          const knowledge = K.text(v.kbDoc, kb().sections, kb().notes);
          if (refine && (!v.fix || !String(v.refine || '').trim())) { v.fixResult = { ok: false, text: 'Say what to change in the proposal.' }; return; }
          // saved first: the attempt belongs to it (a new one gets its CR number now)
          const s = await save();
          if (!s.ok) { fail(s); return; }
          v.fixProgress = (refine ? 'Asking ' + ai + ' again with what you said' : (isPage ? 'Reading ' + labelOf(v.cr.page) + ' (the page it is like) and where your app registers its pages, and asking ' : 'Reading ' + labelOf(v.cr.page) + '\'s code and asking ') + ai)
            + (knowledge ? ', with your knowledge base' : '') + ' — a careful answer takes a minute or two. Nothing is changed in the code.';
          const refs = { jira: v.cr.jira || '', issue: v.cr.issue || v.cr.code || '' };
          const r = await FX.analyze(refine ? { id: v.cr.page, request: v.fix.request, kind: v.fix.kind, refine: v.refine.trim(), parent: v.fix.id, images: [], knowledge: knowledge }
            : Object.assign({ id: v.cr.page, request: request, kind: v.cr.kind, images: [], refs: refs, knowledge: knowledge }, isPage ? { newPage: np } : {}));
          if (!r.ok) { fail(r); return; }
          v.fix = r.body.fix;
          if (refine) { v.refine = ''; try { const el = document.getElementById('crRefine'); if (el) el.value = ''; } catch (e) { /* no DOM */ } }
          const l = await FX.crLink(v.cr.id, v.fix.id, refine ? 'asked again' : (isPage ? 'asked the AI for the page' : 'asked the AI'));
          if (l.ok) v.cr = copy(l.body.request);
          v.crTab = 'fix';
          await loadAttempts();
          retitle(); changed();
          return;
        }
        const fid = v.fix && v.fix.id;
        if (!fid) return;
        if (act === 'apply' || act === 'applyNoPull') {
          const ws = !!v.fix.workspace;
          const branch = (v.fixInfo && v.fixInfo.branch) || 'the branch';
          const pull = act === 'apply' && !ws;
          if (!ask(ws ? 'Write this change into ' + v.fix.files.length + ' file(s) in your workspace\'s working folder and save it there?\n\n' + v.fix.folder + '\n\nIt is checked first: if something breaks it is written but not saved. Nothing is pulled or pushed. Undo takes it out again.'
            : 'Apply this change to ' + v.fix.files.length + ' file(s) (branch ' + branch + ')?\n\n' + (pull ? 'It pulls ' + branch + ' first. ' : 'It does NOT pull first. ') + 'Then it tests, writes the files, tests again and commits them when nothing broke (not pushed). Undo takes it out again.')) return;
          v.fixProgress = ws ? 'Writing the files in your working folder, checking them and saving them…' : (pull ? 'Pulling ' + branch + ', testing' : 'Testing') + ', writing the files, testing again, committing…';
          const r = await FX.apply(fid, !pull, true);
          const sv = r.ok && r.body.fix.status === 'committed';
          show(r, r.ok ? (sv ? 'Applied and saved (commit ' + r.body.fix.commit.sha + (ws ? ', on this PC only' : ', not pushed') + '). Try it.' : 'Applied, but something broke, so it is not saved: look at the checks, then Save anyway or Undo.') : '');
          if (r.ok) await note(sv ? (ws ? 'saved in working' : 'committed') : 'applied', sv ? 'commit ' + r.body.fix.commit.sha : 'not saved: something broke');
          await reload();
          return;
        }
        if (act === 'run') {
          v.fixProgress = 'Building your working copy (when its code changed) and opening ' + labelOf(v.cr.page) + ' in a window…';
          const r = await PC.run(v.cr.page);
          const b = r.body || {};
          v.fixResult = r.ok && b.ok ? { ok: true, text: 'Opened in a window: ' + b.url + (b.from === 'workspace' ? ' — your workspace\'s working folder' + (b.built ? ', built just now' : '') + '.' : '.') } : { ok: false, text: b.error || 'It could not be opened.' };
          return;
        }
        if (act === 'commit' || act === 'push') {
          if (act === 'commit' && v.fix.tests && !v.fix.tests.ok && !ask('Something broke (see the checks). Save it anyway?')) return;
          v.fixProgress = act === 'push' ? 'Pushing…' : 'Saving…';
          const was = v.fix.status;
          const r = await FX.commit(fid, act === 'push');
          const c = r.ok && r.body.fix.commit;
          show(r, c ? (act === 'push' ? (c.pushed ? 'Pushed to ' + c.upstream + '.' : 'The push failed: ' + (c.pushError || 'see the history')) : 'Saved: commit ' + c.sha + '.') : '');
          if (c && was !== 'committed') await note(v.fix.workspace ? 'saved in working' : 'committed', 'commit ' + c.sha);
          if (c && c.pushed) await note('pushed', 'to ' + c.upstream);
          await reload();
          return;
        }
        if (act === 'undo' || act === 'undoForce') {
          if (!ask(act === 'undoForce' ? 'The files changed after the fix. Put them back as they were before the fix anyway (those later changes are lost)?'
            : v.fix.status === 'committed' ? 'Take this change out again? Its commit (' + ((v.fix.commit && v.fix.commit.sha) || '') + ') is reverted: a new commit that puts the files back.' : 'Put the files back as they were before the change?')) return;
          v.fixProgress = 'Putting the files back…';
          const r = await FX.undo(fid, act === 'undoForce');
          show(r, r.ok ? 'Undone: the files are as they were.' : '');
          if (r.ok) await note('undone', (r.body.fix.undone && r.body.fix.undone.revert) ? 'its commit reverted (' + r.body.fix.undone.revert + ')' : 'files put back');
          await reload();
          return;
        }
        if (act === 'test') { v.fixProgress = 'Running the checks and the related tests…'; show(await FX.test(fid), 'Checked again.'); return; }
        if (act === 'discard') {
          if (!ask('Discard this proposal? Nothing was written to the code.')) return;
          const r = await FX.discard(fid);
          show(r, r.ok ? 'Discarded.' : '');
          if (r.ok) await note('discarded', fid);
          await reload();
          return;
        }
      } finally {
        v.fixBusy = false;
        v.fixProgress = '';
      }
    }
  }
  return crChain;
});
