'use strict';
/**
 * Saved feature lists, for "Features" in Build.Rite (insights/jira-features): the grouping of a project's Jira stories
 * into product features — drafted with AI or auto-grouped — is kept on this PC (a JSON file in the app's data folder),
 * so opening the Features tab again shows the last draft (with when and by whom) and the model is rebuilt live against
 * the current stories. Saving replaces the project's list. Only the grouping is kept, not the stories themselves.
 *
 *   open({ file, now, max }) → store
 *     index()          { ok, items: { PROJECT: { at, by, source, features } } }   (features = count, no story keys)
 *     get(project)     { ok, item } | { ok: false }          project '' → every project ('_ALL')
 *     save(item)       { project, features: [{ name, description, storyKeys }], by, source } → { ok, item }  (at set here)
 *     remove(project)  { ok }
 *
 * A feature is { name, description, storyKeys: [] }. A project key is upper-cased; '' is kept as '_ALL' (the search that
 * spans every project). The newest `max` (500) projects are kept.
 */
const fs = require('fs');
const path = require('path');

function str(v) { return v == null ? '' : String(v); }
const cut = (s, n) => str(s).slice(0, n);
/** A project key: upper-case letters/digits, or '_ALL' for every project (''). */
function cleanProject(p) {
  const s = str(p).trim().toUpperCase();
  if (!s) return '_ALL';
  return /^[A-Z][A-Z0-9_]*$/.test(s) ? s : '';
}
/** One drafted feature, trimmed: a name, a one-line description, and its story keys (upper-cased, de-duplicated). */
function cleanFeature(f) {
  const o = f || {};
  const seen = {};
  const keys = (Array.isArray(o.storyKeys) ? o.storyKeys : []).map((k) => str(k).trim().toUpperCase())
    .filter((k) => k && /^[A-Z][A-Z0-9]*-\d+$/.test(k) && !seen[k] && (seen[k] = true)).slice(0, 2000);
  return { name: cut(o.name, 200), description: cut(o.description, 600), storyKeys: keys };
}

function open(opts) {
  const o = opts || {};
  const file = o.file;
  const now = o.now || (() => new Date());
  const max = o.max || 500;
  let items = null;

  function load() {
    if (items) return items;
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); items = j && typeof j.items === 'object' ? j.items : {}; } catch (e) { items = {}; }
    return items;
  }
  function write() {
    const keys = Object.keys(items).sort((a, b) => str(items[b].at).localeCompare(str(items[a].at)));
    keys.slice(max).forEach((k) => { delete items[k]; });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, items: items }));
    fs.renameSync(tmp, file);
  }
  const summary = (it) => ({ at: it.at, by: it.by, source: it.source, features: (it.features || []).length });

  return {
    index() {
      const all = load();
      const out = {};
      Object.keys(all).forEach((k) => { out[k] = summary(all[k]); });
      return { ok: true, items: out };
    },
    get(project) {
      const k = cleanProject(project);
      const it = k ? load()[k] : null;
      return it ? { ok: true, item: it } : { ok: false, error: 'No saved feature list for ' + (k === '_ALL' ? 'every project' : (k || str(project))) + '.' };
    },
    save(b) {
      b = b || {};
      const k = cleanProject(b.project);
      if (!k) return { ok: false, error: 'A feature list is saved under a project key (letters and digits) or every project.' };
      const features = (Array.isArray(b.features) ? b.features : []).slice(0, 500).map(cleanFeature).filter((f) => f.name || f.storyKeys.length);
      const it = {
        project: k === '_ALL' ? '' : k, features: features,
        by: cut(b.by, 120), source: cut(b.source, 120), at: now().toISOString(),
      };
      load()[k] = it;
      write();
      return { ok: true, item: it };
    },
    remove(project) {
      const k = cleanProject(project);
      if (k && load()[k]) { delete items[k]; write(); }
      return { ok: true };
    },
  };
}

module.exports = { open, cleanProject, cleanFeature };
