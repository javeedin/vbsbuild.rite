define(['vb/action/actionChain', 'resources/js/aiClient', 'resources/js/shellBus'], (ActionChain, AI, bus) => {
  'use strict';

  // AI settings: load | edit (provider) | field (key, value) | models | save | cancel | forget (provider)
  //              | default (value) | use (feature, value) | test (feature)
  class aiChain extends ActionChain {
    async run(context, { act, key, value }) {
      const v = context.$page.variables;
      const reload = async () => { const r = await AI.settings(); if (r.ok) v.st = r.body; else v.result = { ok: false, text: r.body.error || 'The AI settings could not be read.' }; return r.ok; };
      const say = (r, ok) => { v.result = r.ok ? { ok: true, text: ok } : { ok: false, text: (r.body && r.body.error) || 'It did not work.' }; bus.toast(v.result.text, r.ok ? 'success' : 'error'); };
      if (act === 'load') { await reload(); return; }
      if (act === 'edit') {
        const p = ((v.st && v.st.providers) || {})[key] || {};
        v.edit = { provider: key, model: p.model || '', forAll: key === 'claudecode' && !(v.st && v.st.active), forFix: key === 'claudecode' };
        v.models = [];
        if (key === 'claudecode') {
          v.cc = null; v.ccLog = '';
          const m = await AI.models('claudecode'); v.models = (m.body && m.body.models) || [];
          const s = await AI.claude(); v.cc = s.body && s.body.ok !== false ? Object.assign({}, s.body, { signedIn: false }) : { installed: false, error: (s.body && s.body.error) || '' };
        }
        return;
      }
      // ── Claude Code: found? install, sign in, test, use ──
      if (act === 'ccStatus') { const s = await AI.claude(); v.cc = Object.assign({}, v.cc || {}, s.body || {}, { busy: '' }); return; }
      if (act === 'ccInstall') {
        v.busy = true; v.cc = Object.assign({}, v.cc || {}, { busy: 'install' }); v.ccLog = '';
        try {
          const r = await AI.claudeInstall();
          v.ccLog = (r.body && r.body.tail) || '';
          const s = await AI.claude();
          v.cc = Object.assign({}, s.body || {}, { busy: '', signedIn: false });
          say(r, 'Claude Code is installed. Next: Sign in…');
        } finally { v.busy = false; }
        return;
      }
      if (act === 'ccSignin') { const r = await AI.claudeSignIn(); say(r, (r.body && r.body.text) || 'A window with Claude Code is open: sign in there.'); return; }
      if (act === 'ccTest') {
        v.busy = true; v.cc = Object.assign({}, v.cc || {}, { busy: 'test', error: '' });
        try {
          const r = await AI.claudeCheck();
          const b = r.body || {};
          v.cc = Object.assign({}, v.cc, { busy: '', signedIn: !!(r.ok && b.signedIn), answer: b.text || '', ms: b.ms || 0, error: r.ok ? '' : (b.error || 'No answer.') });
        } finally { v.busy = false; }
        return;
      }
      if (act === 'ccOpt') { if (v.edit) v.edit = Object.assign({}, v.edit, { [key]: !v.edit[key] }); return; }
      if (act === 'ccUse') {
        if (!v.edit) return;
        v.busy = true;
        try {
          const r = await AI.save({ provider: 'claudecode', model: v.edit.model || '', makeDefault: !!v.edit.forAll || !(v.st && v.st.active) });
          if (r.ok && v.edit.forFix) await AI.use('codefix', 'claudecode');
          say(r, 'Claude Code is set up' + (v.edit.forAll ? ' — the default for everything' : '') + (v.edit.forFix ? (v.edit.forAll ? ', and for Code fix' : ' — for Code fix') : '') + '. Change where it is used below.');
          if (r.ok) { v.edit = null; v.models = []; await reload(); }
        } finally { v.busy = false; }
        return;
      }
      if (act === 'cancel') { v.edit = null; v.models = []; return; }
      if (act === 'field') { if (v.edit) v.edit = Object.assign({}, v.edit, { [key]: value }); return; }
      if (act === 'models') {
        if (!v.edit) return;
        v.busy = true;
        try {
          // the key just typed is saved first (kept as the default only when there is none), so its models can be read
          const typed = Object.keys(v.edit).some((k) => k !== 'provider' && k !== 'model' && v.edit[k]);
          if (typed) { const s = await AI.save(Object.assign({ makeDefault: false }, v.edit)); if (!s.ok) { say(s); return; } }
          const m = await AI.models(v.edit.provider);
          v.models = (m.body && m.body.models) || [];
          v.result = m.ok ? { ok: true, text: v.models.length + ' models this key may use: choose one, then Save.' } : { ok: false, text: (m.body && m.body.error) || 'Its models could not be read (check the key).' };
          await reload();
        } finally { v.busy = false; }
        return;
      }
      if (act === 'save') {
        if (!v.edit) return;
        v.busy = true;
        try {
          const first = !(v.st && v.st.active);
          const r = await AI.save(Object.assign({ makeDefault: first }, v.edit));
          say(r, (v.st.catalog || []).filter((c) => c.id === v.edit.provider).map((c) => c.label)[0] + ' is set up' + (first ? ' — the default for everything.' : '. Choose where it is used below.'));
          if (r.ok) { v.edit = null; v.models = []; await reload(); }
        } finally { v.busy = false; }
        return;
      }
      if (act === 'forget') {
        if (typeof window !== 'undefined' && window.confirm && !window.confirm('Forget this AI and its key on this PC?')) return;
        const r = await AI.forget(key);
        say(r, 'Forgotten.');
        await reload();
        return;
      }
      if (act === 'default') { const r = await AI.setDefault(value); say(r, value ? 'The default for everything is set.' : 'No default: each feature uses its own.'); await reload(); return; }
      if (act === 'use') { const r = await AI.use(key, value); say(r, value ? 'Set for this feature.' : 'This feature uses the default.'); await reload(); return; }
      if (act === 'test') {
        v.busy = true;
        v.tests = Object.assign({}, v.tests, { [key]: { busy: true } });
        try {
          const r = await AI.test(key);
          const b = r.body || {};
          v.tests = Object.assign({}, v.tests, { [key]: r.ok && b.ok !== false ? { ok: true, text: (b.provider || '') + (b.model ? ' · ' + b.model : '') + ' answered in ' + Math.round((b.ms || 0) / 100) / 10 + ' s' }
            : { ok: false, text: b.error || 'No answer.' } });
        } finally { v.busy = false; }
      }
    }
  }
  return aiChain;
});
