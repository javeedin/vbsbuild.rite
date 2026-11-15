define([], function () {
  'use strict';

  // The shop's rules: an order's total and whether it can still change. Pure.
  function total(lines) { return (lines || []).reduce(function (s, l) { return s + (Number(l.qty) || 0) * (Number(l.price) || 0); }, 0); }
  function canChange(order) { return !!order && (order.status === 'DRAFT' || order.status === 'OPEN'); }
  // a BI Publisher report's rows: the base64 XML in reportBytes, one object per row element
  function decodeReportRows(body, rowTag) {
    var b64 = body && body.reportBytes ? body.reportBytes : '';
    var xml = b64 && typeof atob === 'function' ? atob(b64) : '';
    var rows = [];
    xml.replace(new RegExp('<' + rowTag + '>([\\s\\S]*?)</' + rowTag + '>', 'g'), function (m, inner) {
      var row = {};
      inner.replace(/<([A-Z0-9_]+)>([^<]*)<\/\1>/g, function (x, k, v) { row[k] = v; return x; });
      rows.push(row);
      return m;
    });
    return rows;
  }
  return { total: total, canChange: canChange, decodeReportRows: decodeReportRows };
});
