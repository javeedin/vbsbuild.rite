define(['vb/action/actionChain', 'resources/js/pagesClient', 'resources/js/shellBus', 'resources/js/integrationDiagram', 'resources/js/flowModel', 'resources/js/exportKit'],
  (ActionChain, PC, bus, D, FM, exportKit) => {
    'use strict';

    // One saved flow: load; the tabs (tab); a field changed (field: flow.<name> / a.<id>.<field> / s.<id>.<field> /
    // l.<id>.<field>, note, newLane, newLaneKind, cText, cStep); the editor (moveStep / removeStep (key, value: -1 | 1),
    // addStep (key: an action), moveAction / removeAction / addAction, addLane / removeLane); plain; save, saveCopy,
    // revert, remove; comments (comment, resolve (key, value 1 | 0), uncomment, showResolved); history (viewVersion,
    // restoreVersion); check, addFromApp; exports (svg, pdf); openPage.
    class sfChain extends ActionChain {
      async run(context, { act, key, value }) {
        const v = context.$page.variables;
        const clone = (x) => JSON.parse(JSON.stringify(x));
        const tabId = () => 'saved-flow:' + v.flowId;
        const retitle = () => { if (v.flow) { try { bus.rename(tabId(), v.flow.id + ' · ' + v.flow.name); } catch (e) { /* no shell */ } } };
        const changed = () => { try { bus.emit('saved-flows-changed', { at: Date.now() }); } catch (e) { /* no listeners */ } };
        const say = (ok, text) => { v.result = { ok: ok, text: text }; bus.toast(text, ok ? 'success' : 'error'); };
        // what came back from the store: its comments, history, versions and version are the store's; the steps edited
        // here stay as they are unless asked (a save)
        const take = (f, all) => { v.flow = all ? clone(f) : Object.assign({}, v.flow, { comments: f.comments, history: f.history, versions: f.versions, version: f.version }); v.saved = Object.assign({}, v.saved || {}, all ? clone(f) : { comments: f.comments, history: f.history, versions: f.versions, version: f.version }); };
        const ed = (op, args) => { v.flow = FM.edit(v.flow, op, args); };

        if (act === 'load') {
          v.busy = true;
          try {
            const r = await PC.flowGet(v.flowId);
            const b = r.body || {};
            if (r.ok && b.ok) { take(b.flow, true); retitle(); } else v.result = { ok: false, text: b.error || 'This saved flow could not be read.' };
          } finally { v.busy = false; }
          return;
        }
        if (!v.flow) return;
        if (act === 'tab') { v.tab = String(key || 'flow'); if (v.tab === 'check' && !v.check) await sfChain.check(v, PC, FM); return; }
        if (act === 'plain') { v.plain = !v.plain; return; }
        if (act === 'field') {
          const k = String(key || ''), val = String(value == null ? '' : value);
          if (['note', 'newLane', 'newLaneKind', 'cText', 'cStep'].indexOf(k) !== -1) { v[k] = val; return; }
          if (k.indexOf('flow.') === 0) { ed('set', { what: k.slice(5), value: val }); if (k === 'flow.name') retitle(); return; }
          if (/^[asln]\./.test(k)) ed('set', { what: k, value: val }); // an action, a step, a lane, a sticky note
          return;
        }
        // the editor: each change gives a new flow (FM.edit); nothing is kept until Save
        if (['moveStep', 'moveAction'].indexOf(act) !== -1) { ed(act, { id: key, by: Number(value) || 1 }); return; }
        if (['removeStep', 'removeAction', 'removeLane'].indexOf(act) !== -1) {
          if (act === 'removeStep' && !window.confirm('Remove this step?')) return;
          if (act === 'removeAction' && !window.confirm('Remove this action and its steps?')) return;
          ed(act, { id: key });
          return;
        }
        if (act === 'addStep') { ed('addStep', { action: key }); return; }
        if (act === 'addAction') { ed('addAction', {}); return; }
        // sticky notes: on an action (key) or the whole flow (no key); from the Flow tab, then on to Edit steps to write it
        if (act === 'addSticky') {
          ed('addSticky', { action: key || '', lane: '', color: 'yellow', text: '' });
          if (v.tab !== 'edit') { v.tab = 'edit'; bus.toast('A sticky note was added — write it under "Sticky notes on the whole flow".', 'info'); }
          return;
        }
        if (act === 'removeSticky') { ed('removeSticky', { id: key }); return; }
        if (act === 'stickyColor') { ed('set', { what: 'n.' + key + '.color', value: value }); return; }
        if (act === 'addLane') {
          if (!String(v.newLane || '').trim()) { bus.toast('Name the system first (e.g. E-mail, SFTP, a person).', 'info'); return; }
          ed('addLane', { name: v.newLane, kind: v.newLaneKind || 'other' });
          v.newLane = '';
          sfChain.clear('sfpNewLane');
          return;
        }
        if (act === 'revert') { if (v.saved) v.flow = clone(v.saved); bus.toast('Your changes were put back to the version saved.', 'info'); return; }
        if (act === 'save') {
          v.busy = true;
          try {
            const r = await PC.flowSave(v.flow, v.note);
            const b = r.body || {};
            if (!r.ok || !b.ok) { say(false, b.error || 'It could not be saved.'); return; }
            take(b.flow, true);
            v.note = '';
            retitle();
            changed();
            say(true, 'Saved ' + b.flow.id + ' as version ' + b.flow.version + '.');
          } finally { v.busy = false; }
          return;
        }
        if (act === 'saveCopy') {
          const name = window.prompt('A name for the copy', 'Copy of ' + v.flow.name);
          if (name === null) return;
          const r = await PC.flowSave(Object.assign({}, v.flow, { name: name || 'Copy of ' + v.flow.name, status: 'draft' }), 'a copy of ' + v.flow.id, true);
          const b = r.body || {};
          if (!r.ok || !b.ok) { say(false, b.error || 'It could not be copied.'); return; }
          changed();
          say(true, 'Saved as a copy: ' + b.flow.id + '.');
          bus.open({ record: 'saved-flow', params: { flowId: b.flow.id, title: b.flow.id + ' · ' + b.flow.name } });
          return;
        }
        if (act === 'remove') {
          if (!window.confirm('Remove ' + v.flow.id + ' · ' + v.flow.name + '? Its versions and comments go too.')) return;
          const r = await PC.flowRemove(v.flow.id);
          if (r.ok && r.body && r.body.ok) { changed(); bus.toast('Removed ' + v.flow.id + '.', 'success'); try { bus.close(tabId()); } catch (e) { /* no shell */ } } else say(false, (r.body && r.body.error) || 'It could not be removed.');
          return;
        }
        // comments: kept at once (no new version)
        if (act === 'comment') {
          if (!String(v.cText || '').trim()) { bus.toast('Write the comment first.', 'info'); return; }
          const r = await PC.flowComment(v.flow.id, v.cText, v.cStep);
          const b = r.body || {};
          if (!r.ok || !b.ok) { say(false, b.error || 'The comment could not be kept.'); return; }
          take(b.flow, false);
          v.cText = '';
          sfChain.clear('sfpCText');
          changed();
          return;
        }
        if (act === 'resolve' || act === 'uncomment') {
          if (act === 'uncomment' && !window.confirm('Remove this comment?')) return;
          const r = act === 'resolve' ? await PC.flowResolve(v.flow.id, key, value === '1') : await PC.flowUncomment(v.flow.id, key);
          const b = r.body || {};
          if (r.ok && b.ok) { take(b.flow, false); changed(); } else say(false, b.error || 'It could not be changed.');
          return;
        }
        if (act === 'showResolved') { v.showResolved = !v.showResolved; return; }
        // history: an earlier version shown, or put back into the editor (Save keeps it as a new version)
        if (act === 'viewVersion') { v.viewV = Number(key) === v.viewV ? 0 : Number(key) || 0; return; }
        if (act === 'restoreVersion') {
          const old = (v.flow.versions || []).filter((x) => x.v === Number(key))[0];
          if (!old) return;
          v.flow = Object.assign({}, v.flow, { name: old.name || v.flow.name, lanes: clone(old.lanes || []), actions: clone(old.actions || []), stickies: clone(old.stickies || []) });
          v.viewV = 0;
          v.tab = 'edit';
          v.note = 'Back to version ' + old.v;
          bus.toast('Version ' + old.v + ' is in the editor — Save to keep it as a new version.', 'info');
          return;
        }
        // checked against the app now
        if (act === 'check') { await sfChain.check(v, PC, FM, true); v.tab = 'check'; return; }
        if (act === 'addFromApp') {
          if (!v.m) await sfChain.check(v, PC, FM);
          if (!v.m) return;
          const before = (v.flow.actions || []).reduce((n, a) => n + a.steps.length, 0);
          v.flow = FM.addFromApp(v.flow, v.m);
          v.check = FM.check(v.flow, v.m);
          const added = (v.flow.actions || []).reduce((n, a) => n + a.steps.length, 0) - before;
          bus.toast(added + ' call' + (added === 1 ? '' : 's') + ' added from the app — Save to keep them.', 'success');
          return;
        }
        if (act === 'openPage') { if (v.flow.source && v.flow.source.page) bus.focus('app-pages', { id: v.flow.source.page }); return; }
        // the exports
        const fileBase = 'flow-' + String(v.flow.id || 'new').toLowerCase() + '-' + String(v.flow.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
        if (act === 'svg') {
          const d = D.flowSwim(FM.toModel(v.flow), { plain: v.plain });
          exportKit.download(fileBase + '.svg', 'image/svg+xml', d.svg);
          bus.toast('Saved ' + fileBase + '.svg.', 'success');
          return;
        }
        if (act === 'pdf') {
          const html = FM.html(v.flow, { plain: v.plain });
          if (v.pdfBusy) return;
          v.pdfBusy = true;
          try {
            const r = await PC.integrationsPdf(html, fileBase + '.pdf');
            const b = r.body || {};
            if (r.ok && b.base64) {
              const bin = atob(b.base64);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              exportKit.download(fileBase + '.pdf', 'application/pdf', bytes);
              bus.toast('Saved ' + fileBase + '.pdf.', 'success');
            } else if (b.noPdf) { exportKit.printDocument(html); bus.toast('Choose "Save as PDF" in the print dialog.', 'info'); } else say(false, b.error || 'The PDF could not be made.');
          } finally { v.pdfBusy = false; }
        }
      }

      /** A box emptied on screen too (its value was typed, so the binding alone may leave it). */
      static clear(id) { try { const el = document.getElementById(id); if (el) el.value = ''; } catch (e) { /* not shown */ } }

      /** The app's scan (read once), then the flow against it. */
      static async check(v, PC0, FM0, again) {
        if (!v.m || again) {
          const r = await PC0.integrations((v.flow && v.flow.app) || '');
          const b = r.body || {};
          if (r.ok && b.ok) v.m = b; else { v.check = { ok: false, text: b.error || 'The app could not be scanned.', missing: [], added: [] }; return; }
        }
        v.check = FM0.check(v.flow, v.m);
      }
    }
    return sfChain;
  });
