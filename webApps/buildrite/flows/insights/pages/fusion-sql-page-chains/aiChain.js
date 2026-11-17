define([
  'vb/action/actionChain',
  'resources/js/fusionSqlClient',
  'resources/js/fusionSqlRun',
  'resources/js/shellBus',
], (ActionChain, C, R, bus) => {
  'use strict';

  // Ask AI: the question (with the conversation and the editor's SQL) to the local server, which lets the AI look
  // things up in the pod's data dictionary and checks its SQL on the pod; the steps shown while it works (polled each
  // second). Its SQL goes into the editor (and runs) only when you say so.
  class aiChain extends ActionChain {
    async run(context, { op, value }) {
      const v = context.$page.variables;
      const ai = v.ai;
      if (op === 'toggle') { v.ai = Object.assign({}, ai, { open: !ai.open }); if (!ai.open) setTimeout(() => { const q = document.getElementById('fsqlAiQ'); if (q) q.focus(); }, 60); return; }
      if (op === 'q') { v.ai = Object.assign({}, ai, { q: String(value || '') }); return; }
      if (op === 'clear') { v.ai = Object.assign({}, ai, { msgs: [], steps: [] }); return; }
      if (op === 'use' || op === 'useRun') {
        const m = ai.msgs[Number(value)];
        if (!m || !m.sql) return;
        R.editor(v, m.sql);
        if (op === 'useRun') await R.run(v, m.sql);
        return;
      }
      if (op !== 'ask' || ai.busy) return;
      const q = String((document.getElementById('fsqlAiQ') || {}).value || ai.q || '').trim();
      if (!q) { bus.toast('Ask a question first.', 'error'); return; }
      const p = R.activePod(v);
      if (!p) { bus.toast('Add a Fusion pod first (Connection).', 'error'); return; }
      const history = ai.msgs.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, text: m.text }));
      const askId = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const t0 = Date.now();
      v.ai = Object.assign({}, ai, { q: '', busy: true, steps: [], secs: 0, msgs: ai.msgs.concat([{ role: 'user', text: q }]) });
      const qi = document.getElementById('fsqlAiQ');
      if (qi) qi.value = '';
      const timer = setInterval(async () => {
        const pr = await C.progress(askId);
        if (v.ai.busy) v.ai = Object.assign({}, v.ai, { steps: (pr.body && pr.body.steps) || v.ai.steps, secs: Math.round((Date.now() - t0) / 1000) });
      }, 1000);
      let r;
      try {
        r = await C.ask({ question: q, history, editorSql: (document.getElementById('fsqlEditor') || {}).value || v.sql || '', pod: p.id, askId });
      } finally { clearInterval(timer); }
      const b = r.body || {};
      const msg = b.ok ? { role: 'assistant', text: b.text, sql: b.sql || '', checked: !!b.checked, checkError: b.checkError || '', steps: b.steps || [], provider: b.provider || '' }
        : { role: 'error', text: b.error || 'The AI did not answer.' };
      v.ai = Object.assign({}, v.ai, { busy: false, steps: [], msgs: v.ai.msgs.concat([msg]) });
      if (!b.ok) bus.toast(b.error || 'The AI did not answer.', 'error');
      setTimeout(() => { const box = document.getElementById('fsqlAiMsgs'); if (box) box.scrollTop = box.scrollHeight; }, 60);
    }
  }
  return aiChain;
});
