define(['resources/js/fddIndex'], function (FX) {
  'use strict';

  // Change requests › Knowledge base (pure — no DOM, no `this`): what the AI builds a change or a new page from, besides
  // the code. An FDD of the FDD library (Application → FDD library) with the sections chosen — functional and technical
  // alike; a section reads as technical when its heading (or its parent's) says integration, interface, API, data model,
  // table, report, security, error handling… — and the person's own notes and rules.
  //
  //   outline(doc, picked, filter, q) → [{ n, t, l, key, tech, on, chars, parent }]   the sections, filtered (all | functional
  //                                     | technical) and searched, each ticked or not
  //   suggest(doc, text)               → [key]   the sections whose words best match the request (fddIndex.pick)
  //   text(doc, picked, notes)         → the knowledge base as the AI reads it (≤ 30,000 characters)
  //   summary(kb, doc)                 → one line: what is in it

  var TECH = /\b(technical|integrations?|interfaces?|api|apis|rest|soap|web ?services?|endpoints?|oic|bip|reports?|data ?model|entit(y|ies)|tables?|schemas?|database|db|fields? mapping|mappings?|payloads?|security|roles?|access|errors?|exceptions?|logging|audit|performance|batch|jobs?|schedul\w*|extensions?|lookups?|validations?|configuration|setup|non-functional|architecture|deployment|migration|conversion)\b/i;
  var txt = function (v) { return v == null ? '' : String(v); };
  var keyOf = function (s, i) { return (s.n ? s.n : '#' + i) + ''; };

  function isTech(s, parent) { return TECH.test(txt(s.t)) || TECH.test(txt(parent && parent.t)); }

  function outline(doc, picked, filter, q) {
    var ss = (doc && doc.sections) || [];
    var on = {};
    (picked || []).forEach(function (k) { on[k] = true; });
    var words = txt(q).toLowerCase().split(/\s+/).filter(Boolean);
    var stack = [];
    return ss.map(function (s, i) {
      while (stack.length && stack[stack.length - 1].l >= (s.l || 1)) stack.pop();
      var parent = stack[stack.length - 1] || null;
      // technical when its heading or a heading above it says so
      var tech = isTech(s, parent) || stack.some(function (p) { return isTech(p); });
      stack.push(s);
      return { n: txt(s.n), t: txt(s.t), l: s.l || 1, key: keyOf(s, i), tech: tech, on: !!on[keyOf(s, i)], chars: txt(s.x).length, parent: parent ? ((parent.n ? parent.n + ' ' : '') + parent.t) : '' };
    }).filter(function (r) {
      if (filter === 'technical' && !r.tech) return false;
      if (filter === 'functional' && r.tech) return false;
      if (words.length) { var hay = (r.n + ' ' + r.t + ' ' + r.parent).toLowerCase(); return words.every(function (w) { return hay.indexOf(w) !== -1; }); }
      return true;
    });
  }

  function suggest(doc, text) {
    var ss = (doc && doc.sections) || [];
    if (!ss.length || !txt(text).trim()) return [];
    var r = FX.pick(doc, { summary: text, body: text }, { budget: 24000 });
    return r.picked.map(function (p) {
      var i = -1;
      ss.some(function (s, j) { if (s.n === p.n && s.t === p.t) { i = j; return true; } return false; });
      return i === -1 ? '' : keyOf(ss[i], i);
    }).filter(Boolean);
  }

  function text(doc, picked, notes) {
    var ss = (doc && doc.sections) || [];
    var keys = picked || [];
    var parts = [];
    var used = 0, budget = 30000;
    var name = doc ? (txt(doc.name) + (doc.version ? ' v' + doc.version : '')) : '';
    ss.forEach(function (s, i) {
      if (keys.indexOf(keyOf(s, i)) === -1 || used >= budget) return;
      var head = '### FDD ' + (name ? name + ' — ' : '') + (s.n ? s.n + ' ' : '') + s.t;
      var x = txt(s.x).trim() || '(no text under this heading)';
      if (used + head.length + x.length > budget) x = x.slice(0, Math.max(0, budget - used - head.length - 12)) + ' … (cut)';
      parts.push(head + '\n' + x);
      used += head.length + x.length + 2;
    });
    var n = txt(notes).trim();
    if (n) parts.push('### Notes and rules from the person\n' + n.slice(0, 8000));
    return parts.join('\n\n');
  }

  function summary(kb, doc) {
    var k = kb || {};
    var n = (k.sections || []).length;
    var bits = [];
    if (n) bits.push(n + ' FDD section' + (n === 1 ? '' : 's') + (k.fddLabel ? ' of ' + k.fddLabel : (doc && doc.name ? ' of ' + doc.name : '')));
    if (txt(k.notes).trim()) bits.push('your notes');
    return bits.length ? bits.join(' + ') : 'nothing yet';
  }

  return { outline: outline, suggest: suggest, text: text, summary: summary, isTech: isTech };
});
