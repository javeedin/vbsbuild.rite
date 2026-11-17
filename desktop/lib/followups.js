'use strict';
/**
 * Saved follow-ups, for Build.Rite's Follow-ups page: a follow-up drafted from the Jira pages ("Copy to
 * follow-up") kept in DuckDB in this app's data folder (followups.duckdb). Each follow-up has a header (title, the
 * sprint/scope, subject, recipients, the message and sign-off, when it was made) and detail lines (the stories it
 * covers: key, summary, status, assignee, sprint, due, customer, link).
 *
 * Real DuckDB tables you can query:
 *   - followups       (id, created_at, updated_at, kind, title, subtitle, subject, to_addr, message, signoff, sprint_name, source, author)
 *   - followup_lines  (id, followup_id, seq, story_key, summary, status, assignee, sprint, due, overdue, customer, url)
 * When DuckDB cannot load (no binary for this platform), the same store keeps the data in a JSON file beside it.
 *
 *   open({ file }) → store (every method async)
 *   list()           { ok, followups: [summary] } newest first (id, createdAt, updatedAt, kind, title, subtitle,
 *                    subject, to, sprintName, source, author, itemCount)
 *   get(id)          { ok, followup } | { ok:false }
 *   save(followup)   upsert (id + timestamps filled) → { ok, followup }
 *   remove(id)       { ok }
 *
 * The messages the Copy to follow-up dialog offers (Follow-ups › Messages): the ones you added, and your changes to the
 * built-in ones (the built-ins themselves live in resources/js/followup.js; a row with a built-in's key is your version
 * of it, or hides it). Real DuckDB table followup_messages (key, seq, label, subject, body, hidden, updated_at, author)
 * and the order in followup_meta (k = 'message_order', v = JSON list of keys).
 *   messages()             { ok, messages: [{ key, label, subject, body, hidden, updatedAt, author }], order: [key] }
 *   saveMessage(m)         upsert by key (a key made from the label when there is none) → { ok, message }
 *   removeMessage(key)     { ok } (a built-in's row gone = back to its default)
 *   setMessageOrder(keys)  { ok, order }
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let duck = null;
try { duck = require('@duckdb/node-api'); } catch (e) { duck = null; }

function rid(prefix) { return prefix + Date.now().toString(36) + crypto.randomBytes(4).toString('hex'); }
function str(v) { return v == null ? '' : String(v); }

function cleanLine(l) {
  l = l || {};
  return {
    id: str(l.id) || rid('fl_'),
    storyKey: str(l.storyKey || l.key).trim().toUpperCase(),
    summary: str(l.summary),
    status: str(l.status),
    assignee: str(l.assignee),
    sprint: str(l.sprint),
    due: str(l.due),
    overdue: !!l.overdue,
    customer: Array.isArray(l.customer) ? l.customer.join(', ') : str(l.customer || (Array.isArray(l.labels) ? l.labels.join(', ') : '')),
    url: str(l.url),
  };
}
function cleanFollowup(f) {
  f = f || {};
  return {
    id: str(f.id),
    kind: f.kind === 'stories' ? 'stories' : 'sprint',
    title: str(f.title),
    subtitle: str(f.subtitle),
    subject: str(f.subject),
    to: str(f.to),
    message: str(f.message),
    signoff: str(f.signoff),
    sprintName: str(f.sprintName),
    source: str(f.source),
    author: str(f.author),
    lines: Array.isArray(f.lines) ? f.lines.map(cleanLine) : [],
    createdAt: f.createdAt || null,
    updatedAt: f.updatedAt || null,
  };
}
const MSG_KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
function cleanMessage(m) {
  m = m || {};
  let key = str(m.key).trim();
  if (!MSG_KEY.test(key)) {
    const base = str(m.label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'message';
    key = 'my-' + base + '-' + crypto.randomBytes(2).toString('hex');
  }
  return {
    key,
    label: str(m.label).trim().slice(0, 60) || 'My message',
    subject: str(m.subject).trim().slice(0, 200),
    body: str(m.body).replace(/\r\n/g, '\n').slice(0, 4000),
    hidden: !!m.hidden,
    author: str(m.author).slice(0, 120),
    updatedAt: m.updatedAt || null,
  };
}
const cleanOrder = (keys) => (Array.isArray(keys) ? keys : []).map((k) => str(k).trim()).filter((k) => MSG_KEY.test(k)).filter((k, i, a) => a.indexOf(k) === i).slice(0, 200);

function summaryOf(f) {
  return { id: f.id, createdAt: f.createdAt || null, updatedAt: f.updatedAt || null, kind: f.kind, title: f.title,
    subtitle: f.subtitle, subject: f.subject, to: f.to, sprintName: f.sprintName, source: f.source, author: f.author,
    itemCount: (f.lines || []).length };
}
const byNewest = (a, b) => str(b.updatedAt).localeCompare(str(a.updatedAt)) || str(b.createdAt).localeCompare(str(a.createdAt));

/** The store, backed by real DuckDB tables. */
async function duckStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const instance = await duck.DuckDBInstance.create(file);
  const con = await instance.connect();
  let queue = Promise.resolve();
  const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
  const rows = async (sql, params) => (await con.runAndReadAll(sql, params || [])).getRowObjectsJson();

  await con.run('CREATE TABLE IF NOT EXISTS followups (id VARCHAR PRIMARY KEY, created_at VARCHAR, updated_at VARCHAR, kind VARCHAR, title VARCHAR, subtitle VARCHAR, subject VARCHAR, to_addr VARCHAR, message VARCHAR, signoff VARCHAR, sprint_name VARCHAR, source VARCHAR, author VARCHAR)');
  await con.run('CREATE TABLE IF NOT EXISTS followup_lines (id VARCHAR PRIMARY KEY, followup_id VARCHAR, seq INTEGER, story_key VARCHAR, summary VARCHAR, status VARCHAR, assignee VARCHAR, sprint VARCHAR, due VARCHAR, overdue BOOLEAN, customer VARCHAR, url VARCHAR)');

  await con.run('CREATE TABLE IF NOT EXISTS followup_messages (key VARCHAR PRIMARY KEY, seq INTEGER, label VARCHAR, subject VARCHAR, body VARCHAR, hidden BOOLEAN, updated_at VARCHAR, author VARCHAR)');
  await con.run('CREATE TABLE IF NOT EXISTS followup_meta (k VARCHAR PRIMARY KEY, v VARCHAR)');
  const msgOf = (r) => ({ key: str(r.key), label: str(r.label), subject: str(r.subject), body: str(r.body), hidden: !!r.hidden, updatedAt: r.updated_at || null, author: str(r.author) });
  const orderNow = async () => { const r = await rows("SELECT v FROM followup_meta WHERE k = 'message_order'"); try { return r.length ? cleanOrder(JSON.parse(r[0].v)) : []; } catch (e) { return []; } };

  function lineToObj(r) {
    return { id: r.id, storyKey: str(r.story_key), summary: str(r.summary), status: str(r.status), assignee: str(r.assignee),
      sprint: str(r.sprint), due: str(r.due), overdue: !!r.overdue, customer: str(r.customer), url: str(r.url) };
  }
  function headToObj(r, lineRows) {
    return { id: r.id, createdAt: r.created_at || null, updatedAt: r.updated_at || null, kind: str(r.kind) || 'sprint',
      title: str(r.title), subtitle: str(r.subtitle), subject: str(r.subject), to: str(r.to_addr), message: str(r.message),
      signoff: str(r.signoff), sprintName: str(r.sprint_name), source: str(r.source), author: str(r.author),
      lines: (lineRows || []).map(lineToObj) };
  }

  return {
    engine: 'duckdb',
    list: () => serial(async () => {
      const hs = await rows('SELECT * FROM followups');
      const ls = await rows('SELECT * FROM followup_lines ORDER BY seq');
      const byF = {};
      ls.forEach((l) => { (byF[l.followup_id] = byF[l.followup_id] || []).push(l); });
      const out = hs.map((r) => summaryOf(headToObj(r, byF[r.id] || []))).sort(byNewest);
      return { ok: true, followups: out };
    }),
    get: (id) => serial(async () => {
      const hr = await rows('SELECT * FROM followups WHERE id = $1', [str(id)]);
      if (!hr.length) return { ok: false };
      const lr = await rows('SELECT * FROM followup_lines WHERE followup_id = $1 ORDER BY seq', [str(id)]);
      return { ok: true, followup: headToObj(hr[0], lr) };
    }),
    save: (b) => serial(async () => {
      const f = cleanFollowup(b);
      const now = new Date().toISOString();
      let created = now;
      if (f.id) { const ex = await rows('SELECT created_at FROM followups WHERE id = $1', [f.id]); created = ex.length ? (ex[0].created_at || f.createdAt || now) : (f.createdAt || now); }
      else f.id = rid('f_');
      f.createdAt = created; f.updatedAt = now;
      await con.run('BEGIN TRANSACTION');
      try {
        await con.run('INSERT OR REPLACE INTO followups VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
          [f.id, f.createdAt, f.updatedAt, f.kind, f.title, f.subtitle, f.subject, f.to, f.message, f.signoff, f.sprintName, f.source, f.author]);
        await con.run('DELETE FROM followup_lines WHERE followup_id = $1', [f.id]);
        for (let i = 0; i < f.lines.length; i++) {
          const l = f.lines[i];
          await con.run('INSERT INTO followup_lines VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
            [l.id, f.id, i, l.storyKey, l.summary, l.status, l.assignee, l.sprint, l.due, l.overdue, l.customer, l.url]);
        }
        await con.run('COMMIT');
      } catch (e) {
        await con.run('ROLLBACK').catch(() => {});
        throw e;
      }
      return { ok: true, followup: f };
    }),
    remove: (id) => serial(async () => {
      await con.run('DELETE FROM followup_lines WHERE followup_id = $1', [str(id)]);
      await con.run('DELETE FROM followups WHERE id = $1', [str(id)]);
      return { ok: true };
    }),
    messages: () => serial(async () => {
      const ms = await rows('SELECT * FROM followup_messages ORDER BY seq, updated_at');
      return { ok: true, messages: ms.map(msgOf), order: await orderNow() };
    }),
    saveMessage: (m) => serial(async () => {
      const c = cleanMessage(m);
      c.updatedAt = new Date().toISOString();
      const ex = await rows('SELECT seq FROM followup_messages WHERE key = $1', [c.key]);
      const seq = ex.length ? Number(ex[0].seq) || 0 : Number(((await rows('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM followup_messages'))[0] || {}).n) || 1;
      await con.run('INSERT OR REPLACE INTO followup_messages VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [c.key, seq, c.label, c.subject, c.body, c.hidden, c.updatedAt, c.author]);
      return { ok: true, message: c };
    }),
    removeMessage: (key) => serial(async () => {
      await con.run('DELETE FROM followup_messages WHERE key = $1', [str(key)]);
      return { ok: true };
    }),
    setMessageOrder: (keys) => serial(async () => {
      const order = cleanOrder(keys);
      await con.run("INSERT OR REPLACE INTO followup_meta VALUES ('message_order', $1)", [JSON.stringify(order)]);
      return { ok: true, order };
    }),
    close: async () => { try { con.closeSync && con.closeSync(); } catch (e) { /* closing */ } try { instance.closeSync && instance.closeSync(); } catch (e) { /* closing */ } },
  };
}

/** The same store kept in a JSON file, used when DuckDB cannot load on this computer. */
function jsonStore(file) {
  let data = { followups: [], messages: [], messageOrder: [] };
  try { const parsed = JSON.parse(fs.readFileSync(file, 'utf8')); if (parsed && Array.isArray(parsed.followups)) data = Object.assign({ messages: [], messageOrder: [] }, parsed); } catch (e) { /* first run */ }
  function write() { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 1), { mode: 0o600 }); }
  return {
    engine: 'json',
    async list() { return { ok: true, followups: data.followups.map(summaryOf).sort(byNewest) }; },
    async get(id) { const f = data.followups.find((x) => x.id === id); return f ? { ok: true, followup: f } : { ok: false }; },
    async save(b) {
      const f = cleanFollowup(b);
      const now = new Date().toISOString();
      const at = f.id ? data.followups.findIndex((x) => x.id === f.id) : -1;
      if (!f.id) f.id = rid('f_');
      f.createdAt = (at === -1 ? (f.createdAt || now) : (data.followups[at].createdAt || now));
      f.updatedAt = now;
      if (at === -1) data.followups.push(f); else data.followups[at] = f;
      write();
      return { ok: true, followup: f };
    },
    async remove(id) { data.followups = data.followups.filter((x) => x.id !== id); write(); return { ok: true }; },
    async messages() { return { ok: true, messages: data.messages.map((m) => Object.assign({}, m)), order: cleanOrder(data.messageOrder) }; },
    async saveMessage(m) {
      const c = cleanMessage(m);
      c.updatedAt = new Date().toISOString();
      const at = data.messages.findIndex((x) => x.key === c.key);
      if (at === -1) data.messages.push(c); else data.messages[at] = c;
      write();
      return { ok: true, message: c };
    },
    async removeMessage(key) { data.messages = data.messages.filter((x) => x.key !== str(key)); write(); return { ok: true }; },
    async setMessageOrder(keys) { data.messageOrder = cleanOrder(keys); write(); return { ok: true, order: data.messageOrder }; },
    async close() {},
  };
}

async function open(o) {
  o = o || {};
  const file = o.file;
  if (!duck) return jsonStore(file.replace(/\.duckdb$/, '') + '.json');
  try { return await duckStore(file); }
  catch (e) { console.warn('[followups] DuckDB could not open', file, e && e.message); return jsonStore(file.replace(/\.duckdb$/, '') + '.json'); }
}

module.exports = { open, available: !!duck };
