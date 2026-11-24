#!/usr/bin/env node
'use strict';
/*
 * The SQL library store (desktop/lib/savedSql.js): saved queries kept in one JSON (shared on the data branch in the app),
 * create/update (dedupe by name+connection), list (newest first, slimmed, filter by connection), get, remove, ran, and the
 * mergeSaved() used by the data branch to merge two people's edits (by record id, newest updatedAt wins).
 * Run: node tests/saved-sql.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const S = require('../desktop/lib/savedSql');

const T = H.makeAsserter();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-sqllib-'));
let clock = new Date('2026-11-24T10:00:00Z');
const store = S.open({ root: dir, now: () => clock });

try {
  T.section('save a query');
  const r = store.saveQuery({ name: 'Equipment master', sql: 'select * from eqr_equipment_master', conn: 'PRODDB', description: 'the base table' }, 'rite.user');
  T.check('saved with an id, name, sql, conn, by, timestamps', r.ok && r.query.id && r.query.name === 'Equipment master' && r.query.conn === 'PRODDB' && r.query.by === 'rite.user' && r.query.createdAt === clock.toISOString() && r.query.runs === 0, JSON.stringify(r));
  T.check('a name is required, and SQL is required', !store.saveQuery({ sql: 'x' }, 'u').ok && !store.saveQuery({ name: 'x' }, 'u').ok);

  T.section('update (dedupe by name + connection) vs a new one on a different connection');
  clock = new Date('2026-11-24T10:05:00Z');
  const r2 = store.saveQuery({ name: 'Equipment master', sql: 'select 1 from dual', conn: 'PRODDB' }, 'rite.user');
  T.check('same name + connection updates in place (same id), updatedAt bumped', r2.ok && r2.query.id === r.query.id && r2.query.sql === 'select 1 from dual' && r2.query.updatedAt === clock.toISOString() && r2.query.createdAt === r.query.createdAt);
  clock = new Date('2026-11-24T10:06:00Z');
  const r3 = store.saveQuery({ name: 'Equipment master', sql: 'select 2 from dual', conn: 'TEST' }, 'rite.user');
  T.check('the same name on another connection is a new record', r3.ok && r3.query.id !== r.query.id);

  T.section('list (newest first, slim, by connection)');
  const all = store.listQueries();
  T.check('lists both, newest updated first, no SQL body in the list', all.length === 2 && all[0].id === r3.query.id && all[0].hasSql === true && all[0].sql === undefined);
  T.check('filter by connection', store.listQueries('PRODDB').length === 1 && store.listQueries('PRODDB')[0].id === r.query.id && store.listQueries('NOPE').length === 0);

  T.section('get, ran, remove');
  T.check('get returns the full record with its SQL', store.getQuery(r.query.id).sql === 'select 1 from dual');
  clock = new Date('2026-11-24T11:00:00Z');
  store.ranQuery(r.query.id); store.ranQuery(r.query.id);
  const got = store.getQuery(r.query.id);
  T.check('ran bumps runs and stamps lastRun', got.runs === 2 && got.lastRun === clock.toISOString());
  T.check('remove deletes it; a second remove says no such query', store.removeQuery(r.query.id).ok && store.listQueries().length === 1 && !store.removeQuery(r.query.id).ok);

  T.section('it survives a reopen (same JSON file)');
  const store2 = S.open({ root: dir, now: () => clock });
  T.check('reopened store reads the kept query', store2.listQueries().length === 1 && store2.getQuery(r3.query.id).sql === 'select 2 from dual');

  T.section('mergeSaved: two people editing at once (by id, newest updatedAt wins)');
  const ours = JSON.stringify({ queries: [
    { id: 'a', name: 'A', sql: 'ours a', updatedAt: '2026-11-24T10:00:00Z' },
    { id: 'b', name: 'B', sql: 'only ours', updatedAt: '2026-11-24T09:00:00Z' }] });
  const theirs = JSON.stringify({ queries: [
    { id: 'a', name: 'A', sql: 'theirs a NEWER', updatedAt: '2026-11-24T12:00:00Z' },
    { id: 'c', name: 'C', sql: 'only theirs', updatedAt: '2026-11-24T08:00:00Z' }] });
  const merged = JSON.parse(S.mergeSaved(ours, theirs));
  const byId = {}; merged.queries.forEach((q) => { byId[q.id] = q; });
  T.check('union of both, the newer edit of a shared id winning', merged.queries.length === 3 && byId.a.sql === 'theirs a NEWER' && byId.b.sql === 'only ours' && byId.c.sql === 'only theirs');
  T.check('mergeSaved returns null on bad JSON (no throw)', S.mergeSaved('{', '{') === null);
} catch (e) {
  T.check('no exception: ' + (e && e.stack), false);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
T.report();
