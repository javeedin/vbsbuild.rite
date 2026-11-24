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
  const rb = store.saveQuery({ name: 'By request', sql: 'select * from er where num = :request_number', conn: 'PRODDB', binds: { request_number: '10086' } }, 'rite.user');
  T.check('bind values are saved with the query and come back on get', rb.ok && store.getQuery(rb.query.id).binds.request_number === '10086');
  store.removeQuery(rb.query.id); // keep the later counts clean

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

  T.section('infolets (a named chart = its own SQL + a spec)');
  clock = new Date('2026-11-24T12:00:00Z');
  const inf = store.saveInfolet({ name: 'Orders by region', sql: 'select region, orders from v', conn: 'PRODDB', spec: { kind: 'bar', label: 'REGION', value: 'ORDERS' }, description: 'bar chart' }, 'rite.user');
  T.check('saved with an id, spec and sql', inf.ok && inf.infolet.id && inf.infolet.spec.kind === 'bar' && inf.infolet.by === 'rite.user', JSON.stringify(inf));
  T.check('a name and SQL are required', !store.saveInfolet({ sql: 'x' }).ok && !store.saveInfolet({ name: 'x' }).ok);
  T.check('list is slim (kind, no SQL body) and get has the SQL + spec', (() => { const l = store.listInfolets(); return l.length === 1 && l[0].kind === 'bar' && l[0].hasSql === true && l[0].sql === undefined && store.getInfolet(inf.infolet.id).sql === 'select region, orders from v'; })());
  clock = new Date('2026-11-24T12:05:00Z');
  const inf2 = store.saveInfolet({ name: 'Orders by region', sql: 'select region, count(*) from v group by region', spec: { kind: 'pie' } }, 'rite.user');
  T.check('same name updates in place (spec + sql replaced)', inf2.ok && inf2.infolet.id === inf.infolet.id && inf2.infolet.spec.kind === 'pie' && store.listInfolets().length === 1);
  const inf3 = store.saveInfolet({ name: 'Monthly total', sql: 'select to_char(d,\'YYYY-MM\') m, sum(a) from t group by 1', spec: { kind: 'line' } }, 'rite.user');

  T.section('dashboards (an ordered set of infolets, each with a width)');
  clock = new Date('2026-11-24T12:10:00Z');
  const db = store.saveDashboard({ name: 'Ops overview', description: 'the daily picture', layout: [{ infoletId: inf.infolet.id, w: 6 }, { infoletId: inf3.infolet.id, w: 20 }] }, 'rite.user');
  T.check('saved with an id; widths clamped to 1..12', db.ok && db.dashboard.id && db.dashboard.layout.length === 2 && db.dashboard.layout[0].w === 6 && db.dashboard.layout[1].w === 12, JSON.stringify(db.dashboard.layout));
  T.check('a name is required', !store.saveDashboard({}).ok);
  T.check('list is slim with a slot count', (() => { const l = store.listDashboards(); return l.length === 1 && l[0].count === 2 && l[0].name === 'Ops overview'; })());
  T.check('dashboardWith resolves each slot to its full infolet in order', (() => { const w = store.dashboardWith(db.dashboard.id); return w && w.slots.length === 2 && w.slots[0].infolet.id === inf.infolet.id && w.slots[0].w === 6 && w.slots[1].infolet.sql.indexOf('group by 1') !== -1; })());
  T.check('removing an infolet drops it from dashboards', (() => { store.removeInfolet(inf3.infolet.id); const w = store.dashboardWith(db.dashboard.id); return w.slots.length === 1 && w.slots[0].infolet.id === inf.infolet.id; })());
  T.check('remove a dashboard; a second remove says no such dashboard', store.removeDashboard(db.dashboard.id).ok && store.listDashboards().length === 0 && !store.removeDashboard(db.dashboard.id).ok);

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
