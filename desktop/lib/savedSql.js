'use strict';
/*
 * Build.Rite — the SQL library for the direct SQL worksheet (the "SQL" tool): saved queries, infolets and dashboards,
 * SHARED with the team on the data branch (lib/dataBranch.js), like the Application pages catalog and the FDD library.
 *
 * One JSON file holds it all: <data>/webApps/buildrite/resources/sql/saved.json
 *   { queries: [ { id, name, sql, description, folder, conn, by, createdAt, updatedAt, runs, lastRun } ],
 *     infolets:   [ … ],   // phase 2
 *     dashboards: [ … ] }  // phase 2
 * Records carry the connection name they were written against (`conn`), so the UI can show "this connection's" queries;
 * the file is one per project so the whole team sees the same library.
 *
 *   open({ root, data, gitPath, git, now }) → store
 *     listQueries() / getQuery(id) / saveQuery(input, by) / removeQuery(id) / ranQuery(id)
 *     gitStatus()  → { available, branch, upstream, pending, unpushed, reason }   (the data branch's state)
 *     gitSave({ message, push })  → commits + pushes the library on the data branch
 *     info()       → { shared, dir, branch, reason }
 *   mergeSaved(oursText, theirsText)  → merged JSON text (by id, newest updatedAt wins) — used by dataBranch.resolve
 *
 * Writes are immediate (to the worktree / project folder); committing + pushing is a separate, explicit step (a route
 * passes commit/push), so "saved" (on this PC) and "shared" (on the branch) are two states, as for FDD and pages.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gitPaths = require('./gitPaths');

const RES_DIR = 'webApps/buildrite/resources/sql';
const FILE = 'saved.json';
const KINDS = ['queries', 'infolets', 'dashboards'];

const str = (v) => (v == null ? '' : String(v));
const cut = (v, n) => str(v).slice(0, n);
const emptyLib = () => ({ queries: [], infolets: [], dashboards: [] });

/** Merge two saved.json texts: union by record id within each list, the newest `updatedAt` winning (concurrent edits). */
function mergeSaved(ours, theirs) {
  try {
    const a = JSON.parse(ours) || {};
    const b = JSON.parse(theirs) || {};
    const out = emptyLib();
    KINDS.forEach((k) => {
      const by = {};
      (Array.isArray(a[k]) ? a[k] : []).forEach((r) => { if (r && r.id) by[r.id] = r; });
      (Array.isArray(b[k]) ? b[k] : []).forEach((r) => { if (r && r.id) { const cur = by[r.id]; if (!cur || str(r.updatedAt) >= str(cur.updatedAt)) by[r.id] = r; } });
      out[k] = Object.keys(by).map((id) => by[id]);
    });
    return JSON.stringify(out, null, 1) + '\n';
  } catch (e) { return null; }
}

function open(opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now : () => new Date();
  const data = o.data && o.data.ok ? o.data : null;          // the data branch when there is one, else the project folder
  const root = data ? data.dir : path.resolve(o.root || path.join(__dirname, '..', '..'));
  const resDir = path.join(root, RES_DIR);
  const file = path.join(resDir, FILE);
  const repo = gitPaths.create({ root: root, paths: [RES_DIR], git: o.git, gitPath: o.gitPath,
    message: 'SQL library: update', sync: data ? { resolve: data.resolve, after: data.merged } : null });

  function read() { try { return Object.assign(emptyLib(), JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { return emptyLib(); } }
  function write(d) { fs.mkdirSync(resDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(d, null, 1) + '\n'); }
  const newId = () => crypto.randomBytes(6).toString('hex');

  function slimQuery(q) {
    return { id: q.id, name: q.name, description: q.description || '', folder: q.folder || '', conn: q.conn || '',
      by: q.by || '', createdAt: q.createdAt || '', updatedAt: q.updatedAt || '', runs: q.runs || 0, lastRun: q.lastRun || '', hasSql: !!q.sql };
  }
  /** Saved queries, newest first, slimmed for a list (no SQL body). Pass `conn` to keep only that connection's. */
  function listQueries(conn) {
    const c = conn == null ? null : str(conn);
    return read().queries
      .filter((q) => c == null || str(q.conn) === c)
      .sort((a, b) => str(b.updatedAt).localeCompare(str(a.updatedAt)))
      .map(slimQuery);
  }
  function getQuery(id) { return read().queries.filter((q) => q.id === str(id))[0] || null; }
  function saveQuery(input, by) {
    const i = input || {};
    const name = cut(i.name, 120).trim();
    const sql = cut(i.sql, 40000).trim();
    if (!name) return { ok: false, error: 'Give the query a name.' };
    if (!sql) return { ok: false, error: 'There is no SQL to save.' };
    const d = read();
    const at = now().toISOString();
    const conn = cut(i.conn, 120);
    let rec = d.queries.filter((q) => (i.id && q.id === i.id) || (str(q.name).toLowerCase() === name.toLowerCase() && str(q.conn) === conn))[0];
    if (!rec) { rec = { id: newId(), createdAt: at, runs: 0 }; d.queries.push(rec); }
    Object.assign(rec, { name: name, sql: sql, description: cut(i.description, 2000), folder: cut(i.folder, 60).trim(), conn: conn, by: str(by) || cut(i.by, 120), updatedAt: at });
    write(d);
    return { ok: true, query: rec };
  }
  function removeQuery(id) {
    const d = read();
    const n = d.queries.length;
    d.queries = d.queries.filter((q) => q.id !== str(id));
    if (d.queries.length === n) return { ok: false, error: 'No such query.' };
    write(d);
    return { ok: true };
  }
  function ranQuery(id) {
    const d = read();
    const q = d.queries.filter((x) => x.id === str(id))[0];
    if (!q) return { ok: false };
    q.runs = (q.runs || 0) + 1; q.lastRun = now().toISOString();
    write(d);
    return { ok: true };
  }

  return {
    info: () => ({ shared: !!data, dir: resDir, branch: data ? data.branch : '', reason: data ? data.reason : '' }),
    listQueries: listQueries, getQuery: getQuery, saveQuery: saveQuery, removeQuery: removeQuery, ranQuery: ranQuery,
    gitStatus: () => repo.status(),
    gitSave: (b) => repo.save(b || {}),
    root: root,
  };
}

module.exports = { open: open, mergeSaved: mergeSaved, RES_DIR: RES_DIR, FILE: FILE, KINDS: KINDS };
