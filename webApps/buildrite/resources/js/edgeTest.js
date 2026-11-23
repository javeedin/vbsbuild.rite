define([], function () {
  'use strict';

  // Run an API-level edge path (Process Flows → Edge paths (AI) → a step's edge → "Run"): turn an edge case into a real
  // request by MUTATING the recorded happy-path request to the edge condition, then GRADE the response against what the
  // edge says should happen. Pure: no page, no DOM, no network — the chain resolves the page's API + its recorded call and
  // runs the plan through the API tester, this module only decides what to send and whether the answer passed.
  //
  //   classify(edge)   → { kind, expect }  kind: invalid-id | bad-input | duplicate | empty | generic | env (not runnable);
  //                       expect: { cls:'404'|'4xx'|'2xx'|'handled', label } or null (env / UI edge)
  //   runnable(edge)   → can this edge be exercised by an API call? (false for UI / outside-system edges)
  //   methodOf / pathOf(edge)   the method + path parsed from the edge's `stresses` ("POST /orders")
  //   plan(edge, req)  → { method, params, query, body, note, twice? } — the edge request from the happy-path req
  //   grade(expect, result)     → { verdict:'pass'|'fail'|'unknown'|'na', pass, text } for a run's { status, ok, rows, error }

  var S = function (v) { return v == null ? '' : String(v); };
  var BAD_ID = '-999999999';
  // Edges that an API call can't fairly prove (the UI, or an outside system being down / slow / a timing conflict).
  var ENV = /unavailable|times? ?out|timeout|\bdown\b|\bslow\b|network|outage|offline|concurren|conflict|session|expire|cancel|leaves|\bleave\b|navigat|\bback\b|fails to load|\bload\b|disabled while/;

  function methodOf(edge) { var m = /^\s*(GET|POST|PUT|PATCH|DELETE)\b/i.exec(S(edge && edge.stresses)); return m ? m[1].toUpperCase() : 'GET'; }
  function pathOf(edge) { var m = /(\/[^\s;,]*)/.exec(S(edge && edge.stresses)); return m ? m[1].replace(/[.,;]+$/, '') : ''; }

  function classify(edge) {
    var t = (S(edge && edge.name) + ' ' + S(edge && edge.trigger)).toLowerCase();
    if (!pathOf(edge) || ENV.test(t)) return { kind: 'env', expect: null };
    if (/identifier|not found|no longer exist|invalid id|missing id|bad id|\bid\b/.test(t)) return { kind: 'invalid-id', expect: { cls: '404', label: 'a 404 Not Found' } };
    if (/invalid|missing|required|validation|blank|out of range|boundary|malformed|too (long|large|big|many)/.test(t)) return { kind: 'bad-input', expect: { cls: '4xx', label: 'a 4xx rejection' } };
    if (/duplicate|twice|double/.test(t)) return { kind: 'duplicate', expect: { cls: 'handled', label: 'handled (one record / 409, not two)' } };
    if (/no result|no match|empty|nothing|no data|no record/.test(t)) return { kind: 'empty', expect: { cls: '2xx', label: 'a 2xx with no rows' } };
    return { kind: 'generic', expect: { cls: 'handled', label: 'handled cleanly (no 5xx)' } };
  }
  function runnable(edge) { return classify(edge).kind !== 'env'; }

  /** The edge request from the happy-path request: mutate it to the edge condition (break ids, empty the body…). */
  function plan(edge, req) {
    var r = req || {};
    var kind = classify(edge).kind;
    var out = { method: methodOf(edge), params: Object.assign({}, r.params || {}), query: S(r.query), body: S(r.body), note: '' };
    if (kind === 'invalid-id') {
      var keys = Object.keys(out.params);
      if (keys.length) { keys.forEach(function (k) { out.params[k] = BAD_ID; }); out.note = 'path id → ' + BAD_ID; }
      else out.note = 'no id in the path to break — edit the request below, then Run';
    } else if (kind === 'bad-input') {
      var b = out.body.trim();
      if (b && b.charAt(0) === '{') { out.body = '{}'; out.note = 'request body → {} (required fields missing)'; }
      else if (b) { out.body = ''; out.note = 'request body cleared (required fields missing)'; }
      else out.note = 'no request body captured — edit it to send invalid input, then Run';
    } else if (kind === 'duplicate') { out.note = 'the happy-path request, sent twice'; out.twice = true; }
    else if (kind === 'empty') { out.note = 'edit the query / body to match nothing, then Run'; }
    else out.note = 'the happy-path request';
    return out;
  }

  /** Grade a run against the edge's expectation. A 5xx always fails (an edge case should be handled, not crash). */
  function grade(expect, result) {
    if (!expect) return { verdict: 'na', pass: false, text: 'not an API edge — verify it by hand, then tick it covered' };
    var res = result || {};
    if (res.status === null || res.status === undefined || res.status === '') return { verdict: 'unknown', pass: false, text: 'no HTTP status came back' + (res.error ? ': ' + res.error : '') };
    var s = Number(res.status);
    if (s >= 500) return { verdict: 'fail', pass: false, text: 'the server errored (' + s + ') — an edge case should be handled cleanly, not crash' };
    if (expect.cls === '404') return s === 404 ? { verdict: 'pass', pass: true, text: 'rejected with 404 as expected' } : { verdict: 'fail', pass: false, text: 'expected 404, got ' + s };
    if (expect.cls === '4xx') {
      if (s >= 400 && s < 500) return { verdict: 'pass', pass: true, text: 'rejected with ' + s + ' as expected' };
      if (s >= 200 && s < 300) return { verdict: 'fail', pass: false, text: 'accepted (' + s + ') — the bad input was not rejected' };
      return { verdict: 'fail', pass: false, text: 'expected a 4xx, got ' + s };
    }
    if (expect.cls === '2xx') return (s >= 200 && s < 300) ? { verdict: 'pass', pass: true, text: 'returned ' + (res.rows != null ? res.rows + ' row(s)' : '2xx') } : { verdict: 'fail', pass: false, text: 'expected a 2xx, got ' + s };
    return (s < 500) ? { verdict: 'pass', pass: true, text: 'handled (' + s + ')' } : { verdict: 'fail', pass: false, text: 'not handled (' + s + ')' };
  }

  return { classify: classify, runnable: runnable, methodOf: methodOf, pathOf: pathOf, plan: plan, grade: grade, BAD_ID: BAD_ID };
});
