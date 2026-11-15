define([], () => {
  'use strict';

  // Run console: binding helpers. The log itself is drawn by resources/js/runConsoleView.js (not bound line by line). No `this`.
  const FILTERS = [['', 'All'], ['build', 'Build'], ['server', 'Server'], ['app', 'App'], ['errors', 'Errors']];
  // A role code as words: its short leading parts (an app's prefix, like XX_APP_) left out while words remain —
  // XX_APP_TIME_APPROVER → Time approver, ADMIN → Admin
  const roleLabel = (r) => {
    const parts = String(r || '').split('_').filter(Boolean);
    while (parts.length > 1 && parts[0].length <= 3) parts.shift();
    const t = parts.join(' ').toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  // Visual Builder's version as people say it: 2701 → 27.01
  const vbOf = (s) => { const m = /^(\d\d)(\d\d)$/.exec(String(s || '')); return m ? m[1] + '.' + m[2] : String(s || '?'); };
  class PageModule {
    filters(f) { return FILTERS.map((x) => ({ id: x[0], label: x[1], cls: 'nx-chip nx-chip--sm' + (x[0] === (f || '') ? ' nx-chip--on' : '') })); }
    logClass(f) { return 'nx-rc-log' + (f ? ' rc-f-' + f : ''); }
    whoText(s) {
      if (!s) return 'Reading…';
      if (!s.signedInAs) return 'The app runs anonymous — pages that need access stay hidden: choose who it runs as below';
      return 'The app runs as ' + s.signedInAs + (s.roles ? ' · ' + s.roles.map(roleLabel).join(', ') : ' · roles from Fusion') + (s.by === 'run-as' ? ' (Run as)' : ' (the sign-in)');
    }
    whoClass(s) { return 'nx-rc-who' + (s && (!s.signedInAs || s.noAccess) ? ' nx-rc-who--anon' : ''); }
    // Run as: the roles the app knows, each a chip (on when chosen)
    roleChips(s, chosen) { return ((s && s.knownRoles) || []).map((r) => ({ id: r, label: roleLabel(r), cls: 'nx-chip nx-chip--sm' + ((chosen || []).indexOf(r) !== -1 ? ' nx-chip--on' : '') })); }
    noAccessText(s) { return !s || !s.noAccess ? '' : 'The app said "You don\'t have access" — it ran as ' + s.noAccess.as + '. Choose a user and a role below, then Apply: the app\'s window reloads.'; }
    wsText(s) { return !s ? '' : (s.workspace ? 'Workspace ' + s.workspace : 'No workspace set up'); }
    buildText(s) {
      if (!s) return '';
      if (s.building) return 'Building…';
      return s.built ? 'Built ' + new Date(s.builtAt).toLocaleTimeString() : 'Not built yet';
    }
    windowText(s) { return !s ? '' : (s.window ? 'Window open: ' + String(s.window).replace(/^https?:\/\/[^/]+/, '') : 'Window closed'); }
    busyLabel(busy, text) { return busy ? 'Running: ' + text + '…' : ''; }

    // ── Your app: what Build.Rite read from its code (desktop/lib/appProfile.js) ──
    appHead(x) {
      const p = x && x.profile;
      if (!x) return 'Reading your app…';
      if (!p) return x.error || 'No workspace set up yet.';
      if (p.kind === 'extension') return 'An App UI extension of Oracle Cloud Applications';
      if (p.kind !== 'app') return 'No Visual Builder project found';
      return (p.apps || []).map((a) => a.name).join(', ') + ' · Visual Builder ' + vbOf(p.vb && p.vb.source);
    }
    appFacts(x) {
      const p = x && x.profile;
      if (!p || p.kind !== 'app') return [];
      const out = [];
      const add = (k, v) => { if (v) out.push({ k: k, v: v }); };
      add('Project folder', p.root);
      add('Visual Builder', vbOf(p.vb.source) + (p.vb.designer ? ' (designer ' + p.vb.designer + ')' : ''));
      add('Build tool', x.tool ? (x.tool.ok ? x.tool.why : 'cannot build: ' + (x.tool.why || x.tool.error || '')) : (p.buildTool.version || 'not named in its package.json'));
      add('Apps', (p.apps || []).map((a) => a.name + (a.type === 'mobile' ? ' (mobile)' : '') + ' — ' + a.auth).join(' · '));
      add('Roles', p.roles.codes.length ? p.roles.codes.length + ' in its code' + (p.roles.report ? ', read from the report ' + p.roles.report : '') : (p.roles.report ? 'read from the report ' + p.roles.report : 'none found in its code'));
      add('BI Publisher reports', p.bip ? 'through ' + p.bip.endpoint : '');
      add('Components', (p.components || []).map((c) => c.pack + ' ' + c.version + (c.from === 'cdn' ? ' (Oracle\'s CDN)' : ' (Component Exchange)')).join(' · '));
      return out;
    }
    appBackends(x) {
      const p = x && x.profile;
      if (!p || p.kind !== 'app') return [];
      const has = !!(x.login && x.login.has);
      return ((p.services && p.services.backends) || []).map((b) => ({ name: b.name, where: b.level === 'project' ? 'project' : 'in ' + b.level, host: b.host || '—',
        auth: !b.usesLogin ? 'no login' : (b.auth === 'basic' ? 'signs in' : 'signs in (' + b.auth + ')'),
        login: !b.usesLogin ? '' : (has ? 'your app\'s login' : 'needs a login'), cls: 'nx-rc-be' + (b.usesLogin && !has ? ' nx-rc-be--need' : '') }));
    }
    appNotes(x) { const p = x && x.profile; return ((p && p.notes) || []).map((n) => ({ text: n.text, cls: 'nx-rc-note nx-rc-note--' + n.level })); }
  }
  return PageModule;
});
