define([], function () {
  'use strict';

  // Features from Jira (flows/insights jira-features): take every Jira story and draft a product FEATURE LIST — the
  // features the product has, each with a one-line description, the stories under it and a status roll-up. Pure: no page,
  // no DOM, no network. The page's chain reads the stories (resources/js/jiraBacklog), asks the shared Ask AI with the
  // prompt built here, parses the answer, and builds the model; or, with no AI, autoDraft groups by epic / label / type.
  //
  //   norm(issue)                 one jiraBacklog issue → { key, summary, status, cat, type, epic, labels, url }
  //   storiesText(issues, budget) the stories as compact lines for the prompt (within a character budget)
  //   prompt(issues)              { system, user } — asks the AI to group the stories into features and answer with one
  //                               ```features JSON block: [{ name, description, storyKeys:[…] }]
  //   parse(text)                 the ```features block (or the first JSON array) → [{ name, description, storyKeys }]
  //   autoDraft(issues)           the same shape without AI: grouped by epic, else first label, else type
  //   build(issues, drafted)      the model: { features:[{ name, description, stories:[…], rollup }], ungrouped, total,
  //                               counts } — keys matched to the real stories, unknown keys dropped, empty features out,
  //                               stories in no feature gathered under "ungrouped"
  //   rollup(stories)             { done, prog, todo, total }
  //   rows(model)                 flat rows (Feature, Description, Story, Summary, Status) for CSV / Excel
  //   documentHtml(model, meta)   a print-ready HTML document (also the PDF / HTML export)

  var S = function (v) { return v == null ? '' : String(v); };
  function esc(s) { return S(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function cut(s, n) { s = S(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function uniq(a) { var seen = {}; return (a || []).filter(function (x) { var k = S(x); if (seen[k]) return false; seen[k] = 1; return true; }); }

  /** One story, from whatever jiraBacklog returned, in the small shape this engine uses. */
  function norm(i) {
    i = i || {};
    var cat = i.statusCat || i.cat || i.statusCategory || 'new';
    cat = cat === 'done' ? 'done' : cat === 'indeterminate' ? 'indeterminate' : 'new';
    return {
      key: S(i.key),
      summary: S(i.summary),
      status: S(i.status),
      cat: cat,
      type: S(i.type) || 'Story',
      epic: S(i.epicName) || S(i.epic) || S(i.epicKey),
      labels: Array.isArray(i.labels) ? i.labels.map(S).filter(Boolean) : [],
      url: S(i.url)
    };
  }
  function normAll(issues) { return (Array.isArray(issues) ? issues : []).map(norm).filter(function (s) { return s.key; }); }

  /** A status roll-up for a set of stories. */
  function rollup(stories) {
    var r = { done: 0, prog: 0, todo: 0, total: 0 };
    (stories || []).forEach(function (s) {
      r.total++;
      if (s.cat === 'done') r.done++;
      else if (s.cat === 'indeterminate') r.prog++;
      else r.todo++;
    });
    return r;
  }

  /** The stories as compact lines for the prompt, within a character budget (newest/first kept). */
  function storiesText(issues, budget) {
    var cap = budget || 24000;
    var lines = [];
    var used = 0;
    normAll(issues).forEach(function (s) {
      if (used > cap) return;
      var extra = [];
      if (s.epic) extra.push('epic: ' + s.epic);
      if (s.labels.length) extra.push('labels: ' + s.labels.join(','));
      var line = s.key + ' [' + s.type + '/' + s.status + '] ' + cut(s.summary, 160) + (extra.length ? ' — ' + extra.join('; ') : '');
      used += line.length + 1;
      if (used <= cap) lines.push(line);
    });
    return lines.join('\n');
  }

  var SYSTEM = [
    'You are a product analyst. You are given the complete list of a software product\'s Jira stories (key, type, status, and when known its epic and labels).',
    'Group them into the product\'s FEATURES — the user-facing capabilities the product offers (for example "Equipment catalogue", "Fusion sync", "Receiving").',
    'Rules:',
    '- Use ONLY the story keys given. Never invent a story, a key, or a feature that no story supports.',
    '- Put each story under exactly one feature (its best fit). Every story must appear under some feature.',
    '- A feature groups several related stories; avoid one-story features unless a story truly stands alone.',
    '- Name each feature as a short capability (2–5 words, Title Case), not a sentence; write a one-line plain-English description of what it lets a user do.',
    '- Order features from the most central to the most peripheral.',
    'Answer with ONE fenced code block and nothing else:',
    '```features',
    '[{"name":"Feature name","description":"one line","storyKeys":["ABC-1","ABC-2"]}]',
    '```'
  ].join('\n');

  /** { system, user } to draft the feature list from the stories. */
  function prompt(issues, opts) {
    var o = opts || {};
    var text = storiesText(issues, o.budget);
    var n = normAll(issues).length;
    var user = 'The product has ' + n + ' Jira stor' + (n === 1 ? 'y' : 'ies') + '. Group them into features.\n\nStories:\n' + text
      + '\n\nReturn only the ```features JSON block, with every story key placed under exactly one feature.';
    return { system: SYSTEM, user: user };
  }

  /** The ```features block (or the first JSON array) → [{ name, description, storyKeys:[…] }]; [] when none. */
  function parse(text) {
    var t = S(text);
    var m = /```(?:features|json)?\s*([\s\S]*?)```/i.exec(t);
    var body = m ? m[1] : t;
    var a = body.indexOf('[');
    var b = body.lastIndexOf(']');
    if (a === -1 || b === -1 || b < a) return [];
    var arr;
    try { arr = JSON.parse(body.slice(a, b + 1)); } catch (e) { return []; }
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (f) { return f && typeof f === 'object'; }).map(function (f) {
      return { name: S(f.name).trim(), description: S(f.description).trim(),
        storyKeys: uniq((Array.isArray(f.storyKeys) ? f.storyKeys : (Array.isArray(f.keys) ? f.keys : [])).map(function (k) { return S(k).trim().toUpperCase(); }).filter(Boolean)) };
    }).filter(function (f) { return f.name; });
  }

  /** Without AI: group by epic, else first label, else type — same shape as parse(). */
  function autoDraft(issues) {
    var stories = normAll(issues);
    var order = [];
    var by = {};
    stories.forEach(function (s) {
      var name = s.epic || (s.labels[0] || '') || s.type || 'Other';
      if (!by[name]) { by[name] = []; order.push(name); }
      by[name].push(s.key);
    });
    return order.map(function (name) {
      return { name: name, description: 'Stories grouped by ' + (stories.some(function (s) { return s.epic === name; }) ? 'epic' : 'label / type') + ': ' + name + '.', storyKeys: by[name] };
    });
  }

  /**
   * The model from the stories and a drafted grouping: features with their real stories (unknown keys dropped), a
   * roll-up each, empty features removed; stories placed in no feature gathered as `ungrouped`.
   */
  function build(issues, drafted) {
    var stories = normAll(issues);
    var byKey = {};
    stories.forEach(function (s) { byKey[s.key.toUpperCase()] = s; });
    var placed = {};
    var features = (Array.isArray(drafted) ? drafted : []).map(function (f) {
      var list = uniq((f.storyKeys || []).map(function (k) { return S(k).toUpperCase(); }))
        .map(function (k) { return byKey[k]; }).filter(Boolean);
      list.forEach(function (s) { placed[s.key] = true; });
      return { name: S(f.name).trim() || 'Feature', description: S(f.description).trim(), stories: list, rollup: rollup(list) };
    }).filter(function (f) { return f.stories.length; });
    var ungrouped = stories.filter(function (s) { return !placed[s.key]; });
    return { features: features, ungrouped: ungrouped, total: stories.length,
      counts: { features: features.length, placed: Object.keys(placed).length, ungrouped: ungrouped.length }, rollup: rollup(stories) };
  }

  /** Flat rows for CSV / Excel: one row per story under its feature, plus the ungrouped ones. */
  function rows(model) {
    var out = [];
    ((model && model.features) || []).forEach(function (f) {
      (f.stories || []).forEach(function (s) { out.push({ feature: f.name, description: f.description, key: s.key, summary: s.summary, status: s.status, type: s.type, epic: s.epic }); });
    });
    ((model && model.ungrouped) || []).forEach(function (s) { out.push({ feature: '(ungrouped)', description: '', key: s.key, summary: s.summary, status: s.status, type: s.type, epic: s.epic }); });
    return out;
  }
  var COLUMNS = [
    { key: 'feature', label: 'Feature' }, { key: 'description', label: 'Description' }, { key: 'key', label: 'Story' },
    { key: 'summary', label: 'Summary' }, { key: 'status', label: 'Status' }, { key: 'type', label: 'Type' }, { key: 'epic', label: 'Epic' }
  ];

  function chip(r) {
    var bits = [];
    if (r.done) bits.push('<span class="jf-chip jf-chip--done">' + r.done + ' done</span>');
    if (r.prog) bits.push('<span class="jf-chip jf-chip--prog">' + r.prog + ' in progress</span>');
    if (r.todo) bits.push('<span class="jf-chip jf-chip--todo">' + r.todo + ' to do</span>');
    return bits.join(' ');
  }
  var CSS = 'body{font-family:"Oracle Sans",-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2a37;margin:0;padding:28px;font-size:11pt}'
    + 'h1{font-size:22pt;color:#13315c;margin:0 0 2px}.sub{color:#5a6876;margin:0 0 18px}'
    + '.feat{border:1px solid #e3e8ee;border-radius:12px;padding:12px 15px;margin:0 0 14px;break-inside:avoid}'
    + '.feat h2{font-size:14pt;color:#13315c;margin:0 0 2px}.feat .d{color:#394855;margin:0 0 8px}'
    + '.jf-chip{display:inline-block;font-size:8pt;font-weight:700;border-radius:999px;padding:1px 8px;margin-right:4px}'
    + '.jf-chip--done{background:#e5f3ea;color:#15673e}.jf-chip--prog{background:#fde8cf;color:#8a4b00}.jf-chip--todo{background:#eef1f5;color:#4a5765}'
    + 'table{border-collapse:collapse;width:100%;margin-top:8px}th,td{text-align:left;font-size:9.5pt;padding:4px 8px;border-top:1px solid #eef1f5;vertical-align:top}'
    + 'th{color:#6b7886;font-size:8pt;text-transform:uppercase;letter-spacing:.04em}code{color:#2e6fd8;font-size:9pt}'
    + '.st{font-size:8pt;font-weight:700;border-radius:999px;padding:1px 7px}.st-done{background:#e5f3ea;color:#15673e}.st-prog{background:#fde8cf;color:#8a4b00}.st-todo{background:#eef1f5;color:#4a5765}'
    + '.foot{margin-top:22px;border-top:1px solid #e3e8ee;padding-top:8px;color:#6b7886;font-size:8.5pt}';
  function stFor(cat) { return cat === 'done' ? 'st-done' : cat === 'indeterminate' ? 'st-prog' : 'st-todo'; }
  function storyRows(list) {
    return (list || []).map(function (s) {
      return '<tr><td><code>' + esc(s.key) + '</code></td><td>' + esc(s.summary) + '</td><td><span class="st ' + stFor(s.cat) + '">' + esc(s.status) + '</span></td></tr>';
    }).join('');
  }
  /** The whole feature list as a print-ready HTML document. meta: { project, by, date, source }. */
  function documentHtml(model, meta) {
    var o = meta || {};
    var m = model || { features: [], ungrouped: [], total: 0, rollup: rollup([]) };
    var head = '<div class="feat" style="border:0;padding:0">'
      + '<h1>Feature list</h1><p class="sub">' + esc([o.project ? 'Project ' + o.project : '', m.total + ' stories', (m.features || []).length + ' features', o.source || ''].filter(Boolean).join(' · ')) + '</p>'
      + '<p>' + chip(m.rollup || rollup([])) + '</p></div>';
    var feats = (m.features || []).map(function (f, i) {
      return '<div class="feat"><h2>' + (i + 1) + '. ' + esc(f.name) + '</h2>'
        + (f.description ? '<p class="d">' + esc(f.description) + '</p>' : '')
        + '<p>' + chip(f.rollup) + '</p>'
        + '<table><thead><tr><th>Story</th><th>Summary</th><th>Status</th></tr></thead><tbody>' + storyRows(f.stories) + '</tbody></table></div>';
    }).join('');
    var ung = (m.ungrouped && m.ungrouped.length)
      ? '<div class="feat"><h2>Not grouped (' + m.ungrouped.length + ')</h2><table><thead><tr><th>Story</th><th>Summary</th><th>Status</th></tr></thead><tbody>' + storyRows(m.ungrouped) + '</tbody></table></div>'
      : '';
    return '<!doctype html><html><head><meta charset="utf-8"><title>Feature list' + (o.project ? ' — ' + esc(o.project) : '') + '</title><style>' + CSS + '</style></head><body>'
      + head + feats + ung
      + '<div class="foot">Drafted from Jira stories by Build.Rite' + (o.by ? ' · ' + esc(o.by) : '') + (o.date ? ' · ' + esc(o.date) : '') + '. Review before use.</div>'
      + '</body></html>';
  }

  return { norm: norm, normAll: normAll, rollup: rollup, storiesText: storiesText, prompt: prompt, parse: parse,
    autoDraft: autoDraft, build: build, rows: rows, COLUMNS: COLUMNS, documentHtml: documentHtml, SYSTEM: SYSTEM };
});
