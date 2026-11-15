'use strict';
/**
 * What Build.Rite knows about a VB Studio project: read from its own files, never assumed. Every VB application is
 * different — its folder layout, its Visual Builder version, its service connections and how they sign in, its roles,
 * its Component Exchange components — so everything that builds, runs, tests or changes an app reads this first.
 *
 *   profileOf(folder) → {
 *     ok, folder,                 the folder asked about (a workspace's working folder, or any clone)
 *     root,                       the VB project inside it: the folder holding visual-application.json — the folder
 *                                 itself, or one or two levels down (a repo with the project in a subfolder)
 *     kind,                       'app' (a Visual Builder application: runs on this PC), 'extension' (an App UI
 *                                 extension of Oracle Cloud Applications: runs inside them, not on its own) or 'none'
 *     vb: { source, designer, rootURL },          visual-application.json: source.version (2701 = 27.01), vbcs.dt.version
 *     buildTool: { url, version, source },        the build tool the project asks for (its package.json), else ''
 *     apps: [{ name, type, dir, auth, provider, cdn: [packs on Oracle's CDN] }],   webApps/* and mobileApps/*
 *     services: { catalogs: [{ level, file }], backends: [{ name, level, host, auth, anonymous, credential, forceProxy,
 *                 usesLogin }], connections: [{ name, level, file, backend }] },
 *     logins: [{ credential, backends: [names] }],  the logins the app's backends need (one per VB credential)
 *     bip: { endpoint, service, operation } | null,  the BI Publisher report call (SOAP runReport), whatever it is named
 *     roles: { codes, report },                     lib/appRoles.js
 *     components: [{ pack, version, from: 'cdn'|'exchange', where }],
 *     notes: [{ level: 'info'|'warn', text }]       what to know, in plain words
 *   }
 *   findRoot(folder) → the VB project folder inside it, or ''
 *
 * Read only, plain Node, cheap: kept per folder until a file it reads changes.
 */
const fs = require('fs');
const path = require('path');
const roles = require('./appRoles');

const SKIP = new Set(['node_modules', '.git', 'build', 'build-rite-preview', 'processed', 'dist', '.buildrite-data']);
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch (e) { return null; } };
const list = (d) => { try { return fs.readdirSync(d).sort(); } catch (e) { return []; } };
const hostOf = (u) => { try { return new URL(String(u)).host; } catch (e) { return ''; } };

/** The VB project inside a folder: the folder itself, else the shallowest one or two levels down. */
function findRoot(folder) {
  const f = path.resolve(String(folder || ''));
  if (isFile(path.join(f, 'visual-application.json'))) return f;
  const found = [];
  list(f).forEach((a) => {
    if (SKIP.has(a) || a.charAt(0) === '.') return;
    const d1 = path.join(f, a);
    if (!isDir(d1)) return;
    if (isFile(path.join(d1, 'visual-application.json'))) { found.push(d1); return; }
    list(d1).forEach((b) => {
      if (SKIP.has(b) || b.charAt(0) === '.') return;
      const d2 = path.join(d1, b);
      if (isDir(d2) && isFile(path.join(d2, 'visual-application.json'))) found.push(d2);
    });
  });
  found.sort((x, y) => x.split(path.sep).length - y.split(path.sep).length || x.localeCompare(y));
  return found[0] || '';
}

/** An App UI extension of Oracle Cloud Applications (no visual-application.json; extension files or ui/self|base). */
function looksLikeExtension(folder) {
  const f = path.resolve(String(folder || ''));
  if (list(f).some((n) => /^(vb-)?extension.*\.json$/i.test(n))) return true;
  return isDir(path.join(f, 'ui', 'self')) || isDir(path.join(f, 'ui', 'base')) || isDir(path.join(f, 'App UIs'));
}

/** The build tool a project asks for: its package.json's @oracle/grunt-vb-build (a tarball address or a version). */
function buildToolOf(root, source) {
  const pkg = readJson(path.join(root, 'package.json')) || {};
  const want = String(Object.assign({}, pkg.dependencies, pkg.devDependencies)['@oracle/grunt-vb-build'] || '');
  const m = /grunt-vb-build-(\d+\.\d+\.\d+)\.t(?:ar\.)?gz/.exec(want) || /^[~^]?(\d+\.\d+\.\d+)$/.exec(want);
  return { url: /^https?:\/\//.test(want) ? want : '', version: m ? m[1] : '', source: String(source || '') };
}

/** A catalog's backends: how each signs in, from its x-vb block (never a secret: the VB credential is a reference). */
function backendsOf(cat, level) {
  const out = [];
  Object.keys((cat && cat.backends) || {}).sort().forEach((name) => {
    const b = cat.backends[name] || {};
    const s = (b.servers || [])[0] || {};
    const xvb = s['x-vb'] || {};
    const a = xvb.authentication || {};
    const authed = a.authenticated || null;
    const anon = a.anonymous || null;
    const auth = authed ? String(authed.type || 'unknown') : (xvb.anonymousAccess ? 'none' : (anon ? 'anonymous:' + String(anon.type || '') : 'none'));
    out.push({ name, level, host: hostOf(s.url), auth, anonymous: anon ? String(anon.type || '') : '',
      credential: authed && authed.credentials ? String(authed.credentials) : '', forceProxy: String(xvb.forceProxy || ''),
      usesLogin: !!(authed && /^(basic|oauth2?_?.*|as_authenticated_user)$/i.test(String(authed.type || ''))) });
  });
  return out;
}

/** The service connections in a services/ folder: their openapi3.json and the backend each one calls. */
function connectionsOf(dir, level) {
  return list(dir).filter((n) => isFile(path.join(dir, n, 'openapi3.json'))).map((n) => {
    const file = path.join(dir, n, 'openapi3.json');
    const j = readJson(file) || {};
    const url = String(((j.servers || [])[0] || {}).url || '');
    const m = /^vb-catalog:\/\/backends\/([^/]+)/.exec(url);
    return { name: n, level, file, backend: m ? decodeURIComponent(m[1]) : '', json: j };
  });
}

/** The BI Publisher report call: the SOAP runReport operation (…/xmlpserver/services/ExternalReportWSSService). */
function bipOf(connections) {
  for (const c of connections) {
    const paths = (c.json && c.json.paths) || {};
    for (const p of Object.keys(paths)) {
      for (const verb of Object.keys(paths[p] || {})) {
        const op = paths[p][verb] || {};
        const id = String(op.operationId || '');
        if (/xmlpserver|ExternalReport/i.test(p) || /run.*report/i.test(id)) {
          return { endpoint: c.name + '/' + (id || verb), service: c.name, operation: id || verb };
        }
      }
    }
  }
  return null;
}

/** Component Exchange packs a project or app lists (settings/dependencies.json), and whether Oracle's CDN serves each. */
function componentsOf(root, apps) {
  const cdn = new Set();
  apps.forEach((a) => (a.cdn || []).forEach((p) => cdn.add(p)));
  const out = [];
  const read = (file, where) => {
    const deps = ((readJson(file) || {})['component-dependencies']) || {};
    Object.keys(deps).sort().forEach((pack) => {
      out.push({ pack, version: String((deps[pack] || {}).version || ''), from: cdn.has(pack) ? 'cdn' : 'exchange', where });
    });
  };
  read(path.join(root, 'settings', 'dependencies.json'), 'project');
  apps.forEach((a) => read(path.join(a.dir, 'settings', 'dependencies.json'), a.name));
  return out;
}

let cache = { key: '', value: null };
/** What decides the answer: the files read, with their size and time. */
function keyOf(root) {
  const files = [path.join(root, 'visual-application.json'), path.join(root, 'package.json'), path.join(root, 'services', 'catalog.json'),
    path.join(root, 'settings', 'dependencies.json')];
  ['webApps', 'mobileApps'].forEach((t) => list(path.join(root, t)).forEach((a) => {
    files.push(path.join(root, t, a, 'app-flow.json'), path.join(root, t, a, 'services', 'catalog.json'), path.join(root, t, a, 'settings', 'dependencies.json'));
  }));
  list(path.join(root, 'services')).forEach((n) => files.push(path.join(root, 'services', n, 'openapi3.json')));
  return root + '|' + files.map((f) => { try { const s = fs.statSync(f); return s.size + ':' + Math.floor(s.mtimeMs); } catch (e) { return '-'; } }).join(',');
}

function profileOf(folder, opts) {
  const asked = path.resolve(String(folder || ''));
  if (opts && opts.fresh) cache = { key: '', value: null };
  if (!isDir(asked)) return { ok: false, folder: asked, error: 'No such folder: ' + asked };
  const root = findRoot(asked);
  if (!root) {
    const ext = looksLikeExtension(asked);
    return { ok: true, folder: asked, root: '', kind: ext ? 'extension' : 'none', vb: {}, buildTool: {}, apps: [], services: { catalogs: [], backends: [], connections: [] },
      logins: [], bip: null, roles: { codes: [], report: '' }, components: [],
      notes: [ext
        ? { level: 'warn', text: 'An App UI extension of Oracle Cloud Applications: it runs inside them, not on its own. Build.Rite can read and change its code; run it in VB Studio.' }
        : { level: 'warn', text: 'No Visual Builder project here (no visual-application.json in this folder or two levels down).' }] };
  }
  const key = keyOf(root);
  if (cache.key === key && cache.value && cache.value.folder === asked) return cache.value;

  const va = readJson(path.join(root, 'visual-application.json')) || {};
  const vb = { source: String(va['source.version'] || ''), designer: String(va['vbcs.dt.version'] || ''), rootURL: String(va.rootURL || '') };
  const apps = [];
  [['webApps', 'web'], ['mobileApps', 'mobile']].forEach(([t, type]) => list(path.join(root, t)).forEach((name) => {
    const dir = path.join(root, t, name);
    const flow = readJson(path.join(dir, 'app-flow.json'));
    if (!flow) return;
    const paths = ((flow.requirejs || {}).paths) || {};
    const cdn = Object.keys(paths).filter((k) => /^https?:\/\//.test(String(paths[k])));
    const access = ((flow.security || {}).access) || {};
    apps.push({ name, type, dir, auth: access.requiresAuthentication === false ? 'anonymous allowed' : 'signed-in users',
      provider: String(((flow.userConfig || {}).type) || 'vb/DefaultSecurityProvider'), cdn });
  }));

  const catalogs = [];
  const backends = [];
  const connections = [];
  const projCat = path.join(root, 'services', 'catalog.json');
  if (isFile(projCat)) { catalogs.push({ level: 'project', file: projCat }); backendsOf(readJson(projCat), 'project').forEach((b) => backends.push(b)); }
  connectionsOf(path.join(root, 'services'), 'project').forEach((c) => connections.push(c));
  apps.forEach((a) => {
    const f = path.join(a.dir, 'services', 'catalog.json');
    if (isFile(f)) { catalogs.push({ level: a.name, file: f }); backendsOf(readJson(f), a.name).forEach((b) => backends.push(b)); }
    connectionsOf(path.join(a.dir, 'services'), a.name).forEach((c) => connections.push(c));
  });
  // the logins the app needs: one per VB credential its signed-in backends use (several backends may share one)
  const byCred = {};
  backends.filter((b) => b.usesLogin).forEach((b) => {
    const k = b.credential || ('(' + b.name + ')');
    (byCred[k] = byCred[k] || []).push(b.name);
  });
  const logins = Object.keys(byCred).sort().map((credential) => ({ credential, backends: byCred[credential] }));
  const bip = bipOf(connections);
  let r = { roles: [], report: '' };
  try { r = roles.rolesIn(root); } catch (e) { r = { roles: [], report: '' }; }
  const components = componentsOf(root, apps);
  const buildTool = buildToolOf(root, vb.source);

  const notes = [];
  const say = (level, text) => notes.push({ level, text });
  if (root !== asked) say('info', 'The VB project is in a subfolder: ' + path.relative(asked, root).split(path.sep).join('/') + '.');
  if (!apps.length) say('warn', 'No app in it (webApps/<app>/app-flow.json).');
  say('info', 'Visual Builder ' + (vb.source || '?') + (buildTool.version ? '; its build tool: ' + buildTool.version : '; its package.json names no build tool version'));
  if (!catalogs.length) say('warn', 'No services/catalog.json: the app\'s service calls have nowhere to go.');
  if (catalogs.some((c) => c.level !== 'project')) say('info', 'Service connections inside the app too (' + catalogs.filter((c) => c.level !== 'project').map((c) => c.level).join(', ') + ').');
  if (logins.length) say('info', 'Its backends sign in with ' + logins.length + ' login' + (logins.length === 1 ? '' : 's') + ': ' + logins.map((l) => l.backends.join(' + ')).join('; ') + '.');
  const odd = backends.filter((b) => b.usesLogin && !/^basic$/i.test(b.auth));
  if (odd.length) say('warn', odd.map((b) => b.name + ' (' + b.auth + ')').join(', ') + ': signs in a way Build.Rite stands in for with a user name and password; check its calls.');
  if (r.report) say('info', 'Its users\' roles come from the BI Publisher report ' + r.report + '.');
  if (r.roles && r.roles.length) say('info', (r.roles.length === 1 ? 'One role' : r.roles.length + ' roles') + ' found in its code: ' + r.roles.slice(0, 12).join(', ') + (r.roles.length > 12 ? '…' : '') + '.');
  const exch = components.filter((c) => c.from === 'exchange');
  if (exch.length) say('warn', 'Component Exchange components not on Oracle\'s CDN: ' + exch.map((c) => c.pack).join(', ') + ' — they need the exchange to build.');

  const value = { ok: true, folder: asked, root, kind: 'app', vb, buildTool, apps,
    services: { catalogs, backends, connections: connections.map((c) => ({ name: c.name, level: c.level, file: c.file, backend: c.backend })) },
    logins, bip, roles: { codes: r.roles || [], report: r.report || '' }, components, notes };
  cache = { key, value };
  return value;
}

module.exports = { profileOf, findRoot, looksLikeExtension, buildToolOf, backendsOf, bipOf };
