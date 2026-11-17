'use strict';
/**
 * Change requests (Application → Change requests): a change asked of one page of your workspace's app, logged with
 * who asked and why, then made with Code Fix (lib/codeFix.js) — the AI's proposal, approved, applied in the working
 * folder, tested, saved — and followed until it is fixed.
 *
 * A change request is a header and the Code Fix attempts made for it:
 *   code (CR-0001, given on the first save), title, page (app/flow/page) and its label, kind (fix | enhance | change),
 *   request (what should change), priority (low | medium | high | urgent), customer, requestedBy, requestedOn
 *   (YYYY-MM-DD), jira, issue, dueOn, fixedOn / fixedBy (set when its change is saved — or by hand), state (open |
 *   hold | closed | rejected), notes; fixes (the Code Fix ids, newest last) and fixId (the one shown); events (what
 *   happened, when, by whom); created / updated (when, by whom).
 *   A new page (kind page): page is the page it is made like, newPage { title, name, flow, group, label, icon, after }
 *   says what it is and where it goes in the menu. knowledge { fdd, fddLabel, sections: [keys], notes }: what the AI
 *   builds it from (an FDD's sections, functional and technical, and the person's notes).
 * Its status follows its Code Fix: New (nothing asked yet), Proposed, Questions, Needs redo, Applied (testing), Fixed
 * (the change saved), Undone — unless it is On hold, Closed or Rejected.
 *
 *   open({ dir: string | () => string, now }) → store
 *     list(q, fixOf)  get(id, fixOf)  save(cr, by)  remove(id)  link(id, fixId, by, what)  event(id, what, by, note)
 *   fixOf(fixId) → the Code Fix (or null): its status, commit and application fill the status and the fixed date.
 * One JSON file per change request in the folder (the project's: a workspace's requests stay with it).
 */
const fs = require('fs');
const path = require('path');

const KINDS = { fix: 'Fix a bug', enhance: 'Enhance', change: 'Change', page: 'New page' };
const PRIORITIES = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
const STATES = { open: 'Open', hold: 'On hold', closed: 'Closed', rejected: 'Rejected' };
const MAX_EVENTS = 200;

const str = (v) => (v === undefined || v === null ? '' : String(v));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const cut = (v, n) => str(v).trim().slice(0, n);
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v).trim()) ? str(v).trim() : '');
const codeNo = (c) => { const m = /^CR-(\d+)$/.exec(str(c)); return m ? Number(m[1]) : 0; };
const codeOf = (n) => 'CR-' + String(n).padStart(4, '0');
const slug = (id) => str(id).replace(/[^A-Za-z0-9_-]/g, '');

/** Its status: the state set by hand wins (on hold, closed, rejected); else its Code Fix's. */
function statusOf(cr, fix) {
  const st = cr && cr.state;
  if (st === 'rejected') return { key: 'rejected', text: 'Rejected' };
  if (st === 'closed') return { key: 'closed', text: 'Closed' };
  if (st === 'hold') return { key: 'hold', text: 'On hold' };
  const fs0 = fix && fix.status;
  if (!fs0 || fs0 === 'discarded') return { key: 'new', text: 'New' };
  if (fs0 === 'committed') return { key: 'fixed', text: 'Fixed' };
  if (fs0 === 'applied') return { key: 'applied', text: 'Applied — testing' };
  if (fs0 === 'proposed') return { key: 'proposed', text: 'Proposed' };
  if (fs0 === 'questions') return { key: 'questions', text: 'Questions' };
  if (fs0 === 'needs-redo') return { key: 'redo', text: 'Needs redo' };
  if (fs0 === 'undone') return { key: 'undone', text: 'Undone' };
  if (fs0 === 'stale') return { key: 'stale', text: 'Out of date' };
  return { key: 'new', text: 'New' };
}

/** A new page's own fields (Change requests → New page), each within its size; null when none is given. */
function cleanNewPage(x) {
  if (!isObj(x)) return null;
  const out = {};
  [['title', 120], ['name', 60], ['flow', 80], ['group', 80], ['label', 80], ['icon', 60], ['after', 80]].forEach((p) => { out[p[0]] = cut(x[p[0]], p[1]); });
  out.name = out.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return out.title || out.name ? out : null;
}
/** What the AI builds it from: an FDD (its id, its name) and the sections chosen, and the person's notes. */
function cleanKnowledge(x) {
  if (!isObj(x)) return null;
  const sections = (Array.isArray(x.sections) ? x.sections : []).map((k) => cut(k, 40)).filter(Boolean).slice(0, 80);
  const out = { fdd: cut(x.fdd, 80), fddLabel: cut(x.fddLabel, 160), sections: sections, notes: str(x.notes).trim().slice(0, 8000) };
  return out.sections.length || out.notes || out.fdd ? out : null;
}

/** A change request as kept: only known fields, each within its size; what the earlier copy had is kept where not given. */
function clean(c, by, old, now) {
  const o = old || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(c, k);
  const pick = (k, n) => (has(k) ? cut(c[k], n) : str(o[k]));
  const at = now();
  const out = {
    id: str(o.id) || ('cr' + at.getTime().toString(36) + Math.floor(Math.random() * 1e4).toString(36)),
    code: codeNo(o.code) ? o.code : '',
    title: pick('title', 200),
    page: pick('page', 300),
    pageLabel: pick('pageLabel', 200),
    kind: KINDS[has('kind') ? str(c.kind) : str(o.kind)] ? (has('kind') ? str(c.kind) : str(o.kind)) : 'change',
    request: has('request') ? str(c.request).trim().slice(0, 8000) : str(o.request),
    priority: PRIORITIES[has('priority') ? str(c.priority) : str(o.priority)] ? (has('priority') ? str(c.priority) : str(o.priority)) : 'medium',
    customer: pick('customer', 120),
    requestedBy: pick('requestedBy', 120),
    requestedOn: has('requestedOn') ? day(c.requestedOn) : (str(o.requestedOn) || at.toISOString().slice(0, 10)),
    jira: has('jira') ? cut(c.jira, 80).replace(/[^A-Za-z0-9 _#.,\/-]+/g, ' ') : str(o.jira),
    issue: has('issue') ? cut(c.issue, 80).replace(/[^A-Za-z0-9 _#.,\/-]+/g, ' ') : str(o.issue),
    dueOn: has('dueOn') ? day(c.dueOn) : str(o.dueOn),
    fixedOn: has('fixedOn') ? day(c.fixedOn) : str(o.fixedOn),
    fixedBy: pick('fixedBy', 120),
    // fixed on / by set by its change being saved (not typed): cleared again if that change is undone
    fixedAuto: !!o.fixedAuto && (!has('fixedOn') || day(c.fixedOn) === str(o.fixedOn)) && (!has('fixedBy') || cut(c.fixedBy, 120) === str(o.fixedBy)),
    state: STATES[has('state') ? str(c.state) : str(o.state)] ? (has('state') ? str(c.state) : str(o.state)) : 'open',
    notes: has('notes') ? str(c.notes).trim().slice(0, 8000) : str(o.notes),
    newPage: has('newPage') ? cleanNewPage(c.newPage) : (isObj(o.newPage) ? o.newPage : null),
    knowledge: has('knowledge') ? cleanKnowledge(c.knowledge) : (isObj(o.knowledge) ? o.knowledge : null),
    fixes: Array.isArray(o.fixes) ? o.fixes.slice() : [],
    fixId: str(o.fixId),
    events: Array.isArray(o.events) ? o.events.slice(-MAX_EVENTS) : [],
    createdAt: str(o.createdAt) || at.toISOString(),
    createdBy: str(o.createdBy) || str(by),
    updatedAt: at.toISOString(),
    updatedBy: str(by)
  };
  if (!out.requestedBy && !o.id) out.requestedBy = str(by);
  return out;
}

function open(opts) {
  const o = opts || {};
  const now = typeof o.now === 'function' ? o.now : () => new Date();
  const dirNow = () => { const d = typeof o.dir === 'function' ? o.dir() : o.dir; return d ? path.resolve(d) : ''; };
  const no = (error, extra) => Object.assign({ ok: false, error: error }, extra || {});
  const file = (id) => path.join(dirNow(), slug(id) + '.json');
  const read = (f) => { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return isObj(j) && j.id ? j : null; } catch (e) { return null; } };
  const write = (cr) => { fs.mkdirSync(dirNow(), { recursive: true }); const f = file(cr.id); fs.writeFileSync(f + '.tmp', JSON.stringify(cr, null, 2)); fs.renameSync(f + '.tmp', f); };
  const all = () => {
    const d = dirNow();
    if (!d) return [];
    let names = [];
    try { names = fs.readdirSync(d).filter((x) => /\.json$/.test(x)); } catch (e) { return []; }
    return names.map((n) => read(path.join(d, n))).filter(Boolean);
  };
  const ev = (cr, what, by, note) => { cr.events = (cr.events || []).concat([{ at: now().toISOString(), what: str(what), by: str(by), note: str(note).slice(0, 500) }]).slice(-MAX_EVENTS); };
  const nextCode = (list) => codeOf(list.reduce((m, x) => Math.max(m, codeNo(x.code)), 0) + 1);

  /** As shown: its status from its Code Fix, the fixed date and who fixed it from the change saved (unless set by hand). */
  function view(cr, fixOf) {
    let fix = null;
    if (cr.fixId && typeof fixOf === 'function') { try { fix = fixOf(cr.fixId) || null; } catch (e) { fix = null; } }
    const st = statusOf(cr, fix);
    const committed = fix && fix.status === 'committed' && fix.commit;
    const fixedOn = cr.fixedOn || (committed ? str(fix.commit.at || fix.updatedAt || '').slice(0, 10) : '');
    const fixedBy = cr.fixedBy || (committed ? str((fix.applied && fix.applied.by) || fix.commit.by || '') : '');
    return Object.assign({}, cr, {
      status: st.key, statusText: st.text, fixStatus: fix ? fix.status : '', fixedOnShown: fixedOn, fixedByShown: fixedBy,
      kindText: KINDS[cr.kind] || KINDS.change, priorityText: PRIORITIES[cr.priority] || PRIORITIES.medium, stateText: STATES[cr.state] || STATES.open,
      // the page it is about: a new page's own id once named (app/flow/name), else the page
      targetPage: cr.kind === 'page' && cr.newPage && cr.newPage.name && cr.newPage.flow ? str(cr.page).split('/')[0] + '/' + cr.newPage.flow + '/' + cr.newPage.name : str(cr.page),
      targetLabel: cr.kind === 'page' && cr.newPage && cr.newPage.title ? cr.newPage.title + ' (new)' : str(cr.pageLabel),
      attempts: (cr.fixes || []).length,
      // its Code Fix in short (Change requests → Analytics): the files and lines it changes, when it was applied and saved
      fixSum: fix ? {
        status: str(fix.status), files: (fix.diff || []).map((d) => ({ file: str(d.file), added: Number(d.added) || 0, removed: Number(d.removed) || 0, created: !!d.created })),
        added: (fix.diff || []).reduce((n, d) => n + (Number(d.added) || 0), 0), removed: (fix.diff || []).reduce((n, d) => n + (Number(d.removed) || 0), 0),
        proposedAt: str(fix.at), appliedAt: str(fix.applied && fix.applied.at), savedAt: str(fix.commit && fix.commit.at), sha: str(fix.commit && fix.commit.sha), pushed: !!(fix.commit && fix.commit.pushed),
        approvedBy: str(fix.applied && fix.applied.by), testsOk: fix.tests ? !!fix.tests.ok : null, provider: str(fix.provider), aiMs: Number(fix.ms) || 0, retried: !!fix.retried
      } : null,
      overdue: !!(cr.dueOn && st.key !== 'fixed' && st.key !== 'closed' && st.key !== 'rejected' && cr.dueOn < now().toISOString().slice(0, 10))
    });
  }

  const store = {
    KINDS, PRIORITIES, STATES,
    /** Every change request, the newest number first; q: words in its code, title, page, request, customer, people, Jira, issue. */
    list(q, fixOf) {
      if (!dirNow()) return no('Set up your workspace first: change requests are kept per VB Studio project.');
      const words = str(q).toLowerCase().split(/\s+/).filter(Boolean);
      const rows = all().map((cr) => view(cr, fixOf)).filter((cr) => {
        if (!words.length) return true;
        const hay = [cr.code, cr.title, cr.page, cr.pageLabel, cr.request, cr.customer, cr.requestedBy, cr.fixedByShown, cr.jira, cr.issue, cr.statusText, cr.priorityText].join(' ').toLowerCase();
        return words.every((w) => hay.indexOf(w) !== -1);
      }).sort((a, b) => codeNo(b.code) - codeNo(a.code) || str(b.createdAt).localeCompare(str(a.createdAt)));
      return { ok: true, requests: rows };
    },
    get(id, fixOf) {
      const cr = dirNow() ? read(file(id)) : null;
      return cr ? { ok: true, request: view(cr, fixOf) } : no('No such change request.');
    },
    /** Saved (a new one gets the next CR number); it belongs to a page. */
    save(c, by, fixOf) {
      if (!dirNow()) return no('Set up your workspace first: change requests are kept per VB Studio project.');
      if (!isObj(c)) return no('No change request.');
      const every = all();
      const old = c.id ? every.filter((x) => x.id === str(c.id))[0] || null : null;
      const cr = clean(c, by, old, now);
      if (!cr.page) return no('Pick the page this change is for.');
      if (!cr.title && !cr.request) return no('Say what should change (a title or the request).');
      if (!cr.code) cr.code = nextCode(every.filter((x) => x.id !== cr.id));
      if (!old) ev(cr, 'created', by, cr.code + (cr.title ? ' — ' + cr.title : ''));
      else {
        const said = [];
        if (old.state !== cr.state) said.push('state: ' + (STATES[old.state] || 'Open') + ' → ' + STATES[cr.state]);
        if (old.page !== cr.page) said.push('page: ' + (old.pageLabel || old.page) + ' → ' + (cr.pageLabel || cr.page));
        if (old.priority !== cr.priority) said.push('priority: ' + (PRIORITIES[old.priority] || '') + ' → ' + PRIORITIES[cr.priority]);
        if (old.fixedOn !== cr.fixedOn && cr.fixedOn) said.push('fixed on ' + cr.fixedOn);
        ev(cr, said.length ? 'changed' : 'saved', by, said.join('; '));
      }
      write(cr);
      return { ok: true, request: view(cr, fixOf) };
    },
    remove(id) {
      const cr = dirNow() ? read(file(id)) : null;
      if (!cr) return no('No such change request.');
      try { fs.unlinkSync(file(id)); } catch (e) { return no('It could not be removed: ' + e.message); }
      return { ok: true };
    },
    /** A Code Fix attempt made for it (the proposal asked, or asked again): kept, and shown from now on. */
    link(id, fixId, by, what, fixOf) {
      const cr = dirNow() ? read(file(id)) : null;
      if (!cr) return no('No such change request.');
      const f = str(fixId).replace(/[^A-Za-z0-9]/g, '');
      if (!f) return no('Which Code Fix?');
      if ((cr.fixes || []).indexOf(f) === -1) cr.fixes = (cr.fixes || []).concat([f]);
      cr.fixId = f;
      cr.updatedAt = now().toISOString(); cr.updatedBy = str(by);
      ev(cr, str(what) || 'analyzed', by, f);
      write(cr);
      return { ok: true, request: view(cr, fixOf) };
    },
    /** Something done with its Code Fix (applied, tested, saved in working, undone…): written in its history. */
    event(id, what, by, note, fixOf) {
      const cr = dirNow() ? read(file(id)) : null;
      if (!cr) return no('No such change request.');
      if (!str(what).trim()) return no('What happened?');
      ev(cr, cut(what, 60), by, note);
      // its change saved: when, by whom (unless set by hand)
      if (/^(saved in working|saved on approval|committed|pushed)$/.test(str(what))) {
        if (!cr.fixedOn) { cr.fixedOn = now().toISOString().slice(0, 10); cr.fixedAuto = true; }
        if (!cr.fixedBy) { cr.fixedBy = str(by); cr.fixedAuto = cr.fixedAuto !== false; }
      }
      // its change taken out again: the fixed date it set goes too (one typed by hand stays)
      if (str(what) === 'undone' && cr.fixedAuto) { cr.fixedOn = ''; cr.fixedBy = ''; cr.fixedAuto = false; }
      cr.updatedAt = now().toISOString(); cr.updatedBy = str(by);
      write(cr);
      return { ok: true, request: view(cr, fixOf) };
    }
  };
  return store;
}

module.exports = { open, statusOf, KINDS, PRIORITIES, STATES };
