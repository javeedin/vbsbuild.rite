define(['vb/action/actionChain', 'resources/js/pagesClient', 'resources/js/shellBus', 'resources/js/integrationDiagram', 'resources/js/flowModel', 'resources/js/exportKit',
  'resources/js/apiClient', 'resources/js/flowRun'],
  (ActionChain, PC, bus, D, FM, exportKit, AC, FR) => {
    'use strict';

    // One saved flow: load; the tabs (tab); a field changed (field: flow.<name> / a.<id>.<field> / s.<id>.<field> /
    // l.<id>.<field>, note, newLane, newLaneKind, cText, cStep); the editor (moveStep / removeStep (key, value: -1 | 1),
    // addStep (key: an action), moveAction / removeAction / addAction, addLane / removeLane); plain; save, saveCopy,
    // revert, remove; comments (comment, resolve (key, value 1 | 0), uncomment, showResolved); history (viewVersion,
    // restoreVersion); check, addFromApp; exports (svg, pdf); openPage. Steps run for real through the API tester
    // (sfChain.runAct): runStep (▶ Run on a step: its panel opens; a read is sent at once), runSend, runConfirm (a call that
    // changes data, only once you confirm), runPick (a value offered), runOpen (a chip: its panel), runClose, runAction
    // (an action's steps in order), runFlow (every step) — Run on an action or the flow never sends a call that changes
    // data; r.<step>.p.<name> / r.<step>.extra / r.<step>.body (its values).
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
          if (k.indexOf('r.') === 0) sfChain.runField(v, k, val); // a value of a step to run
          return;
        }
        if (/^run[A-Z]/.test(act)) { await sfChain.runAct(v, act, String(key || ''), String(value == null ? '' : value), AC, FR); return; }
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

      // ── steps run for real: the API tester (resources/js/apiClient.js → desktop/lib/apiTest.js) sends each call to the
      //    app's backend with the app's login; resources/js/flowRun.js says what can run, its values, its answer ──
      static stepOf(v, sid) { let out = null; ((v.flow && v.flow.actions) || []).forEach((a) => (a.steps || []).forEach((s) => { if (s.id === sid) out = s; })); return out; }
      static setRun(v, sid, patch) { const all = Object.assign({}, v.runs || {}); all[sid] = Object.assign({}, all[sid] || {}, patch); v.runs = all; }
      /** A value typed in a step's panel (kept, so a redraw does not lose it). */
      static runField(v, k, val) {
        const p = /^r\.([^.]+)\.p\.(.+)$/.exec(k);
        const o = /^r\.([^.]+)\.(extra|body)$/.exec(k);
        const sid = (p || o || [])[1];
        if (!sid) return;
        const cur = (v.runs || {})[sid] || {};
        const vals = Object.assign({ params: {}, extra: '', body: '', from: {} }, cur.vals || {});
        if (p) { vals.params = Object.assign({}, vals.params, { [p[2]]: val }); vals.from = Object.assign({}, vals.from, { [p[2]]: 'yours' }); } else vals[o[2]] = val;
        sfChain.setRun(v, sid, { vals });
      }
      /** The values in a step's panel as on screen (a box typed in and not yet left counts too): { params, extra?, body? },
       *  or null when it is not shown. Read before the panel is drawn again (a box drawn again starts empty). */
      static domVals(sid) {
        try {
          const box = document.getElementById('sfpRun-' + sid);
          if (!box) return null;
          const out = { params: {} };
          Array.prototype.forEach.call(box.querySelectorAll('[data-run-param]'), (el) => { out.params[el.getAttribute('data-run-param')] = el.value; });
          const ex = box.querySelector('[data-run-extra]');
          if (ex) out.extra = ex.value;
          const bd = box.querySelector('[data-run-body]');
          // a box just drawn again may not show its text yet (resources/js/textareaSync.js): its value attribute then
          if (bd) out.body = bd.value === '' && bd.hasAttribute('value') && bd !== document.activeElement ? bd.getAttribute('value') : bd.value;
          return out;
        } catch (e) { return null; }
      }
      /** What a step's call sends (the API tester's description): a REST call, or the BI Publisher report it runs — its
       *  path and parameters read from the flow's page. { ok, desc } or { ok: false, error, skip }. */
      static async describe(v, s, AC0, FR0) {
        const w = FR0.what(s);
        if (!w.ok) return { ok: false, error: w.why, skip: true };
        let r = w.kind === 'rest' ? await AC0.op(w.endpoint) : null;
        if (r && !r.ok) return { ok: false, error: (r.body && r.body.error) || 'Its call could not be read.' };
        if (w.kind === 'report' || (r && r.body.op && r.body.op.report && !r.body.op.reportPath)) {
          const page = v.flow && v.flow.source ? v.flow.source.page : '';
          if (!page) return { ok: false, error: 'It runs a BI Publisher report, whose path is read from its page\'s code — this flow has no page.' };
          const rr = await AC0.reports(page, w.report ? [w.report] : []);
          const reps = rr.ok ? (rr.body.reports || []) : [];
          const rep = reps.filter((x) => x.name === w.report)[0] || (w.report ? null : reps[0]);
          if (!rep) return { ok: false, error: 'The report ' + (w.report || '') + ' was not found in the code of ' + page + '.' };
          r = await AC0.report(rep);
          if (!r.ok) return { ok: false, error: (r.body && r.body.error) || 'The report could not be read.' };
        }
        return { ok: true, desc: r.body };
      }
      /** One step sent: its values (yours, else last used, its default, or one an earlier answer gave); a call that
       *  changes data only with opts.confirm. Gives its state: ok | warn | fail | held | missing | skip | error. */
      static async send(v, sid, opts, AC0, FR0) {
        const o = opts || {};
        const s = sfChain.stepOf(v, sid);
        const cur = (v.runs || {})[sid] || {};
        const onScreen = cur.open ? sfChain.domVals(sid) : null;
        sfChain.setRun(v, sid, { busy: true, msg: null });
        const fail = (state, text, extra) => { sfChain.setRun(v, sid, Object.assign({ busy: false, state, note: text, msg: { ok: false, text } }, extra || {})); return state; };
        try {
          let desc = !o.fresh && cur.desc ? cur.desc : null;
          if (!desc) {
            const d = await sfChain.describe(v, s, AC0, FR0);
            if (!d.ok) return fail(d.skip ? 'skip' : 'error', d.error, { desc: null, res: null, short: d.skip ? 'Not run' : 'Not sent' });
            desc = d.desc;
          }
          const typed = onScreen ? { params: Object.assign({}, (cur.vals && cur.vals.params) || {}, onScreen.params), extra: onScreen.extra !== undefined ? onScreen.extra : (cur.vals || {}).extra,
            body: onScreen.body !== undefined ? onScreen.body : (cur.vals || {}).body } : cur.vals;
          const vals = FR0.start(desc, typed);
          // a value kept from before keeps where it came from (it is "yours" only once changed)
          if (cur.vals && cur.vals.from) Object.keys(cur.vals.from).forEach((n) => { if (vals.from[n] === 'yours' && String((cur.vals.params || {})[n] || '') === String(vals.params[n] || '')) vals.from[n] = cur.vals.from[n]; });
          const miss = FR0.missing(desc, vals);
          if (miss.length) return fail('missing', 'Fill in ' + miss.join(', ') + ' to send it.', { desc, vals, need: miss });
          const where = (desc.backend && desc.backend.url) || (desc.op && desc.op.backend) || 'its backend';
          if (!desc.op.reads && !o.confirm) return fail('held', 'This call changes data on ' + where + ' — nothing is sent until you press "Send — it changes data".', { desc, vals });
          const r = await AC0.run(FR0.request(desc, vals, !!o.confirm));
          const b = r.body || {};
          if (b.needsConfirm) return fail('held', b.error || 'It changes data: confirm to send it.', { desc, vals });
          if (b.status === undefined) return fail('error', b.error || 'It was not sent.', { desc, vals });
          const k = FR0.keep(b, new Date().toISOString());
          sfChain.setRun(v, sid, { busy: false, desc, vals, state: 'done', res: k, msg: null, note: '' });
          return !k.ok ? 'fail' : k.shape === 'differs' ? 'warn' : 'ok';
        } catch (e) { return fail('error', 'It was not sent: ' + ((e && e.message) || e)); }
      }
      /** Several steps in order (an action's, or the flow's): each read sent with values an earlier answer gave; a call
       *  that changes data is held (sent only from its own panel); a step with no call is passed. */
      static async runMany(v, actionId, AC0, FR0) {
        const list = FR0.plan(v.flow, actionId);
        const states = [];
        for (const x of list) {
          if (!sfChain.stepOf(v, x.id)) continue;
          states.push(await sfChain.send(v, x.id, { fresh: true }, AC0, FR0));
        }
        return FR0.tally(states);
      }
      static async runAct(v, act, key, value, AC0, FR0) {
        const cur = (v.runs || {})[key] || {};
        const scrollTo = (sid) => setTimeout(() => { try { const el = document.getElementById('sfpRun-' + sid); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* not shown */ } }, 120);
        // ▶ Run on a step: its panel opens with its values; a call that only reads is sent at once
        if (act === 'runStep') {
          if (cur.busy) return;
          const wasOpen = !!cur.open;
          sfChain.setRun(v, key, { open: true });
          scrollTo(key);
          await sfChain.send(v, key, { fresh: !wasOpen }, AC0, FR0);
          return;
        }
        if (act === 'runSend') { if (!cur.busy) await sfChain.send(v, key, {}, AC0, FR0); return; }
        if (act === 'runConfirm') {
          if (cur.busy || !cur.desc) return;
          const op = cur.desc.op || {};
          const where = (cur.desc.backend && cur.desc.backend.url) || op.backend || 'its backend';
          if (!window.confirm('Send ' + op.method + ' ' + op.path + ' to ' + where + '?\n\nIt changes data there — this is not a test copy.')) return;
          await sfChain.send(v, key, { confirm: true }, AC0, FR0);
          return;
        }
        if (act === 'runClose') { sfChain.setRun(v, key, { open: false }); return; }
        // a chip (the Flow tab's or a step's): its panel, on Edit steps
        if (act === 'runOpen') {
          if (v.tab !== 'edit') v.tab = 'edit';
          sfChain.setRun(v, key, { open: true });
          scrollTo(key);
          if (!cur.desc && !cur.busy) {
            const d = await sfChain.describe(v, sfChain.stepOf(v, key), AC0, FR0);
            if (d.ok) sfChain.setRun(v, key, { desc: d.desc, vals: FR0.start(d.desc, cur.vals) }); else sfChain.setRun(v, key, { msg: { ok: false, text: d.error } });
          }
          return;
        }
        // a value offered (seen in an earlier answer) put in its box
        if (act === 'runPick') {
          const i = value.indexOf('=');
          const name = i < 0 ? value : value.slice(0, i), val = i < 0 ? '' : value.slice(i + 1);
          sfChain.runField(v, 'r.' + key + '.p.' + name, val);
          try { const box = document.getElementById('sfpRun-' + key); const el = box ? Array.prototype.filter.call(box.querySelectorAll('[data-run-param]'), (x) => x.getAttribute('data-run-param') === name)[0] : null; if (el) el.value = val; } catch (e) { /* not shown */ }
          return;
        }
        if (act === 'runAction' || act === 'runFlow') {
          if (v.runBusy) return;
          const a = act === 'runAction' ? (v.flow.actions || []).filter((x) => x.id === key)[0] : null;
          if (act === 'runAction' && !a) return;
          v.runBusy = a ? a.id : 'flow';
          v.runSum = null;
          try {
            const t = await sfChain.runMany(v, a ? a.id : '', AC0, FR0);
            const label = a ? 'Action ' + ((v.flow.actions || []).indexOf(a) + 1) : 'The flow';
            v.runSum = { ok: !t.counts.fail, text: label + ' ran: ' + t.text + '.', at: new Date().toISOString() };
            bus.toast(v.runSum.text, t.counts.fail ? 'error' : 'success');
          } finally { v.runBusy = ''; }
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
