(function (factory) {
  'use strict';
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else (this || window).InfoletAi = factory();
}(function () {
  'use strict';

  // Help the LLM design a dashboard. The model is asked for a short list of infolets, each a title + a plain-English
  // question; the SQL for each question is then written by the schema-aware "Ask AI" (sqlClient.aiAsk), not here, so no
  // table names are invented. This module only builds the plan prompt and parses the plan back — pure, no DOM, no network.

  var MAX = 6;
  var MARKER = 'BUILDRITE_DASHBOARD_PLAN';

  // messages for sqlClient.aiChat(system, user): a JSON array of { title, question }
  function planMessages(goal, hints) {
    var system = 'You design small business dashboards (' + MARKER + '). The user describes what they want to see; reply with ONLY a JSON array of ' +
      '3 to ' + MAX + ' items, each { "title": short chart name, "question": a plain-English question answerable by one SQL query }. ' +
      'Each question must stand alone (no "and", one measure by one dimension where possible: totals or counts by a category, by month, or a single number). ' +
      'Do not write SQL, do not name tables or columns — another step turns each question into SQL against the real schema. No prose, no markdown, only the JSON array.';
    var user = String(goal || '').trim() + (hints ? '\n\nContext: ' + String(hints).slice(0, 2000) : '');
    return { system: system, user: user };
  }

  function clip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // parse the LLM's answer (fenced ```json, a bare array, or { infolets: [...] }) into [{ title, question }]
  function parsePlan(text) {
    var t = String(text == null ? '' : text);
    var body = t;
    var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) body = fence[1];
    else {
      var a = body.indexOf('['), b = body.lastIndexOf(']');
      if (a >= 0 && b > a) body = body.slice(a, b + 1);
    }
    var data;
    try { data = JSON.parse(body); } catch (e) {
      // a last try: an object literal with an infolets array
      try { var m = t.match(/\{[\s\S]*\}/); data = m ? JSON.parse(m[0]) : null; } catch (e2) { data = null; }
    }
    var list = Array.isArray(data) ? data : (data && Array.isArray(data.infolets) ? data.infolets : (data && Array.isArray(data.items) ? data.items : []));
    var out = [];
    (list || []).forEach(function (x) {
      if (!x) return;
      var question = clip(x.question || x.ask || x.q || x.description || '', 240);
      if (!question) return;
      var title = clip(x.title || x.name || question, 60);
      out.push({ title: title, question: question });
    });
    return out.slice(0, MAX);
  }

  return { MAX: MAX, MARKER: MARKER, planMessages: planMessages, parsePlan: parsePlan };
}));
