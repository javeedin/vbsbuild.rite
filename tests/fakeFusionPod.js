'use strict';
/**
 * A stand-in Oracle Fusion pod for Fusion SQL's tests: BI Publisher's ReportService (runReport) and CatalogService
 * (createFolder, uploadObject, deleteObject) over SOAP, as a pod answers them. runReport only works once the runner
 * report is in its catalog (deploy it, or start with `runner: true`); the statement arrives base64 in P_QRY_STMT, as
 * the runner's data model receives it, and is answered from a tiny data dictionary and an AP_INVOICES_ALL table — a
 * DBMS_XMLGEN ROWSET XML-escaped once inside RESULT (XML output) or with real tags in a CSV field (CSV output).
 *
 *   const pod = await start({ user, password, runner, tables, csvOnly })  →  { url, calls, sql, catalog, close() }
 *     calls     every SOAP call: { service, op, format, sql }
 *     sql       every statement run (decoded)
 *     catalog   { path: { type, entry, xml } } — what deploy uploaded
 */
const http = require('http');
const zlib = require('zlib');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tag = (xml, name) => { const m = new RegExp('<(?:\\w+:)?' + name + '>([\\s\\S]*?)</(?:\\w+:)?' + name + '>').exec(xml); return m ? m[1] : null; };
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** One file out of a stored or deflated ZIP (enough for what uploadObject receives). */
function unzipOne(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) return null;
  const method = buf.readUInt16LE(8), size = buf.readUInt32LE(18), nlen = buf.readUInt16LE(26), xlen = buf.readUInt16LE(28);
  const name = buf.slice(30, 30 + nlen).toString('utf8');
  const data = buf.slice(30 + nlen + xlen, 30 + nlen + xlen + size);
  return { name, text: (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8') };
}

const FUSION_TABLES = ['AP_INVOICES_ALL', 'AP_INVOICE_LINES_ALL', 'AP_SUPPLIERS', 'POZ_SUPPLIERS', 'RA_CUSTOMER_TRX_ALL', 'HZ_PARTIES', 'HZ_CUST_ACCOUNTS', 'GL_CODE_COMBINATIONS', 'DOO_HEADERS_ALL'];
const COLUMNS = {
  AP_INVOICES_ALL: [['INVOICE_ID', 'NUMBER(18)', 'N', 'Invoice identifier'], ['INVOICE_NUM', 'VARCHAR2(50)', 'N', 'Invoice number'], ['VENDOR_ID', 'NUMBER(18)', 'Y', 'Supplier'],
    ['INVOICE_AMOUNT', 'NUMBER', 'Y', 'Amount'], ['DESCRIPTION', 'VARCHAR2(240)', 'Y', ''], ['INVOICE_DATE', 'DATE', 'Y', '']],
  POZ_SUPPLIERS: [['VENDOR_ID', 'NUMBER(18)', 'N', ''], ['SEGMENT1', 'VARCHAR2(30)', 'N', 'Supplier number'], ['PARTY_ID', 'NUMBER(18)', 'N', '']],
};
// made-up rows: special characters, a NULL, a long id that must stay text, a code with a leading zero
const INVOICES = [
  { INVOICE_ID: '300000012345678', INVOICE_NUM: 'INV-1001', VENDOR_ID: '5001', INVOICE_AMOUNT: '12500.5', DESCRIPTION: 'Steel <rods> & "bolts"\nline two', INVOICE_DATE: '2026-11-02' },
  { INVOICE_ID: '300000012345679', INVOICE_NUM: 'INV-1002', VENDOR_ID: '5002', INVOICE_AMOUNT: '980', INVOICE_DATE: '2026-11-03' },
  { INVOICE_ID: '300000012345680', INVOICE_NUM: '0042', VENDOR_ID: '5001', INVOICE_AMOUNT: '15000', DESCRIPTION: 'Crane hire', INVOICE_DATE: '2026-11-04' },
  { INVOICE_ID: '12345678901234567890', INVOICE_NUM: 'INV-1004', VENDOR_ID: '5003', INVOICE_AMOUNT: '420.25', DESCRIPTION: 'Paint', INVOICE_DATE: '2026-11-05' },
];

function rowset(rows) {
  if (!rows.length) return '';
  return '<ROWSET>' + rows.map((r) => '<ROW>' + Object.keys(r).map((k) => (r[k] === null || r[k] === undefined ? '' : '<' + k.replace(/\(/g, '_x0028_').replace(/\*/g, '_x002A_').replace(/\)/g, '_x0029_') + '>' + esc(r[k]) + '</' + k.replace(/\(/g, '_x0028_').replace(/\*/g, '_x002A_').replace(/\)/g, '_x0029_') + '>')).join('') + '</ROW>').join('') + '</ROWSET>';
}

/** The tiny database: what a statement gives (the runner's own row cap applied). */
function answer(sql, o) {
  const cap = /\)\s*WHERE ROWNUM <= (\d+)\s*$/.exec(sql);
  const check = /\)\s*WHERE 1 = 0\s*$/.test(sql);
  const inner = sql.replace(/^SELECT \* FROM \(\n/, '').replace(/\n\) WHERE (ROWNUM <= \d+|1 = 0)\s*$/, '');
  const limit = (rows) => (cap ? rows.slice(0, Number(cap[1])) : rows);
  const U = inner.toUpperCase();
  if (/BAD_COL/.test(U)) return { error: 'ORA-00904: "BAD_COL": invalid identifier' };
  if (/\bXX_SECRET\b/.test(U)) return { error: 'ORA-00942: table or view does not exist' };
  if (check) return { rows: [] };
  if (/^SELECT 1 AS N FROM DUAL$/.test(U.trim())) return { rows: [{ N: '1' }] };
  if (/FROM ALL_USERS/.test(U)) return { rows: limit(['APPS', 'FUSION', 'FUSION_RO'].map((u) => ({ USERNAME: u }))) };
  if (/FROM ALL_OBJECTS/.test(U) && /ROW_NUMBER\(\)/.test(U)) {
    const owner = (/OWNER = '([^']+)'/.exec(U) || [])[1];
    const type = (/OBJECT_TYPE = '([^']+)'/.exec(U) || [])[1];
    const span = /RN BETWEEN (\d+) AND (\d+)/.exec(U);
    let names = owner === 'FUSION' && type === 'TABLE' ? FUSION_TABLES.concat(o.tables || []) : owner === 'FUSION' && type === 'VIEW' ? ['AP_INVOICES_V'] : [];
    names = names.slice().sort();
    return { rows: limit(names.slice(Number(span[1]) - 1, Number(span[2])).map((n) => ({ OBJECT_NAME: n }))) };
  }
  if (/FROM ALL_OBJECTS/.test(U) && /UPPER\(OBJECT_NAME\) LIKE/.test(U)) {
    const pats = [];
    U.replace(/LIKE '([^']+)'/g, (m, p) => { pats.push(new RegExp('^' + p.replace(/\\([%_\\])/g, '$1').replace(/%/g, '.*').replace(/_/g, '.') + '$')); return m; });
    const all = FUSION_TABLES.concat(o.tables || []);
    return { rows: limit(all.filter((n) => pats.some((p) => p.test(n))).map((n) => ({ OWNER: 'FUSION', OBJECT_NAME: n, OBJECT_TYPE: 'TABLE' }))) };
  }
  if (/FROM ALL_OBJECTS WHERE OBJECT_NAME = '/.test(U)) {
    const n = (/OBJECT_NAME = '([^']+)'/.exec(U) || [])[1];
    return { rows: FUSION_TABLES.indexOf(n) !== -1 ? [{ OWNER: 'FUSION', OBJECT_TYPE: 'TABLE' }] : [] };
  }
  if (/FROM ALL_TAB_COLUMNS C/.test(U)) {
    const n = (/C\.TABLE_NAME = '([^']+)'/.exec(U) || [])[1];
    return { rows: limit((COLUMNS[n] || []).map((c) => ({ COLUMN_NAME: c[0], DATA_TYPE: c[1], NULLABLE: c[2], COMMENTS: c[3] || null }))) };
  }
  if (/FROM ALL_TAB_COLUMNS WHERE UPPER\(COLUMN_NAME\)/.test(U)) {
    return { rows: [{ OWNER: 'FUSION', TABLE_NAME: 'AP_INVOICES_ALL', COLUMN_NAME: 'VENDOR_ID', DATA_TYPE: 'NUMBER' }, { OWNER: 'FUSION', TABLE_NAME: 'POZ_SUPPLIERS', COLUMN_NAME: 'VENDOR_ID', DATA_TYPE: 'NUMBER' }] };
  }
  if (/FROM ALL_INDEXES I/.test(U)) {
    const n = (/I\.TABLE_NAME = '([^']+)'/.exec(U) || [])[1];
    return { rows: n === 'AP_INVOICES_ALL' ? [{ INDEX_NAME: 'AP_INVOICES_U1', UNIQUENESS: 'UNIQUE', COLUMNS: 'INVOICE_ID' }, { INDEX_NAME: 'AP_INVOICES_N1', UNIQUENESS: 'NONUNIQUE', COLUMNS: 'VENDOR_ID, INVOICE_DATE' }] : [] };
  }
  if (/FROM ALL_CONSTRAINTS C/.test(U)) {
    const n = (/C\.TABLE_NAME = '([^']+)'/.exec(U) || [])[1];
    return { rows: n === 'AP_INVOICES_ALL' ? [{ FK_NAME: 'AP_INVOICES_FK1', FK_COLUMNS: 'VENDOR_ID', REF_TABLE: 'FUSION.POZ_SUPPLIERS' }] : [] };
  }
  if (/FROM ALL_TAB_COMMENTS/.test(U)) {
    const n = (/TABLE_NAME = '([^']+)'/.exec(U) || [])[1];
    return { rows: n === 'AP_INVOICES_ALL' ? [{ COMMENTS: 'Payables invoices' }] : [] };
  }
  if (/FROM AP_INVOICES_ALL/.test(U)) {
    let rows = INVOICES.slice();
    const vend = /VENDOR_ID = (\d+|NULL|'[^']*')/.exec(U);
    if (vend && vend[1] !== 'NULL') rows = rows.filter((r) => r.VENDOR_ID === vend[1].replace(/'/g, ''));
    if (/COUNT\(\*\)/.test(U)) return { rows: [{ 'COUNT(*)': String(rows.length) }] };
    const cols = /^SELECT\s+(.*?)\s+FROM/is.exec(inner);
    if (cols && cols[1].trim() !== '*') {
      const want = cols[1].split(',').map((c) => c.trim().toUpperCase().split(/\s+/).pop());
      rows = rows.map((r) => { const d = {}; want.forEach((c) => { d[c] = r[c] === undefined ? null : r[c]; }); return d; });
    }
    return { rows: limit(rows) };
  }
  return { error: 'ORA-00942: table or view does not exist' };
}

function soap(body) {
  return '<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>' + body + '</soapenv:Body></soapenv:Envelope>';
}
const fault = (text) => soap('<soapenv:Fault><faultcode>soapenv:Server</faultcode><faultstring>' + esc(text) + '</faultstring></soapenv:Fault>');

async function start(opts) {
  const o = Object.assign({ user: 'BI.TESTER', password: 'p@ss<word>&1', runner: false }, opts || {});
  const calls = [], sqls = [];
  const catalog = {};
  const folders = {};
  const reportPath = '/Custom/BuildRite/QueryRunner.xdo';
  if (o.runner) catalog[o.runnerPath || reportPath] = { type: 'xdoz', entry: '_report.xdo', xml: '<report/>' };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (status, xml) => { res.writeHead(status, { 'Content-Type': 'text/xml; charset=utf-8' }); res.end(xml); };
      const op = String(req.headers.soapaction || '').replace(/"/g, '');
      if (req.url === '/xmlpserver/services/v2/ReportService') {
        const user = unesc(tag(body, 'userID') || ''), pass = unesc(tag(body, 'password') || '');
        const fmt = tag(body, 'attributeFormat');
        const path = unesc(tag(body, 'reportAbsolutePath') || '');
        const b64 = (/<v2:name>P_QRY_STMT<\/v2:name>\s*<v2:values>\s*<v2:item>([^<]*)<\/v2:item>/.exec(body) || [])[1] || '';
        const sql = Buffer.from(b64, 'base64').toString('utf8');
        calls.push({ service: 'ReportService', op, format: fmt, sql });
        if (user !== o.user || pass !== o.password) return send(500, fault('Failed to authenticate: invalid user name or password.'));
        if (!catalog[path]) return send(500, fault('oracle.xdo.webservice.exception.OperationFailedException: PublicReportService::executeRunReport Failure: Report ' + path + ' not found'));
        // a report whose layout gives nothing in XML (no bytes, no fault): the client must try CSV
        if (o.csvOnly && fmt === 'xml') return send(200, soap('<ns2:runReportResponse xmlns:ns2="http://xmlns.oracle.com/oxp/service/v2"><ns2:runReportReturn><ns2:reportContentType>text/xml</ns2:reportContentType></ns2:runReportReturn></ns2:runReportResponse>'));
        sqls.push(sql);
        const a = answer(sql, o);
        let decoded;
        if (a.error) decoded = '<DATA_DS><P_QRY_STMT>' + b64 + '</P_QRY_STMT><G_1><RESULT>' + esc(a.error) + '</RESULT></G_1></DATA_DS>';
        else if (fmt === 'csv') decoded = 'RESULT\n"' + rowset(a.rows).replace(/"/g, '""') + '"\n';
        else decoded = '<DATA_DS><P_QRY_STMT>' + b64 + '</P_QRY_STMT><G_1>' + (a.rows.length ? '<RESULT>' + esc(rowset(a.rows)) + '</RESULT>' : '<RESULT/>') + '</G_1></DATA_DS>';
        if (a.error && /ORA-00904/.test(a.error)) return send(500, fault('oracle.xdo.XDOException: java.sql.SQLSyntaxErrorException: ' + a.error));
        return send(200, soap('<ns2:runReportResponse xmlns:ns2="http://xmlns.oracle.com/oxp/service/v2"><ns2:runReportReturn><ns2:reportBytes>' + Buffer.from(decoded, 'utf8').toString('base64')
          + '</ns2:reportBytes><ns2:reportContentType>text/xml</ns2:reportContentType></ns2:runReportReturn></ns2:runReportResponse>'));
      }
      if (req.url === '/xmlpserver/services/v2/CatalogService') {
        const user = unesc(tag(body, 'userID') || ''), pass = unesc(tag(body, 'password') || '');
        const basic = Buffer.from(String(req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString('utf8');
        calls.push({ service: 'CatalogService', op, basic });
        if (user !== o.user || pass !== o.password) return send(500, fault('Failed to authenticate.'));
        if (o.noAuthor) return send(500, fault('oracle.xdo.webservice.exception.AccessDeniedException: no permission to create objects'));
        if (op === 'createFolder') {
          const f = unesc(tag(body, 'folderAbsolutePath'));
          if (folders[f]) return send(500, fault('Folder ' + f + ' already exists'));
          folders[f] = true;
          return send(200, soap('<ns2:createFolderResponse xmlns:ns2="v2"><ns2:createFolderReturn>' + esc(f) + '</ns2:createFolderReturn></ns2:createFolderResponse>'));
        }
        if (op === 'uploadObject') {
          const p = unesc(tag(body, 'reportObjectAbsolutePathURL'));
          if (catalog[p]) return send(500, fault('Object ' + p + ' already exists'));
          const z = unzipOne(Buffer.from(tag(body, 'objectZippedData'), 'base64'));
          if (!z) return send(500, fault('Invalid zip'));
          catalog[p] = { type: tag(body, 'objectType'), entry: z.name, xml: z.text };
          return send(200, soap('<ns2:uploadObjectResponse xmlns:ns2="v2"><ns2:uploadObjectReturn>' + esc(p) + '</ns2:uploadObjectReturn></ns2:uploadObjectResponse>'));
        }
        if (op === 'deleteObject') {
          const p = unesc(tag(body, 'objectAbsolutePath'));
          delete catalog[p];
          return send(200, soap('<ns2:deleteObjectResponse xmlns:ns2="v2"><ns2:deleteObjectReturn>true</ns2:deleteObjectReturn></ns2:deleteObjectResponse>'));
        }
        return send(500, fault('Unknown operation ' + op));
      }
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>Not Found</title></head><body>Not found</body></html>');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: 'http://127.0.0.1:' + server.address().port, calls, sql: sqls, catalog, user: o.user, password: o.password, reportPath,
    close: () => new Promise((r) => server.close(r)) };
}

module.exports = { start, answer, unzipOne };
