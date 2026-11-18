'use strict';
/**
 * Saved flows (Application → Integrations → Saved flows): an integration flow saved under a name — made from a page's
 * flow (resources/js/flowModel.js fromPage) or drawn by hand — then edited, commented on and checked against the app.
 *
 * A flow: id (FL-0001, given on the first save), name, purpose, area, owner, status (draft | review | approved |
 *   retired), story (Jira), tags, app, source { kind page | blank, page, pageLabel, flow, scannedAt }, lanes (its
 *   systems), actions (what sets each off, its steps — each a call of the app or a step added by hand, with its own words
 *   and a note), version (1, 2…), versions (the earlier ones: their lanes and actions, who saved them, the note),
 *   comments [{ id, at, by, text, step, resolved }], history [{ at, by, what, note }], created / updated (+ by).
 *
 *   open({ dir: string | () => string, now }) → store
 *     list(q)  get(id)  save(flow, by, { note, copy })  remove(id)  comment(id, { text, step }, by)
 *     resolve(id, commentId, resolved, by)  uncomment(id, commentId, by)
 * Every save keeps the version before it (the last 30). One JSON file per flow in the folder (the project's).
 */
const fs = require('fs');
const path = require('path');

const STATUSES = { draft: 'Draft', review: 'In review', approved: 'Approved', retired: 'Retired' };
const MAX = { lanes: 40, actions: 200, steps: 800, versions: 30, comments: 500, history: 300 };

const str = (v) => (v === undefined || v === null ? '' : String(v));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const cut = (v, n) => str(v).slice(0, n);
const codeNo = (c) => { const m = /^FL-(\d+)$/.exec(str(c)); return m ? Number(m[1]) : 0; };
const codeOf = (n) => 'FL-' + String(n).padStart(4, '0');
const slug = (id) => str(id).replace(/[^A-Za-z0-9_-]/g, '');
const idOf = (v, n) => cut(str(v).replace(/[^A-Za-z0-9_.:-]/g, ''), n || 60);

/** Its lanes and actions, each field within its size (what the page or a person sent is never trusted as is). */
function cleanBody(f) {
  const lanes = (Array.isArray(f.lanes) ? f.lanes : []).filter(isObj).slice(0, MAX.lanes).map((l) => ({
    id: idOf(l.id) || 'system', name: cut(l.name, 100), kind: cut(l.kind, 20), kindLabel: cut(l.kindLabel, 60), host: cut(l.host, 200) }));
  let total = 0;
  const actions = (Array.isArray(f.actions) ? f.actions : []).filter(isObj).slice(0, MAX.actions).map((a) => ({
    id: idOf(a.id, 20) || 'a', trigger: cut(a.trigger, 600), title: cut(a.title, 300), note: cut(a.note, 2000), chain: cut(a.chain, 300),
    chains: (Array.isArray(a.chains) ? a.chains : []).slice(0, 20).map((c) => cut(c, 100)),
    steps: (Array.isArray(a.steps) ? a.steps : []).filter(isObj).filter(() => ++total <= MAX.steps).map((s) => ({
      id: idOf(s.id, 20) || 's', system: idOf(s.system), method: cut(s.method, 10), path: cut(s.path, 500), endpoint: cut(s.endpoint, 200), object: cut(s.object, 200),
      action: cut(s.action, 100), direction: ['Read', 'Write', 'Report'].indexOf(s.direction) !== -1 ? s.direction : 'Read', summary: cut(s.summary, 300), via: cut(s.via, 100),
      row: cut(s.row, 20), text: cut(s.text, 500), note: cut(s.note, 2000), manual: !!s.manual })) }));
  return { lanes, actions };
}
const sameBody = (a, b) => JSON.stringify({ l: a.lanes, a: a.actions }) === JSON.stringify({ l: b.lanes, a: b.actions });

function open(opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now : () => new Date();
  const dirNow = () => { const d = typeof o.dir === 'function' ? o.dir() : o.dir; return d ? path.resolve(d) : ''; };
  const no = (error) => ({ ok: false, error: error });
  const NO_DIR = 'Set up your workspace first: saved flows are kept per VB Studio project.';
  const file = (id) => path.join(dirNow(), slug(id) + '.json');
  const read = (f) => { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return isObj(j) && j.id ? j : null; } catch (e) { return null; } };
  const write = (fl) => { fs.mkdirSync(dirNow(), { recursive: true }); const f = file(fl.id); fs.writeFileSync(f + '.tmp', JSON.stringify(fl, null, 2)); fs.renameSync(f + '.tmp', f); };
  const all = () => {
    const d = dirNow();
    if (!d) return [];
    let names = [];
    try { names = fs.readdirSync(d).filter((x) => /^FL-\d+\.json$/.test(x)); } catch (e) { return []; }
    return names.map((n) => read(path.join(d, n))).filter(Boolean);
  };
  const ev = (fl, what, by, note) => { fl.history = (fl.history || []).concat([{ at: now().toISOString(), by: str(by), what: str(what), note: cut(note, 500) }]).slice(-MAX.history); };
  const stepsOf = (fl) => (fl.actions || []).reduce((n, a) => n + (a.steps || []).length, 0);
  /** In the list: everything but the earlier versions, with its counts. */
  const brief = (fl) => Object.assign({}, fl, { versions: undefined, versionCount: (fl.versions || []).length, steps: stepsOf(fl), actionCount: (fl.actions || []).length,
    openComments: (fl.comments || []).filter((c) => !c.resolved).length, statusText: STATUSES[fl.status] || 'Draft' });
  const load = (id) => (dirNow() ? read(file(id)) : null);

  return {
    STATUSES,
    /** Every saved flow, the newest number first; q: words in its id, name, purpose, area, owner, page, systems, tags. */
    list(q) {
      if (!dirNow()) return no(NO_DIR);
      const words = str(q).toLowerCase().split(/\s+/).filter(Boolean);
      const flows = all().map(brief).filter((fl) => !words.length || words.every((w) => [fl.id, fl.name, fl.purpose, fl.area, fl.owner, fl.story, (fl.tags || []).join(' '),
        fl.source && fl.source.pageLabel, fl.source && fl.source.page, (fl.lanes || []).map((l) => l.name).join(' '), fl.statusText].join(' ').toLowerCase().indexOf(w) !== -1))
        .sort((a, b) => codeNo(b.id) - codeNo(a.id));
      return { ok: true, flows };
    },
    get(id) { const fl = load(id); return fl ? { ok: true, flow: Object.assign({}, fl, { statusText: STATUSES[fl.status] || 'Draft' }) } : no('No such saved flow.'); },
    /** Saved: a new one gets the next FL number (copy: saved as a new flow, from the one given); an existing one keeps its
     *  version before as an earlier version and goes up one. Comments are kept as they are (they have their own calls). */
    save(flow, by, opt) {
      if (!dirNow()) return no(NO_DIR);
      if (!isObj(flow)) return no('No flow.');
      const op = opt || {};
      const name = cut(str(flow.name).trim(), 120);
      if (!name) return no('Give the flow a name.');
      const every = all();
      const old = !op.copy && flow.id ? every.filter((x) => x.id === str(flow.id))[0] || null : null;
      if (!op.copy && flow.id && !old) return no('No such saved flow (it may have been removed).');
      const at = now().toISOString();
      const body = cleanBody(flow);
      const fl = Object.assign(old ? JSON.parse(JSON.stringify(old)) : { id: codeOf(every.reduce((m, x) => Math.max(m, codeNo(x.id)), 0) + 1), created: at, createdBy: str(by), comments: [], versions: [], history: [], version: 0 }, {
        name, purpose: cut(flow.purpose, 4000), area: cut(flow.area, 120), owner: cut(flow.owner, 120), status: STATUSES[flow.status] ? flow.status : 'draft',
        story: cut(str(flow.story).trim(), 40), tags: (Array.isArray(flow.tags) ? flow.tags : []).slice(0, 20).map((t) => cut(str(t).trim(), 40)).filter(Boolean),
        app: cut(flow.app, 60), source: isObj(flow.source) ? { kind: flow.source.kind === 'page' ? 'page' : 'blank', page: cut(flow.source.page, 200), pageLabel: cut(flow.source.pageLabel, 200), flow: cut(flow.source.flow, 100), scannedAt: cut(flow.source.scannedAt, 40) } : { kind: 'blank' },
        lanes: body.lanes, actions: body.actions, updated: at, updatedBy: str(by)
      });
      if (old) {
        // the version before, kept (when its steps or details changed)
        if (!sameBody(old, fl) || old.name !== fl.name || old.status !== fl.status || old.purpose !== fl.purpose) {
          fl.versions = (old.versions || []).concat([{ v: old.version || 1, at: old.updated || old.created, by: old.updatedBy || old.createdBy, note: old.lastNote || '', name: old.name, status: old.status, lanes: old.lanes, actions: old.actions }]).slice(-MAX.versions);
          fl.version = (old.version || 1) + 1;
          fl.lastNote = cut(op.note, 300);
          const said = [];
          if (old.status !== fl.status) said.push('status: ' + (STATUSES[old.status] || 'Draft') + ' → ' + STATUSES[fl.status]);
          if (old.name !== fl.name) said.push('name: ' + old.name + ' → ' + fl.name);
          if (!sameBody(old, fl)) said.push(stepsOf(old) + ' → ' + stepsOf(fl) + ' steps');
          ev(fl, 'saved v' + fl.version, by, [cut(op.note, 300)].concat(said).filter(Boolean).join(' · '));
        } else ev(fl, 'saved (no change)', by, '');
      } else {
        fl.version = 1;
        fl.lastNote = cut(op.note, 300);
        if (op.copy && flow.id) { fl.copiedFrom = cut(flow.id, 20); ev(fl, 'created as a copy of ' + cut(flow.id, 20), by, cut(op.note, 300)); }
        else ev(fl, 'created', by, fl.source.kind === 'page' ? 'from the page ' + (fl.source.pageLabel || fl.source.page) : 'drawn by hand');
      }
      write(fl);
      return { ok: true, flow: Object.assign({}, fl, { statusText: STATUSES[fl.status] }) };
    },
    remove(id) {
      if (!load(id)) return no('No such saved flow.');
      try { fs.unlinkSync(file(id)); } catch (e) { return no('It could not be removed: ' + e.message); }
      return { ok: true };
    },
    /** A comment on the flow (or on one of its steps): kept at once, without a new version. */
    comment(id, c, by) {
      const fl = load(id);
      if (!fl) return no('No such saved flow.');
      const text = cut(str(c && c.text).trim(), 4000);
      if (!text) return no('Write the comment first.');
      if ((fl.comments || []).length >= MAX.comments) return no('This flow has too many comments.');
      const cid = 'c' + ((fl.comments || []).reduce((m, x) => Math.max(m, Number(str(x.id).slice(1)) || 0), 0) + 1);
      fl.comments = (fl.comments || []).concat([{ id: cid, at: now().toISOString(), by: str(by), text, step: idOf(c && c.step, 20), resolved: false }]);
      ev(fl, 'commented', by, text.slice(0, 120));
      write(fl);
      return { ok: true, flow: Object.assign({}, fl, { statusText: STATUSES[fl.status] || 'Draft' }) };
    },
    resolve(id, cid, resolved, by) {
      const fl = load(id);
      if (!fl) return no('No such saved flow.');
      const c = (fl.comments || []).filter((x) => x.id === str(cid))[0];
      if (!c) return no('No such comment.');
      c.resolved = !!resolved;
      c.resolvedBy = resolved ? str(by) : '';
      c.resolvedAt = resolved ? now().toISOString() : '';
      ev(fl, resolved ? 'resolved a comment' : 'reopened a comment', by, c.text.slice(0, 80));
      write(fl);
      return { ok: true, flow: Object.assign({}, fl, { statusText: STATUSES[fl.status] || 'Draft' }) };
    },
    uncomment(id, cid, by) {
      const fl = load(id);
      if (!fl) return no('No such saved flow.');
      const c = (fl.comments || []).filter((x) => x.id === str(cid))[0];
      if (!c) return no('No such comment.');
      fl.comments = fl.comments.filter((x) => x.id !== c.id);
      ev(fl, 'removed a comment', by, c.text.slice(0, 80));
      write(fl);
      return { ok: true, flow: Object.assign({}, fl, { statusText: STATUSES[fl.status] || 'Draft' }) };
    }
  };
}

module.exports = { open, STATUSES, cleanBody };
