define([], function () {
  'use strict';

  // The sprint items table's filter + sort, shared by the page module (what the grid shows), the selection chain (so
  // "select all" ticks only the rows on screen, not the ones a column filter hides) and the follow-up/analyze chains
  // (so "copy all" means the rows on screen). Pure — no DOM, no `this`.
  var WHERE = { done: 'Done here', here: 'Still in this sprint', moved: 'Carried on' };
  function ci(s) { return String(s == null ? '' : s).toLowerCase(); }
  function has(hay, needle) { return !needle || ci(hay).indexOf(ci(needle)) >= 0; }
  function keyNum(k) { var m = /(\d+)\s*$/.exec(String(k || '')); return m ? parseInt(m[1], 10) : 0; }
  function whereOf(r) { return (WHERE[r && r.in] || '') + (r && r.sprintNow ? ' to ' + r.sprintNow : ''); }
  function labelsText(r) { var l = (r && r.labels) || []; return l.length ? l.join(', ') : 'No label'; }
  function fieldOf(r, col) {
    if (col === 'in') return whereOf(r);
    if (col === 'assignee') return (r && r.assignee) || 'Nobody';
    if (col === 'customer') return labelsText(r);
    return (r && r[col]) || '';
  }

  /** The items after the column filters and the chosen sort (Key sorts by story number). */
  function view(rows, f, sort) {
    f = f || {}; sort = sort || {};
    var list = (rows || []).filter(function (r) {
      return has(r.key, f.key) && has(r.summary, f.summary) && has(r.status, f.status)
        && has(whereOf(r), f.in) && has(r.sprint, f.sprint) && has((r.assignee || 'Nobody'), f.assignee)
        && has(labelsText(r), f.customer) && has(r.due, f.due) && has(r.resolved, f.resolved);
    });
    if (sort.col) {
      var dir = sort.dir === 'desc' ? -1 : 1;
      list = list.slice().sort(function (a, b) {
        var av; var bv;
        if (sort.col === 'key') { av = keyNum(a.key); bv = keyNum(b.key); } else { av = ci(fieldOf(a, sort.col)); bv = ci(fieldOf(b, sort.col)); }
        return (av < bv ? -1 : (av > bv ? 1 : 0)) * dir;
      });
    }
    return list;
  }

  /** The keys of the rows the filter/sort leave on screen. */
  function keys(rows, f, sort) { return view(rows, f, sort).map(function (r) { return r.key; }); }

  return { view: view, keys: keys, whereOf: whereOf, labelsText: labelsText, fieldOf: fieldOf };
});
