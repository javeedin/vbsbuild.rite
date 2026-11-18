define(['vb/action/actionChain', 'resources/js/pagesClient', 'resources/js/aiClient', 'resources/js/shellBus', 'resources/js/mdRender'],
  (ActionChain, PC, AIC, bus, MD) => {
    'use strict';

    // The AI Assistant: load (its conversations, questions to start with, which AI answers); focus (a question handed by
    // another screen); send (the box's question) / ask (key: a question to send, e.g. a follow-up or a suggestion) /
    // again (the last question again); scope (key), field page; newChat, openConv (key), removeConv (key), side;
    // srcCite (key: turn index, value: n) / srcOpen (key: 'turn:n') / srcFile (key: path, value: line) / srcClose /
    // srcGo (open the source's own screen); copy / copyText (key: turn index); settings (AI settings).
    const byId = (id) => { try { return document.getElementById(id); } catch (e) { return null; } };
    const LANG = { js: 'js', mjs: 'js', json: 'json', html: 'html', xml: 'xml', xsd: 'xml', wsdl: 'xml', sql: 'sql', css: '', md: '' };
    class askChain extends ActionChain {
      async run(context, { act, key, value }) {
        const v = context.$page.variables;
        const k = String(key || '');
        const say = (ok, text) => bus.toast(text, ok ? 'success' : 'error');
        const loadConvs = async () => { const r = await PC.assistantConvs(); v.convs = r.ok ? (r.body.convs || []) : []; };
        const scrollEnd = () => setTimeout(() => { const t = byId('askThread'); if (t) t.scrollTop = t.scrollHeight; const last = t && t.querySelector('.nx-ask-turn--last'); if (last && last.scrollIntoView) last.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 120);
        const ask = async (question, redo) => {
          const q = String(question || '').trim();
          if ((!q && !redo) || v.pending) return;
          const pageLabel = v.page ? (((v.sg && v.sg.pages) || []).filter((p) => p.id === v.page)[0] || {}).label || v.page : '';
          // the last turn copied first: the page's variables are replaced below, and what they held is let go
          const last = redo && v.conv && v.conv.turns.length ? JSON.parse(JSON.stringify(v.conv.turns[v.conv.turns.length - 1])) : null;
          if (redo && v.conv) v.conv = Object.assign({}, v.conv, { turns: v.conv.turns.slice(0, -1) });
          v.pending = { q: last ? last.q : q, scope: last ? last.scope : v.scope, pageLabel: last ? last.pageLabel : pageLabel };
          v.error = null; v.secs = 0;
          const box = byId('askInput');
          if (box && !redo) box.value = '';
          scrollEnd();
          const t0 = Date.now();
          const tick = setInterval(() => { v.secs = Math.round((Date.now() - t0) / 1000); }, 1000);
          try {
            const r = await PC.assistantAsk(redo ? { convId: v.conv && v.conv.id, redo: true } : { question: q, scope: v.scope, page: v.page, convId: v.conv ? v.conv.id : '' });
            const b = r.body || {};
            if (b.conv) v.conv = b.conv;
            if (!r.ok || !b.ok) v.error = { text: b.error || 'The AI did not answer.', needsSetup: !!b.needsSetup };
          } finally { clearInterval(tick); v.pending = null; }
          await loadConvs();
          scrollEnd();
        };
        const turnOf = (i) => (v.conv && v.conv.turns ? v.conv.turns[Number(i)] : null);
        const showSrc = async (it, line) => {
          if (!it) return;
          const ref = it.ref || {};
          v.src = { n: it.n, kind: it.kind, label: it.label, ref, text: it.text || '', file: null, line: line || ref.line || 0, lang: '', busy: ref.type === 'file' };
          if (ref.type === 'file') await sfile(ref.path, line || ref.line);
        };
        const sfile = async (p, line) => {
          const r = await PC.assistantFile(p);
          const b = r.body || {};
          const ext = String(p || '').split('.').pop().toLowerCase();
          v.src = Object.assign({}, v.src || { n: 0, kind: 'file', label: p, ref: { type: 'file', path: p }, text: '' }, { file: r.ok && b.ok ? { path: b.path, text: b.text, lines: b.lines } : null, line: Number(line) || 0, lang: LANG[ext] || '', busy: false,
            err: r.ok && b.ok ? '' : (b.error || 'It could not be read.') });
          setTimeout(() => { const el = document.querySelector('#askSrc .nx-ask-ln--at'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' }); }, 120);
        };

        if (act === 'load') {
          const [s, a] = await Promise.all([PC.assistantSuggest(), AIC.settings(), loadConvs()]);
          v.sg = s.ok ? s.body : { app: '', pages: [], questions: [] };
          v.ai = a.ok ? a.body : null;
          await askChain.takeFocus(v, ask);
          return;
        }
        if (act === 'focus') { await askChain.takeFocus(v, ask); return; }
        if (act === 'send') { const box = byId('askInput'); await ask(box ? box.value : ''); return; }
        if (act === 'ask') { await ask(k); return; }
        if (act === 'again') { await ask('', true); return; }
        if (act === 'scope') { v.scope = k || 'all'; return; }
        if (act === 'field') { if (k === 'page') v.page = String(value || ''); return; }
        if (act === 'newChat') { v.conv = null; v.error = null; const box = byId('askInput'); if (box) { box.value = ''; box.focus(); } return; }
        if (act === 'openConv') {
          const r = await PC.assistantConv(k);
          if (r.ok && r.body.conv) { v.conv = r.body.conv; v.error = null; scrollEnd(); } else say(false, (r.body && r.body.error) || 'It could not be read.');
          return;
        }
        if (act === 'removeConv') {
          const c = (v.convs || []).filter((x) => x.id === k)[0];
          if (!c || !window.confirm('Remove the conversation "' + c.title + '"?')) return;
          const r = await PC.assistantRemove(k);
          if (r.ok) { if (v.conv && v.conv.id === k) v.conv = null; await loadConvs(); } else say(false, (r.body && r.body.error) || 'It could not be removed.');
          return;
        }
        if (act === 'side') { v.sideOpen = !v.sideOpen; return; }
        if (act === 'settings') { bus.focus('ai', {}); return; }
        // the sources: a citation in an answer, a chip under it, a file reference
        if (act === 'srcCite') { const t = turnOf(k); await showSrc(t && (t.looked || []).filter((x) => String(x.n) === String(value))[0]); return; }
        if (act === 'srcOpen') { const [ti, n] = k.split(':'); const t = turnOf(ti); await showSrc(t && (t.looked || []).filter((x) => String(x.n) === n)[0]); return; }
        if (act === 'srcFile') { v.src = { n: 0, kind: 'file', label: k, ref: { type: 'file', path: k }, text: '', file: null, line: Number(value) || 0, lang: '', busy: true }; await sfile(k, value); return; }
        if (act === 'srcClose') { v.src = null; return; }
        if (act === 'srcGo') {
          const s = v.src;
          if (!s) return;
          const ref = s.ref || {};
          if (ref.type === 'page') bus.focus('app-pages', { id: ref.id });
          else if (ref.type === 'flow') bus.open({ record: 'saved-flow', params: { flowId: ref.id, title: s.label.replace(/^Saved flow /, '') } });
          else if (ref.type === 'fdd') bus.focus('fdd-library', {});
          else bus.focus('integrations', {});
          v.src = null;
          return;
        }
        // copy an answer: as written (Markdown, for Jira or Teams), or as plain text (an e-mail)
        if (act === 'copy' || act === 'copyText') {
          const t = turnOf(k);
          if (!t || !t.a || !t.a.text) return;
          const text = act === 'copy' ? t.a.text : MD.plain(t.a.text);
          try { await navigator.clipboard.writeText(text); say(true, act === 'copy' ? 'Copied the answer (Markdown).' : 'Copied the answer as plain text.'); } catch (e) { say(false, 'It could not be copied here.'); }
        }
      }

      /** A question handed by another screen (bus.focus('assistant', { q, page, scope })): asked at once. */
      static async takeFocus(v, ask) {
        const f = typeof bus.takeFocus === 'function' ? bus.takeFocus('assistant') : null;
        if (f && f.scope) v.scope = String(f.scope);
        if (f && f.page) v.page = String(f.page);
        if (f && f.q) { if (f.fresh !== false) v.conv = null; await ask(f.q); return; }
        setTimeout(() => { const b = byId('askInput'); if (b) b.focus(); }, 150);
      }
    }
    return askChain;
  });
