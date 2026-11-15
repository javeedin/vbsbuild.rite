'use strict';
/**
 * What a VB app's own code says about the roles of the user it runs for — so Build.Rite knows the app it runs (Run as,
 * the Run console's `roles`, the no-access check) instead of a list written in for one app.
 *
 *   rolesIn(folder, app?)        → { roles: [codes, sorted], from: [files they were found in], report }
 *       folder: a VB project (with webApps/) or the app's own folder; app: one app (webApps/<app>), else every app.
 *       Role codes: role-like codes (RT_ADMINISTRATOR, XX_MANAGER_JOB…) written in the app's .js/.json/.html files on a
 *       line that speaks of roles (role, roles, hasRole, userRoles, ROLE…) — as a string or an object's key — and
 *       every code in a "roles": [...] list of app-flow.json (its security / userConfig).
 *   rolesReportIn(folder, app?)  → the BI Publisher report the app reads its user's roles from ('/Custom/…/X_RP.xdo'): a
 *       '.xdo' path written in the app, named for roles or within a few lines of code that speaks of roles; '' if none.
 *   validRole(code)              → whether the code looks like a role code
 *
 * Plain Node, read only, cheap: the answer is kept per folder + app until a file there changes (newest mtime).
 */
const fs = require('fs');
const path = require('path');

const CODE = /^[A-Z][A-Z0-9_]{3,}$/;
const validRole = (code) => CODE.test(String(code || '')) && String(code).length <= 80;

// Words written like codes on role lines that are not roles: access levels, HTTP and JS words, the code's own constants.
const NOT_ROLES = new Set(['FULL', 'READ_ONLY', 'READONLY', 'NONE', 'TRUE', 'FALSE', 'NULL', 'POST', 'GET', 'PUT', 'PATCH', 'DELETE',
  'JSON', 'HTML', 'TEXT', 'DATA', 'ROLE', 'ROLES', 'USER', 'USERS', 'NOTE', 'TODO', 'FIXME', 'ERROR', 'WARN', 'INFO', 'DEBUG',
  'ROLES_RP', 'DATA_DS', 'G_1', 'ROLE_NAME', 'ROLE_CODE', 'ROLE_ID', 'USERNAME', 'USER_NAME', 'PERSON_ID', 'SESSION_ROLE',
  'ACTIVE', 'INACTIVE', 'ENABLED', 'DISABLED', 'YES', 'NO', 'LOADING', 'LOADED', 'XDO_PATH', 'BIP', 'SOAP', 'REST', 'HTTP', 'HTTPS']);
// Codes named like columns, settings or constants (ORACLE_ROLE_NAME, ROLE_CONFIG, X_ENABLED…), not roles.
const NOT_ROLE_PARTS = /(^|_)(NAME|DISPLAY|CODE|ID|IDS|CONFIG|ENABLED|DISABLED|DURATION|PERIOD|DS|RP|URL|KEY|MAP|LIST|TYPE|DATE|STATUS|COUNT|PATH|LABEL|MODULE|FLAG|SETTING|SETTINGS)(_|$)|(^|_)ROLE(_|$)/;
const ROLE_LINE = /\brole|roles\b|hasRole|userRoles|_ROLE|ROLE_/i;
const SKIP_DIRS = new Set(['node_modules', 'build', '.git', 'processed', 'dist']);

function appsOf(folder) {
  const web = path.join(folder, 'webApps');
  try {
    return fs.readdirSync(web).filter((n) => { try { return fs.statSync(path.join(web, n, 'app-flow.json')).isFile(); } catch (e) { return false; } })
      .map((n) => path.join(web, n));
  } catch (e) { /* not a project: maybe the app's own folder */ }
  try { if (fs.statSync(path.join(folder, 'app-flow.json')).isFile()) return [folder]; } catch (e) { /* no app */ }
  return [];
}

/** Every .js/.json/.html file of the app folders, with the newest mtime among them. */
function filesOf(dirs) {
  const out = [];
  let newest = 0;
  const walk = (d) => {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    names.forEach((e) => {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && e.name[0] !== '.') walk(path.join(d, e.name)); return; }
      if (!/\.(js|json|html)$/i.test(e.name) || /\.min\.js$/i.test(e.name)) return;
      const p = path.join(d, e.name);
      try { const st = fs.statSync(p); if (st.size > 2 * 1024 * 1024) return; newest = Math.max(newest, st.mtimeMs); out.push(p); } catch (e2) { /* gone */ }
    });
  };
  dirs.forEach(walk);
  return { files: out, newest: newest };
}

/** The role codes on one line: string literals and object keys that look like codes. */
function codesOnLine(line) {
  const out = [];
  const lit = /(['"`])([A-Z][A-Z0-9_]{3,})\1/g;
  let m;
  while ((m = lit.exec(line))) out.push(m[2]);
  const key = /(?:^|[{,\s])([A-Z][A-Z0-9_]{3,})\s*:/g;
  while ((m = key.exec(line))) out.push(m[1]);
  // (a BI Publisher report's parameters, P_…, are named beside the roles report but are not roles)
  return out.filter((c) => validRole(c) && !NOT_ROLES.has(c) && /_/.test(c) && !/_$/.test(c) && !/^P_/.test(c) && !NOT_ROLE_PARTS.test(c));
}

/** "roles": [...] lists in app-flow.json's security and userConfig. */
function flowRoles(appDir) {
  const out = [];
  let j = null;
  try { j = JSON.parse(fs.readFileSync(path.join(appDir, 'app-flow.json'), 'utf8')); } catch (e) { return out; }
  const walk = (x) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    Object.keys(x).forEach((k) => {
      if (/^roles?$/i.test(k) && Array.isArray(x[k])) x[k].forEach((r) => { if (typeof r === 'string' && validRole(r)) out.push(r); });
      else walk(x[k]);
    });
  };
  walk(j && j.security);
  walk(j && j.userConfig);
  return out;
}

const cache = new Map();
function scan(folder, app) {
  const root = path.resolve(String(folder || '.'));
  let dirs = appsOf(root);
  if (app) dirs = dirs.filter((d) => path.basename(d) === String(app));
  const key = root + '|' + (app || '');
  const { files, newest } = filesOf(dirs);
  const kept = cache.get(key);
  if (kept && kept.newest === newest && kept.n === files.length) return kept.value;

  const roles = new Set();
  const from = new Set();
  const reports = [];
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  dirs.forEach((d) => flowRoles(d).forEach((r) => { roles.add(r); from.add(rel(path.join(d, 'app-flow.json'))); }));
  files.forEach((p) => {
    let text = '';
    try { text = fs.readFileSync(p, 'utf8'); } catch (e) { return; }
    const roleFile = /role/i.test(path.basename(p));
    if (!ROLE_LINE.test(text) && !/\.xdo/i.test(text)) return;
    const lines = text.split(/\r?\n/);
    const roleAt = [];
    lines.forEach((line, i) => {
      if (!ROLE_LINE.test(line)) return;
      roleAt.push(i);
      const codes = codesOnLine(line);
      if (codes.length) { codes.forEach((c) => roles.add(c)); from.add(rel(p)); }
    });
    if (/\.xdo/i.test(text)) {
      const xdo = /(['"`])(\/[^'"`\s]+\.xdo)\1/g;
      lines.forEach((line, i) => {
        let m;
        xdo.lastIndex = 0;
        while ((m = xdo.exec(line))) {
          const named = /role/i.test(path.posix.basename(m[2]));
          const near = roleAt.some((r) => Math.abs(r - i) <= 5);
          if (named || near) reports.push({ path: m[2], score: (named ? 4 : 0) + (near ? 2 : 0) + (roleFile ? 1 : 0), file: rel(p) });
        }
      });
    }
  });
  reports.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const value = { roles: Array.from(roles).sort(), from: Array.from(from).sort(), report: reports.length ? reports[0].path : '' };
  cache.set(key, { newest: newest, n: files.length, value: value });
  return value;
}

function rolesIn(folder, app) {
  const v = scan(folder, app);
  return { roles: v.roles.slice(), from: v.from.slice(), report: v.report };
}
function rolesReportIn(folder, app) { return scan(folder, app).report; }

module.exports = { rolesIn, rolesReportIn, validRole };
