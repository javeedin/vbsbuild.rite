(function (factory) {
  'use strict';
  // the Fusion SQL screen (AMD, in the app) and the desktop app's engine (CommonJS, desktop/lib/fusionSql.js) share it
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
}(function () {
  'use strict';

  // Fusion SQL (Tools → Fusion SQL), the rules the screen and the engine share — no DOM, no network:
  //
  //   split(sql)                 [{ code, text }]: code, and the comments / strings / q'[…]' literals around it
  //   params(sql)                the {{NAME}} and :NAME placeholders in the code, first-seen order (not in strings)
  //   substitute(sql, values)    each placeholder → a literal: blank → NULL, a number as it is, a date → DATE 'YYYY-MM-DD'
  //                              (or TO_DATE with a time) unless the SQL wraps it in TO_DATE / TO_TIMESTAMP, else 'text'
  //   nullParams(sql)            every placeholder → NULL (to check that a statement compiles)
  //   parseDate(v, name)         a typed date in any common format → { iso, time } or null
  //   isId(column)               *_ID, *NUMBER, …: shown as text, never with thousands separators
  //   kinds(columns, rows)       { num: {col: true}, id: {col: true} }
  //   filter(rows, columns, q)   rows with q in any cell (case-insensitive); sort(rows, col, dir)
  //   keywords(question)         [{ t, w }]: words of a question and the Fusion table prefixes they mean
  //   score(name, terms)         how well a table name matches them (0 = not at all)
  //   view(res, { q, sortCol, sortDir, page })   one page of the grid as shown (100 rows), with its totals
  //   lastSql(text)              the last ```sql block of an AI answer
  //   lit(s)                     'text' with quotes doubled

  var RE_BRACE = /\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g;
  var RE_BIND = /(^|[^:\w$#]):([A-Za-z_][\w$#]*)/g;

  function lit(s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; }

  function split(sql) {
    var s = String(sql || '');
    var out = [], i = 0, start = 0, n = s.length;
    function push(code, end) { if (end > start) out.push({ code: code, text: s.slice(start, end) }); start = end; }
    while (i < n) {
      var c = s[i], c2 = s.substr(i, 2), e;
      if (c2 === '--') { push(true, i); e = s.indexOf('\n', i); e = e < 0 ? n : e; push(false, e); i = e; continue; }
      if (c2 === '/*') { push(true, i); e = s.indexOf('*/', i + 2); e = e < 0 ? n : e + 2; push(false, e); i = e; continue; }
      if ((c === 'q' || c === 'Q') && s[i + 1] === "'" && i + 2 < n && !/[\w$#]/.test(s[i - 1] || '')) {
        push(true, i);
        var open = s[i + 2], close = { '[': ']', '{': '}', '(': ')', '<': '>' }[open] || open;
        e = s.indexOf(close + "'", i + 3); e = e < 0 ? n : e + 2;
        push(false, e); i = e; continue;
      }
      if (c === "'" || c === '"') {
        push(true, i);
        var j = i + 1;
        while (j < n) { if (s[j] === c) { if (s[j + 1] === c) { j += 2; continue; } j++; break; } j++; }
        push(false, j); i = j; continue;
      }
      i++;
    }
    push(true, n);
    return out;
  }

  function params(sql) {
    var seen = {}, list = [];
    split(sql).forEach(function (seg) {
      if (!seg.code) return;
      var m;
      RE_BRACE.lastIndex = 0;
      while ((m = RE_BRACE.exec(seg.text))) if (!seen[m[1].toUpperCase()]) { seen[m[1].toUpperCase()] = 1; list.push(m[1]); }
      RE_BIND.lastIndex = 0;
      while ((m = RE_BIND.exec(seg.text))) if (!seen[m[2].toUpperCase()]) { seen[m[2].toUpperCase()] = 1; list.push(m[2]); }
    });
    return list;
  }

  var MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function parseDate(v, name) {
    var t = String(v || '').trim().toUpperCase();
    var m, y, mo, d, time = null;
    var tm = t.match(/^(.*?)[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (tm) { t = tm[1].trim(); time = pad2(+tm[2]) + ':' + tm[3] + ':' + (tm[4] || '00'); }
    if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else if ((m = t.match(/^(\d{1,2})[-/. ]?([A-Z]{3})[A-Z]*[-/. ]?(\d{2}|\d{4})$/)) && MONTHS[m[2]]) { d = +m[1]; mo = MONTHS[m[2]]; y = +m[3]; if (y < 100) y += 2000; }
    else if (/DATE/i.test(name || '') && (m = t.match(/^(\d{4})(\d{2})(\d{2})$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else return null;
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    if (time && !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time)) return null;
    return { iso: y + '-' + pad2(mo) + '-' + pad2(d), time: time };
  }

  function literal(v, name, inToDate) {
    var s = v == null ? '' : String(v);
    var t = s.trim();
    if (t === '') return 'NULL';
    if (inToDate) return lit(t);
    var dv = parseDate(t, name);
    if (dv) return dv.time ? "TO_DATE('" + dv.iso + ' ' + dv.time + "','YYYY-MM-DD HH24:MI:SS')" : "DATE '" + dv.iso + "'";
    if (/^-?\d+(\.\d+)?$/.test(t)) return t;
    return lit(s);
  }
  function inToDateAt(text, offset) { return /TO_(DATE|TIMESTAMP)\s*\(\s*$/i.test(text.slice(0, offset)); }

  function substitute(sql, values) {
    var byUpper = {};
    Object.keys(values || {}).forEach(function (k) { byUpper[k.toUpperCase()] = values[k]; });
    return split(sql).map(function (seg) {
      if (!seg.code) return seg.text;
      var text = seg.text.replace(RE_BRACE, function (_, name, off, str) { return literal(byUpper[name.toUpperCase()], name, inToDateAt(str, off)); });
      return text.replace(RE_BIND, function (_, pre, name, off, str) { return pre + literal(byUpper[name.toUpperCase()], name, inToDateAt(str, off + pre.length)); });
    }).join('');
  }
  function nullParams(sql) { return substitute(sql, {}); }

  function isId(c) { return /(^|_)(ID|NUMBER|NUM|NO)$|ID$|NUMBER$/i.test(String(c || '')); }
  function kinds(columns, rows) {
    var num = {}, id = {};
    (columns || []).forEach(function (c) {
      id[c] = isId(c);
      var any = false, all = true;
      for (var i = 0; i < (rows || []).length && i < 500; i++) {
        var v = rows[i][c];
        if (v === '' || v == null) continue;
        any = true;
        if (typeof v !== 'number') { all = false; break; }
      }
      num[c] = any && all && !id[c];
    });
    return { num: num, id: id };
  }

  function filter(rows, columns, q) {
    var s = String(q || '').trim().toLowerCase();
    if (!s) return rows || [];
    return (rows || []).filter(function (r) { return (columns || []).some(function (c) { var v = r[c]; return v !== undefined && v !== null && String(v).toLowerCase().indexOf(s) !== -1; }); });
  }
  function sort(rows, col, dir) {
    if (!col) return rows || [];
    var d = dir < 0 ? -1 : 1;
    return (rows || []).slice().sort(function (a, b) {
      var x = a[col], y = b[col];
      var ex = x === undefined || x === null || x === '', ey = y === undefined || y === null || y === '';
      if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1; // blanks last, either way
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * d;
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * d;
    });
  }

  // ── Ask AI: which tables a question is about ──
  var SYNONYMS = {
    CUSTOMER: ['CUST', 'PARTY', 'HZ_'], SUPPLIER: ['VENDOR', 'POZ_', 'AP_SUPPLIER'], VENDOR: ['POZ_', 'AP_SUPPLIER'],
    INVOICE: ['RA_CUSTOMER_TRX', 'AP_INVOICES', 'TRX'], PAYMENT: ['AP_PAYMENT', 'CHECKS', 'PAYMENT_SCHEDULES'],
    RECEIVABLE: ['AR_', 'RA_', 'PAYMENT_SCHEDULES'], PAYABLE: ['AP_'], ACCOUNT: ['GL_CODE_COMBINATIONS'], JOURNAL: ['GL_JE'],
    LEDGER: ['GL_LEDGERS', 'GL_BALANCES'], TAX: ['ZX_'], BANK: ['CE_', 'IBY_'], ASSET: ['FA_'],
    ITEM: ['EGP_SYSTEM_ITEMS', 'ITEM'], ONHAND: ['INV_ONHAND', 'ONHAND'], INVENTORY: ['INV_'], SUBINVENTORY: ['INV_SECONDARY_INVENTORIES', 'SUBINV'],
    ORGANIZATION: ['INV_ORG_PARAMETERS', 'HR_ORGANIZATION'], LOT: ['INV_LOT'], ORDER: ['DOO_HEADERS', 'DOO_LINES', 'DOO_'],
    SALE: ['DOO_HEADERS', 'DOO_LINES', 'DOO_FULFILL_LINES'], PO: ['PO_HEADERS', 'PO_LINES'], PURCHASE: ['PO_'], REQUISITION: ['POR_'],
    RECEIPT: ['RCV_'], SHIPMENT: ['WSH_', 'DOO_FULFILL'], TRANSACTION: ['INV_MATERIAL_TXNS', 'TRX'], EMPLOYEE: ['PER_', 'PER_ALL_PEOPLE'],
    PERSON: ['PER_'], PROJECT: ['PJF_', 'PJC_'], PRICE: ['QP_'], CONTRACT: ['OKC_'], EXPENSE: ['EXM_'], COST: ['CST_']
  };
  var STOP = {};
  ('THE AND FOR WITH FROM THAT SHOW LIST GIVE ALL ARE WHICH WHAT WHERE HAVE THAN OLDER LAST MONTH DAYS GIVEN ABOVE BELOW EACH PER INTO THEIR '
    + 'OPEN TOTAL TOTALS COUNT NUMBER NEED WANT QUERY GET FIND BETWEEN DATE DATES TRY AGAIN PLEASE SQL DATA REPORT FETCH WRITE TODAY YEAR WEEK '
    + 'HOW MANY MUCH THIS THESE THOSE ONLY NOT ANY BUT ALSO USE USING TOP').split(' ').forEach(function (w) { STOP[w] = 1; });

  function keywords(q) {
    var words = (String(q || '').toUpperCase().match(/[A-Z][A-Z0-9_]{1,}/g) || []).filter(function (w) { return !STOP[w] && (w.length >= 3 || SYNONYMS[w]); });
    var terms = [], seen = {};
    function add(t, w) { if (!seen[t]) terms.push(seen[t] = { t: t, w: w }); else if (seen[t].w < w) seen[t].w = w; }
    words.forEach(function (w) {
      var stem = w.length > 3 ? w.replace(/(IES)$/, 'Y').replace(/([^S])S$/, '$1') : w;
      add(stem.length >= 3 ? stem : w, 1);
      (SYNONYMS[w] || SYNONYMS[stem] || []).forEach(function (syn) { add(syn, 3); });
    });
    return terms;
  }
  function score(name, terms) {
    var s = 0;
    var u = String(name || '').toUpperCase();
    (terms || []).forEach(function (t) { var i = u.indexOf(t.t); if (i === 0) s += 3 * t.w; else if (i > 0) s += t.w; });
    if (!s) return 0;
    return s - u.length / 100 - (/(_TL|_GT|_TMP|_INT|_BK|_BAK|_V\d*)$|^XX|_ARCH|_HIST|_STG|_INTERFACE/.test(u) ? 2 : 0);
  }

  /** One page of the result grid as it is shown: searched, sorted, numbers with separators (never an id), blanks as —. */
  var PAGE = 100;
  function view(res, v) {
    var r = res || {}, o = v || {};
    var cols = r.columns || [];
    var kk = r.kinds || kinds(cols, r.rows || []);
    var shown = sort(filter(r.rows || [], cols, o.q), o.sortCol, o.sortDir);
    var pages = Math.max(1, Math.ceil(shown.length / PAGE));
    var page = Math.min(Math.max(0, Number(o.page) || 0), pages - 1);
    var nf = typeof Intl !== 'undefined' ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 10 }) : null;
    var rows = shown.slice(page * PAGE, page * PAGE + PAGE).map(function (row, i) {
      return { key: String(page * PAGE + i), n: page * PAGE + i + 1, cells: cols.map(function (c, k) {
        var x = row[c];
        var blank = x === undefined || x === null || x === '';
        var t = blank ? '' : (kk.num[c] && typeof x === 'number' && nf ? nf.format(x) : String(x));
        return { key: String(k), t: t.length > 300 ? t.slice(0, 300) + '…' : t, full: blank ? 'NULL' : String(x), cls: (kk.num[c] ? 'nx-fsql-num' : '') + (kk.id[c] ? ' nx-fsql-id' : '') + (blank ? ' nx-fsql-null' : '') };
      }) };
    });
    return { cols: cols.map(function (c) { return { name: c, sort: o.sortCol === c ? (o.sortDir < 0 ? '▼' : '▲') : '', cls: kk.num[c] ? 'nx-fsql-num' : '' }; }),
      rows: rows, shown: shown.length, total: (r.rows || []).length, page: page, pages: pages,
      style: { gridTemplateColumns: '52px ' + (cols.length ? cols.map(function (c) { return kk.num[c] ? 'minmax(72px, 180px)' : 'minmax(90px, 320px)'; }).join(' ') : '1fr') } };
  }

  function lastSql(text) {
    var re = /```\s*sql\s*\n([\s\S]*?)```/gi, m, last = '';
    while ((m = re.exec(String(text || '')))) last = m[1];
    return last.trim().replace(/;\s*$/, '');
  }

  return { split: split, params: params, substitute: substitute, nullParams: nullParams, parseDate: parseDate, literal: literal, isId: isId, kinds: kinds,
    filter: filter, sort: sort, view: view, PAGE: PAGE, keywords: keywords, score: score, lastSql: lastSql, lit: lit, SYNONYMS: SYNONYMS };
}));
