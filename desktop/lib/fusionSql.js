'use strict';
/**
 * Fusion SQL (Tools → Fusion SQL): read-only SQL against an Oracle Fusion Cloud pod, from this PC. Fusion gives no
 * database connection, so the SQL runs inside the pod through ONE BI Publisher report, the "query runner": its data
 * model takes the statement (base64) in P_QRY_STMT and runs it with DBMS_XMLGEN, which returns any query as one XML
 * ROWSET. Build.Rite sends runReport (BI Publisher's ReportService v2, SOAP) and reads the rows back. The schema browser
 * and Ask AI's look-ups are plain SELECTs on the data dictionary through the same runner. Ported from the WMS app's
 * Fusion SQL module (its fusionsql/ page and FusionSqlService.cs, design in its docs/Fusion_SQL_Technical_RD.md).
 *
 * Read-only by design: only SELECT / WITH (no inline PL/SQL), every statement wrapped in a ROWNUM cap, and BI Publisher
 * data models cannot change data anyway. It runs as the Fusion user it signs in with, and Fusion audits that user.
 *
 *   open({ file, cacheDir, encrypt, decrypt, fetch, appLogin, appPod, now }) → store
 *     file       the pods and saved queries (this app's data folder; never the project, never git)
 *     cacheDir   the schema cache, one file per pod
 *     encrypt / decrypt   the OS keychain (Electron safeStorage); without them a password is kept for this run only
 *     fetch      (url, init) → { status, text() } (the desktop app: Chromium's network stack, so the PC's proxy applies)
 *     appLogin   () → { user, password } | null: your app's login (File → Sign in for your app…), for pods set to use it
 *     appPod     () → 'https://….oraclecloud.com' | '': the pod your workspace's app calls, suggested for a new pod
 *
 *   settings()                       { pods (never a password; each with its last test), active, suggest: { url, appUser }, defaults, runnerSql }
 *   savePod(p) / removePod(id) / setActive(id)
 *   execute({ sql, rowLimit, pod, check, timeoutMs })   { ok, rows, columns, rowCount, capped, ms, warning } | { ok: false, error, raw, decoded }
 *   test(pod)                        SELECT 1 AS n FROM dual → { ok, ms, user, origin, error, hint }
 *   deploy(pod)                      the runner's folder, data model and report through CatalogService, then the test → { ok, steps, error, raw }
 *   calls(clear)                     the last 30 SOAP calls, passwords as ***
 *   owners / objects / search / detail / clearCache   the schema browser (cached per pod until Refresh)
 *   cacheInfo(pod)                   what the schema cache of a pod holds: { owners, lists, details, bytes, at }
 *   queries() / saveQuery(q) / removeQuery(id) / importQueries(list) / ranQuery(id)   saved queries, on this PC
 *   ask({ question, history, editorSql, pod, askId }, chat)   Ask AI (below) → { ok, text, sql, checked, checkError, steps }
 *   progress(askId)                  the steps of an Ask AI still running
 *
 * Pure helpers (exported for tests): validate, capSql, checkSql, runReportEnvelope, readSoap, parseRows, parseCsv, coerce,
 * columnsOf, diagnose, dataModelXml, reportXml, zipStore, redact, xmlTree.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const K = require('../../webApps/buildrite/resources/js/fusionSqlKit.js');

const V2 = 'http://xmlns.oracle.com/oxp/service/v2';
const MAX_CALLS = 30;
const MAX_LOGGED = 20000;
const DEFAULTS = { folderPath: '/Custom/BuildRite', dataModelPath: '/Custom/BuildRite/QueryRunnerDM.xdm', reportPath: '/Custom/BuildRite/QueryRunner.xdo',
  dataSource: 'ApplicationDB_FSCM', rowLimit: 100, timeoutMs: 120000, reportServicePath: '/xmlpserver/services/v2/ReportService', catalogServicePath: '/xmlpserver/services/v2/CatalogService' };
const KINDS = { TABLE: 'TABLE', VIEW: 'VIEW', MVIEW: 'MATERIALIZED VIEW', SYNONYM: 'SYNONYM', PROCEDURE: 'PROCEDURE', FUNCTION: 'FUNCTION', PACKAGE: 'PACKAGE',
  TRIGGER: 'TRIGGER', SEQUENCE: 'SEQUENCE', TYPE: 'TYPE' };
const PAGE = 5000;
const OBJECT_CEILING = 200000;

const str = (v) => (v == null ? '' : String(v));
const esc = (s) => str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const cut = (s, n) => { const t = str(s); return t.length > n ? t.slice(0, n) + '…' : t; };
const L = (s) => K.lit(s);
const clamp = (n, lo, hi, d) => { const x = Number(n); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d; };

// ── Statements ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** The statement as it will run, or why it may not: one SELECT / WITH, no inline PL/SQL. */
function validate(sql) {
  let stmt = str(sql).trim();
  while (stmt.endsWith(';')) stmt = stmt.slice(0, -1).trimEnd();
  if (stmt.endsWith('/')) stmt = stmt.slice(0, -1).trimEnd();
  if (!stmt) return { error: 'There is no statement to run.' };
  const body = stmt.replace(/^(\s*(--[^\n]*\n?|\/\*[\s\S]*?\*\/))*\s*/, '');
  if (!/^(select|with)\b/i.test(body)) return { error: 'Only SELECT and WITH statements run here: Fusion SQL is read-only.' };
  if (/^\s*with\s+(function|procedure)\b|\bpragma\s+autonomous_transaction\b/i.test(body)) return { error: 'Inline PL/SQL (WITH FUNCTION / PROCEDURE, PRAGMA AUTONOMOUS_TRANSACTION) is not allowed.' };
  // a second statement after a semicolon (outside strings and comments) would not run anyway: say so
  const code = K.split(stmt).filter((s) => s.code).map((s) => s.text).join(' ');
  if (/;\s*\S/.test(code)) return { error: 'One statement at a time: select the statement to run (or put the cursor in it).' };
  return { stmt };
}
/** The row cap. The line breaks matter: a last line ending in a -- comment would swallow the parenthesis (ORA-00907). */
const capSql = (stmt, cap) => 'SELECT * FROM (\n' + stmt + '\n) WHERE ROWNUM <= ' + cap;
/** Compiles it on the pod without reading a row. */
const checkSql = (stmt) => 'SELECT * FROM (\n' + stmt + '\n) WHERE 1 = 0';

// ── SOAP ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function runReportEnvelope(reportPath, b64, user, password, format) {
  return '<?xml version="1.0" encoding="utf-8"?>\n'
    + '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v2="' + V2 + '"><soapenv:Header/><soapenv:Body><v2:runReport><v2:reportRequest>'
    + '<v2:attributeFormat>' + format + '</v2:attributeFormat><v2:reportAbsolutePath>' + esc(reportPath) + '</v2:reportAbsolutePath>'
    + '<v2:sizeOfDataChunkDownload>-1</v2:sizeOfDataChunkDownload><v2:parameterNameValues><v2:listOfParamNameValues><v2:item><v2:name>P_QRY_STMT</v2:name>'
    + '<v2:values><v2:item>' + b64 + '</v2:item></v2:values></v2:item></v2:listOfParamNameValues></v2:parameterNameValues><v2:reportData/><v2:reportOutputPath/>'
    + '</v2:reportRequest><v2:userID>' + esc(user) + '</v2:userID><v2:password>' + esc(password) + '</v2:password></v2:runReport></soapenv:Body></soapenv:Envelope>';
}
function catalogEnvelope(op, inner, user, password) {
  return '<?xml version="1.0" encoding="utf-8"?>\n'
    + '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:pub="' + V2 + '"><soapenv:Header/><soapenv:Body><pub:' + op + '>'
    + inner + '<pub:userID>' + esc(user) + '</pub:userID><pub:password>' + esc(password) + '</pub:password></pub:' + op + '></soapenv:Body></soapenv:Envelope>';
}
const redact = (t) => str(t).replace(/(<(?:[\w-]+:)?password>)[\s\S]*?(<\/(?:[\w-]+:)?password>)/gi, '$1***$2');

// ── XML ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
function unescapeOnce(s) {
  return str(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(x?)([0-9A-Fa-f]+);/g, (m, x, n) => { try { return String.fromCodePoint(parseInt(n, x ? 16 : 10)); } catch (e) { return m; } })
    .replace(/&amp;/g, '&');
}
/** A small, strict XML reader: { name (no prefix), children, text } or null when the text is not well-formed XML. */
function xmlTree(text) {
  const t = str(text);
  const root = { name: '#doc', children: [], text: '' };
  const stack = [root];
  let i = 0;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(t))) {
    const between = t.slice(i, m.index);
    if (between.trim()) { if (stack.length === 1 || /</.test(between)) return null; stack[stack.length - 1].text += unescapeOnce(between); }
    i = re.lastIndex;
    if (m[1] !== undefined) { stack[stack.length - 1].text += m[1]; continue; }
    if (m[0].startsWith('<!--') || m[0].startsWith('<?') || m[0].startsWith('<!DOCTYPE')) continue;
    if (m[2]) {
      const top = stack.pop();
      if (!top || top === root || top.raw !== m[2]) return null;
      continue;
    }
    const node = { name: m[3].replace(/^[^:]*:/, ''), raw: m[3], children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!m[5]) stack.push(node);
  }
  if (t.slice(i).trim() || stack.length !== 1 || root.children.length !== 1) return null;
  return root.children[0];
}
function descendants(node, out) {
  (node.children || []).forEach((c) => { out.push(c); descendants(c, out); });
  return out;
}
/** A SOAP answer: the first <value> element's text, and the fault (an HTML page from a proxy or a sign-in page, said). */
function readSoap(text, valueName) {
  if (!str(text).trim()) return { value: null, fault: null };
  const tree = xmlTree(text);
  if (!tree) {
    const title = (/<title>([\s\S]*?)<\/title>/i.exec(text) || [])[1];
    return { value: null, fault: 'An answer that is not XML' + (title ? ' (' + title.trim() + ')' : '') + ': ' + cut(str(text).replace(/\s+/g, ' '), 200) };
  }
  if (/^html$/i.test(tree.name)) {
    const title = (/<title>([\s\S]*?)<\/title>/i.exec(text) || [])[1];
    return { value: null, fault: 'A web page came back instead of a SOAP answer' + (title ? ' (' + title.trim() + ')' : '') + ': is the address the pod\'s, and the user allowed to sign in?' };
  }
  const all = descendants(tree, [tree]);
  const v = all.filter((n) => n.name === valueName)[0];
  const f = all.filter((n) => n.name === 'faultstring')[0] || all.filter((n) => n.name === 'message')[0];
  return { value: v ? v.text : null, fault: f && f.text.trim() ? f.text.trim() : null };
}

// ── Rows ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Numbers of ≤ 15 significant digits become numbers; long ids, and codes with a leading zero ("0101"), stay text. */
function coerce(v) {
  const s = str(v);
  if (!s) return '';
  const n = s.replace(/,/g, '');
  if (n.length > 1 && ((n[0] === '0' && /\d/.test(n[1])) || (n.startsWith('-0') && n.length > 2 && /\d/.test(n[2])))) return s;
  if (/^-?\d{1,15}(\.\d+)?$/.test(n)) {
    const significant = n.replace('-', '').replace('.', '').replace(/^0+/, '').length;
    if (significant <= 15) return Number(n);
  }
  return s;
}
const decodeName = (tag) => str(tag).replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
const ENVELOPE = /^(RESULT|P_QRY_STMT)$/i;
const isEnvelopeKey = (k) => ENVELOPE.test(str(k).trim().replace(/^["﻿]+|["\r]+$/g, '').trim());

/** DBMS_XMLGEN's ROWSET, read textually: its tags are the column aliases, which need not be valid XML (COUNT(*)). */
function rowsetRows(frag) {
  const rows = [];
  const rowRe = /<ROW>([\s\S]*?)<\/ROW>/g;
  let r;
  while ((r = rowRe.exec(frag))) {
    const d = {};
    const colRe = /<([^\s<>/]+)>([\s\S]*?)<\/\1>|<([^\s<>/]+)\s*\/>/g;
    let c;
    while ((c = colRe.exec(r[1]))) {
      if (c[3]) continue; // <COL/> = NULL, left out as DBMS_XMLGEN does
      if (/<[^\s<>/]+>/.test(c[2])) continue; // a nested cursor: not a scalar
      d[decodeName(c[1])] = coerce(unescapeOnce(c[2]).trim());
    }
    rows.push(d);
  }
  return rows;
}
function extractRowset(t) {
  const start = t.indexOf('<ROWSET');
  if (start < 0) return null;
  const close = t.indexOf('>', start);
  if (close > start && t[close - 1] === '/') return [];
  const end = t.indexOf('</ROWSET>', start);
  if (end < 0) return null;
  let frag = t.slice(start, end + 9);
  let before = start - 1;
  while (before >= 0 && /\s/.test(t[before])) before--;
  if (before >= 0 && t[before] === '"') frag = frag.replace(/""/g, '"'); // inside a quoted CSV field
  return rowsetRows(frag);
}
/** RFC-4180 CSV: quoted fields, "" escapes, commas and line breaks inside quotes; first line = header. */
function parseCsv(text) {
  const t = str(text).replace(/^﻿/, '');
  const records = [];
  let field = '', rec = [], inQ = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQ) {
      if (ch === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { rec.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      rec.push(field); field = '';
      if (!(rec.length === 1 && rec[0] === '')) records.push(rec);
      rec = [];
    } else field += ch;
  }
  if (field || rec.length) { rec.push(field); records.push(rec); }
  if (!records.length) return null;
  const head = records[0].map((h) => h.trim());
  return records.slice(1).map((r) => { const d = {}; head.forEach((h, i) => { if (i < r.length && r[i] !== '') d[h] = coerce(r[i].trim()); }); return d; });
}
function genericRows(tree) {
  const groups = {};
  descendants(tree, [tree]).forEach((n) => { if (n.children.length && n.children.some((c) => !c.children.length)) (groups[n.name] = groups[n.name] || []).push(n); });
  const best = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length)[0];
  if (!best) return null;
  return groups[best].map((n) => { const d = {}; n.children.filter((c) => !c.children.length).forEach((c) => { d[c.name] = coerce(c.text.trim()); }); return d; });
}
function emptyEnvelope(t) {
  const tree = xmlTree(t);
  if (tree) return tree.name === 'DATA_DS' && descendants(tree, []).filter((n) => n.name === 'RESULT').every((n) => !n.text.trim());
  const lines = t.split('\n').map((l) => l.trim().replace(/^"|"$/g, '').trim()).filter(Boolean);
  return lines.length === 1 && lines[0] === 'RESULT';
}
/** The runner's answer (decoded reportBytes) → rows, or null when it is not understood (never its RESULT wrapper as data). */
function parseRows(decoded) {
  if (!str(decoded).trim()) return null;
  let t = str(decoded).replace(/^﻿/, '');
  for (let round = 0; round < 3; round++) {
    const rows = extractRowset(t);
    if (rows) return rows;
    if (t.indexOf('lt;ROWSET') < 0) break; // &lt; or &amp;lt;
    t = unescapeOnce(t);
  }
  if (emptyEnvelope(t)) return []; // DBMS_XMLGEN gives NULL for no rows
  const tree = xmlTree(t);
  let generic = tree ? genericRows(tree) : parseCsv(t);
  if (!generic || !generic.length) return generic;
  // a RESULT with text anywhere (an error the report put there) is not "no rows"
  const resultText = tree ? descendants(tree, [tree]).some((n) => n.name === 'RESULT' && n.text.trim())
    : generic.some((r) => Object.keys(r).some((k) => /^RESULT$/i.test(k.trim().replace(/^["\uFEFF]+|["\r]+$/g, '')) && str(r[k]).trim()));
  generic = generic.map((r) => { const d = {}; Object.keys(r).forEach((k) => { if (!isEnvelopeKey(k)) d[k] = r[k]; }); return d; }).filter((r) => Object.keys(r).length);
  return generic.length ? generic : resultText ? null : [];
}
/** Union of the keys, first seen first; a row that has every column (NULLs are left out) gives the true SELECT order. */
function columnsOf(rows) {
  const union = [];
  (rows || []).forEach((r) => Object.keys(r).forEach((k) => { if (union.indexOf(k) === -1) union.push(k); }));
  const full = (rows || []).filter((r) => Object.keys(r).length === union.length)[0];
  return full ? Object.keys(full) : union;
}
/** Why an answer has no rows: an Oracle error the report put in RESULT, an answer cut short, or what came back instead. */
function diagnose(decoded) {
  if (!str(decoded).trim()) return null;
  let t = str(decoded).replace(/<P_QRY_STMT>[^<]*<\/P_QRY_STMT>|<P_QRY_STMT\s*\/>/gi, '');
  for (let i = 0; i < 2 && t.indexOf('lt;') >= 0; i++) t = unescapeOnce(t);
  const ora = /ORA-\d{5}:[^<\r\n]{0,300}/.exec(t);
  if (ora) return 'Fusion answered with an Oracle error: ' + ora[0].trim();
  if (t.indexOf('<ROWSET') >= 0 && t.indexOf('</ROWSET>') < 0) return 'BI Publisher cut the answer short (' + t.length.toLocaleString('en-US') + ' characters, no end of the row set): ask for fewer rows or columns.';
  let text = t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || /^RESULT$/i.test(text)) return null;
  if (/^RESULT /i.test(text)) text = text.slice(7);
  if (/^(P_QRY_STMT[ ,]*)?(RESULT[ ,]*)?[A-Za-z0-9+/=\s,"]*$/.test(text) && !/\b(ORA|error|exception)\b/i.test(text)) return null;
  return 'Fusion answered without rows: ' + cut(text, 300);
}
function hint(error, b64) {
  const e = str(error);
  if (!e) return e;
  if (/ORA-17041/.test(e)) return e + '\n\nThe runner\'s data model uses a ref cursor: deploy the DBMS_XMLGEN runner again (Connection → Deploy the runner).';
  if (/ORA-00942/.test(e)) return e + '\n\nThe Fusion user\'s data roles do not cover this table or view.';
  if (/not found|does not exist|no access|AccessDeniedException|invalid report/i.test(e) && !/ORA-/.test(e)) return e + '\n\nIs the runner report there? Connection → Deploy the runner (needs BI Author once), or point Report path at an existing runner.';
  if (/401|authenticat|password|locked/i.test(e) && !/ORA-/.test(e)) return e + '\n\nThe pod refused the user or password.';
  if (b64 && b64.length > 4000 && /ORA-06502|ORA-01489|too long/.test(e)) return e + '\n\nThe statement is longer than the 4,000-byte SQL limit of most pods: shorten it.';
  return e;
}

// ── The runner's BI Publisher objects ───────────────────────────────────────────────────────────────────────────────
const RUNNER_SQL = "SELECT REGEXP_REPLACE(\n         DBMS_XMLGEN.getxml(\n           UTL_RAW.cast_to_varchar2(\n             UTL_ENCODE.base64_decode(UTL_RAW.cast_to_raw(:P_QRY_STMT))\n           )\n         ),\n"
  + "         '<\\?xml[^>]*\\?>', ''\n       ) AS result\nFROM dual";
function dataModelXml(dataSource) {
  const ds = esc(str(dataSource).trim() || 'ApplicationDB_FSCM');
  return "<?xml version = '1.0' encoding = 'utf-8'?>\n"
    + '<dataModel xmlns="http://xmlns.oracle.com/oxp/xmlp" version="2.0" xmlns:xdm="http://xmlns.oracle.com/oxp/xmlp" xmlns:xsd="http://www.w3.org/2001/XMLSchema" defaultDataSourceRef="' + ds + '">\n'
    + '   <description><![CDATA[Build.Rite Fusion SQL query runner (DBMS_XMLGEN)]]></description>\n   <dataProperties>\n'
    + '      <property name="include_parameters" value="true"/>\n      <property name="include_null_Element" value="false"/>\n'
    + '      <property name="include_rowsettag" value="false"/>\n      <property name="xml_tag_case" value="upper"/>\n'
    + '      <property name="generate_output_format" value="xml"/>\n      <property name="optimize_query_executions" value="false"/>\n'
    + '      <property name="sql_monitor_report_generated" value="false"/>\n      <property name="db_fetch_size" value="500"/>\n   </dataProperties>\n'
    + '   <dataSets>\n      <dataSet name="Q1" type="simple">\n         <sql dataSourceRef="' + ds + '" nsQuery="false" xmlRowTagName="G_1"><![CDATA[' + RUNNER_SQL + ']]></sql>\n      </dataSet>\n   </dataSets>\n'
    + '   <output rootName="DATA_DS" uniqueRowName="false">\n      <nodeList name="data-structure">\n         <dataStructure tagName="DATA_DS">\n'
    + '            <group name="G_1" label="G_1" source="Q1">\n               <element name="RESULT" value="RESULT" label="RESULT" dataType="xsd:string" breakOrder="" fieldOrder="1"/>\n'
    + '            </group>\n         </dataStructure>\n      </nodeList>\n   </output>\n   <eventTriggers/>\n   <lexicals/>\n   <valueSets/>\n'
    + '   <parameters>\n      <parameter name="P_QRY_STMT" defaultValue="" dataType="xsd:string" rowPlacement="1">\n         <input label="P_QRY_STMT"/>\n      </parameter>\n   </parameters>\n'
    + '   <bursting/>\n   <display>\n      <layouts>\n         <layout name="Q1" left="0px" top="0px"/>\n         <layout name="DATA_DS" left="0px" top="0px"/>\n      </layouts>\n      <groupLinks/>\n   </display>\n</dataModel>';
}
function reportXml(dataModelPath) {
  return "<?xml version = '1.0' encoding = 'utf-8'?>\n"
    + '<report xmlns="http://xmlns.oracle.com/oxp/xmlp" xmlns:xsd="http://www.w3.org/2001/XMLSchema" version="2.0" dataModel="true" useSubTemplate="false" cachePerUser="true" cacheSmartRefresh="false" cacheUserRefresh="false">\n'
    + '   <dataModel url="' + esc(dataModelPath) + '"/>\n   <description><![CDATA[Build.Rite Fusion SQL query runner]]></description>\n'
    + '   <property name="showControls" value="true"/>\n   <property name="showReportLinks" value="true"/>\n   <property name="openLinkInNewWindow" value="true"/>\n'
    + '   <property name="autoRun" value="true"/>\n   <property name="cacheDocument" value="false"/>\n   <property name="onlineReport" value="true"/>\n'
    + '   <property name="asyncReport" value="false"/>\n   <property name="enableBursting" value="false"/>\n'
    + '   <parameters paramPerLine="3" style="parameterLocation:horizontal;">\n      <parameter id="P_QRY_STMT" defaultValue="" dataType="xsd:string" rowPlacement="1">\n         <input label="P_QRY_STMT"/>\n      </parameter>\n   </parameters>\n</report>';
}
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
/** A ZIP of one file, stored (BI Publisher's uploadObject accepts it). */
function zipStore(name, content) {
  const data = Buffer.from(content, 'utf8');
  const n = Buffer.from(name, 'utf8');
  const crc = crc32(data);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 8); lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 10); ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(30 + n.length + data.length, 16);
  return Buffer.concat([lh, n, data, ch, n, end]);
}

// ── Ask AI ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const ASK_SYSTEM = [
  'You are an Oracle Fusion Cloud (SaaS) database expert inside a read-only SQL workbench (Oracle Database 19c). Queries run through a BI Publisher',
  'data model with DBMS_XMLGEN, as a BI user. Build.Rite can look things up in the data dictionary for you — never guess a table or a column.',
  '',
  'To look things up, answer with ONLY one ```lookup block holding a JSON array of up to 6 requests, nothing else. Build.Rite runs them and sends the',
  'results back. Requests:',
  '  {"tool":"search_objects","pattern":"AP_INVOICES%","type":"TABLE|VIEW|…(optional)"}   objects by name (any owner, % wildcards)',
  '  {"tool":"search_columns","column":"%CUSTOMER_TRX_ID%","table":"RA_%(optional)"}      which tables/views have a column',
  '  {"tool":"describe","name":"AP_INVOICES_ALL","owner":"FUSION(optional)"}               columns with types and comments, indexes, foreign keys',
  '  {"tool":"source","name":"PKG_NAME","type":"PACKAGE|PACKAGE BODY|VIEW|…","from":1}     PL/SQL source or a view\'s SQL, 200 lines from line "from"',
  '  {"tool":"dependencies","name":"OBJECT_NAME"}                                           what it uses and what uses it',
  '  {"tool":"sample","sql":"SELECT … FROM … WHERE …"}                                      a read-only SELECT, at most 5 rows back',
  'Ask for several things in one block when you know what you need. Never describe the same object twice; trust the STARTING HINTS.',
  '',
  'When you have verified what you need, answer for the user:',
  '1) To write SQL: exactly ONE read-only statement starting with SELECT or WITH, in a single ```sql block. {{PARAM_NAME}} tokens for filter values',
  '   the user did not give (blank means NULL, so NVL({{P}}, col) = col means "all"). Alias computed columns, TO_CHAR dates shown to people, no',
  '   trailing semicolon, no DML / DDL / PL/SQL, no WITH FUNCTION, under about 2,900 characters (the runner\'s limit). Owner-qualify objects not',
  '   owned by FUSION. After the block, at most three short bullets on joins and assumptions.',
  '2) To explain an object: what it does, its entry points and parameters, how to use it, a short example; say so when its source is hidden.',
  'If the question refers to the CURRENT EDITOR SQL, change or extend that query. Build.Rite checks your SQL on the pod before the user sees it;',
  'when the pod refuses it you get the error back: fix it (look things up again if you need to). Be concise.'].join('\n');
const MAX_ROUNDS = 7;
const MAX_FIXES = 2;

// ── The store ───────────────────────────────────────────────────────────────────────────────────────────────────────
function open(opts) {
  const o = opts || {};
  const file = o.file;
  const cacheDir = o.cacheDir || (file ? path.join(path.dirname(file), 'fusion-sql-cache') : '');
  const now = o.now || (() => new Date());
  const memPw = {}; // pod id → a password kept for this run only (no keychain on this PC)
  const callLog = [];
  const asks = {}; // askId → { steps, done, at }

  function read() {
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return { active: str(j.active), pods: Array.isArray(j.pods) ? j.pods : [], queries: Array.isArray(j.queries) ? j.queries : [] }; } catch (e) { return { active: '', pods: [], queries: [] }; }
  }
  function write(d) {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(d, null, 1), { mode: 0o600 });
  }
  const seal = (t) => (o.encrypt ? o.encrypt(t).toString('base64') : '');
  const unseal = (b) => { try { return b && o.decrypt ? o.decrypt(Buffer.from(b, 'base64')) : ''; } catch (e) { return ''; } };
  const originOf = (u) => { try { const x = new URL(str(u).trim()); return /^https?:$/.test(x.protocol) ? x.origin : ''; } catch (e) { return ''; } };
  const appLogin = () => { try { const l = o.appLogin && o.appLogin(); return l && l.user && l.password ? l : null; } catch (e) { return null; } };
  const appPod = () => { try { return originOf(o.appPod && o.appPod()); } catch (e) { return ''; } };

  function full(p) { return Object.assign({}, DEFAULTS, p || {}); }
  function publicPod(p, active) {
    const x = full(p);
    const app = appLogin();
    return { id: x.id, name: x.name, url: x.url, login: x.login === 'own' ? 'own' : 'app', username: x.login === 'own' ? str(x.username) : (app ? app.user : ''),
      hasPassword: x.login === 'own' ? !!(x.password || memPw[x.id]) : !!app, passwordKept: x.login === 'own' ? (x.password ? 'keychain' : memPw[x.id] ? 'this run' : 'none') : 'app',
      reportPath: x.reportPath, dataModelPath: x.dataModelPath, folderPath: x.folderPath, dataSource: x.dataSource, rowLimit: x.rowLimit, timeoutMs: x.timeoutMs,
      active: x.id === active, deployedAt: str(x.deployedAt), testedAt: str(x.testedAt), testOk: x.testOk === true, testMs: Number(x.testMs) || 0, testUser: str(x.testUser),
      testError: str(x.testError) };
  }
  function podOf(id) {
    const d = read();
    const want = str(id) || d.active;
    return d.pods.filter((p) => p.id === want)[0] || d.pods[0] || null;
  }
  function credentials(p) {
    if (p.login === 'own') return { user: str(p.username), password: memPw[p.id] || unseal(p.password), source: 'its own user' };
    const app = appLogin();
    return app ? { user: app.user, password: app.password, source: 'your app\'s login' } : { user: '', password: '', source: 'your app\'s login' };
  }

  function settings() {
    const d = read();
    const active = d.active && d.pods.some((p) => p.id === d.active) ? d.active : (d.pods[0] || {}).id || '';
    const app = appLogin();
    return { ok: true, active, pods: d.pods.map((p) => publicPod(p, active)), suggest: { url: appPod(), appUser: app ? app.user : '' }, defaults: Object.assign({}, DEFAULTS),
      keychain: !!o.encrypt, runnerSql: RUNNER_SQL };
  }
  function savePod(input) {
    const b = input || {};
    const d = read();
    const url = originOf(b.url);
    if (!url) return { ok: false, error: 'Give the pod\'s address, like https://xxxx.fa.em2.oraclecloud.com.' };
    if (!/^https:/.test(url) && !o.allowHttp) return { ok: false, error: 'Only https pod addresses are allowed.' };
    const login = b.login === 'own' ? 'own' : 'app';
    if (login === 'own' && !str(b.username).trim()) return { ok: false, error: 'Give the Fusion user name (or choose your app\'s login).' };
    const paths = ['folderPath', 'dataModelPath', 'reportPath'];
    for (const k of paths) if (b[k] !== undefined && str(b[k]).trim() && !/^\/[^<>&"]+$/.test(str(b[k]).trim())) return { ok: false, error: 'A catalog path starts with / (like /Custom/BuildRite/QueryRunner.xdo).' };
    if (b.reportPath && !/\.xdo$/i.test(str(b.reportPath).trim())) return { ok: false, error: 'The report path ends in .xdo.' };
    let rec = d.pods.filter((p) => p.id === b.id)[0];
    const isNew = !rec;
    if (!rec) { rec = { id: crypto.randomBytes(6).toString('hex') }; d.pods.push(rec); }
    const name = str(b.name).trim() || (new URL(url).host.split('.')[0] || 'Fusion').toUpperCase();
    if (d.pods.some((p) => p !== rec && str(p.name).toLowerCase() === name.toLowerCase())) return { ok: false, error: 'There is already a pod called ' + name + '.' };
    Object.assign(rec, { name, url, login, username: login === 'own' ? str(b.username).trim() : '' });
    paths.concat(['dataSource']).forEach((k) => { if (b[k] !== undefined) rec[k] = str(b[k]).trim() || DEFAULTS[k]; });
    if (b.rowLimit !== undefined) rec.rowLimit = clamp(b.rowLimit, 1, 100000, DEFAULTS.rowLimit);
    if (b.timeoutMs !== undefined) rec.timeoutMs = clamp(b.timeoutMs, 5000, 600000, DEFAULTS.timeoutMs);
    if (login === 'own' && str(b.password)) {
      const sealed = seal(str(b.password));
      if (sealed) { rec.password = sealed; delete memPw[rec.id]; } else { delete rec.password; memPw[rec.id] = str(b.password); }
    }
    if (login === 'app') { delete rec.password; delete memPw[rec.id]; }
    if (isNew && !d.active) d.active = rec.id;
    write(d);
    return { ok: true, id: rec.id, pod: publicPod(rec, d.active) };
  }
  function removePod(id) {
    const d = read();
    const before = d.pods.length;
    d.pods = d.pods.filter((p) => p.id !== id);
    if (d.pods.length === before) return { ok: false, error: 'There is no such pod.' };
    if (d.active === id) d.active = (d.pods[0] || {}).id || '';
    delete memPw[id];
    write(d);
    return { ok: true, active: d.active };
  }
  function setActive(id) {
    const d = read();
    if (!d.pods.some((p) => p.id === id)) return { ok: false, error: 'There is no such pod.' };
    d.active = id;
    write(d);
    return { ok: true, active: id };
  }
  function markPod(id, patch) { const d = read(); const p = d.pods.filter((x) => x.id === id)[0]; if (p) { Object.assign(p, patch); write(d); } }

  // ── SOAP calls, logged ──
  function record(e) { callLog.unshift(e); while (callLog.length > MAX_CALLS) callLog.pop(); }
  async function post(url, action, envelope, basic, timeoutMs, kind) {
    const t0 = Date.now();
    let status = 0, text = '', netError = '';
    const headers = { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"' + action + '"' };
    if (basic) headers.Authorization = 'Basic ' + basic;
    const ms = clamp(timeoutMs, 5000, 600000, DEFAULTS.timeoutMs);
    try {
      if (!/^https:\/\//i.test(url) && !o.allowHttp) throw new Error('Only https pod addresses are allowed.');
      if (typeof o.fetch !== 'function') throw new Error('This PC cannot make web calls here (the desktop app makes them).');
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
      try {
        const res = await o.fetch(url, { method: 'POST', headers, body: envelope, signal: ctrl ? ctrl.signal : undefined });
        status = res.status;
        text = await res.text();
      } finally { if (timer) clearTimeout(timer); }
    } catch (e) {
      netError = /abort/i.test(str(e && (e.name || e.message))) ? 'No answer in ' + Math.round(ms / 1000) + ' s: narrow the query or raise the time limit (Connection).' : 'Could not reach the pod: ' + str((e && e.message) || e);
    }
    record({ at: now().toISOString(), kind, url, status, ms: Date.now() - t0,
      headers: Object.keys(headers).map((k) => k + ': ' + (k === 'Authorization' ? 'Basic <base64 user:password>' : headers[k])).join('\n'),
      request: cut(redact(envelope), MAX_LOGGED), response: cut(netError || redact(text), MAX_LOGGED), decoded: '' });
    return { status, text, netError };
  }
  async function runReport(p, cred, b64, format, timeoutMs) {
    const r = await post(p.url + p.reportServicePath, 'runReport', runReportEnvelope(p.reportPath, b64, cred.user, cred.password, format), null, timeoutMs || p.timeoutMs, 'runReport (' + format + ')');
    const out = { status: r.status, raw: cut(r.text, 1200), bytes: null, fault: null };
    if (r.netError) { out.fault = r.netError; return out; }
    const s = readSoap(r.text, 'reportBytes');
    out.bytes = str(s.value).replace(/\s/g, '') || null;
    if (!out.bytes) out.fault = s.fault || (r.status >= 400 ? 'HTTP ' + r.status : null);
    return out;
  }
  const decode64 = (b) => { try { return Buffer.from(b, 'base64').toString('utf8'); } catch (e) { return ''; } };
  function annotate(decoded) { if (callLog[0]) callLog[0].decoded = cut(redact(decoded), MAX_LOGGED); }

  async function execute(req) {
    const t0 = Date.now();
    const q = req || {};
    const v = validate(q.sql);
    if (v.error) return { ok: false, error: v.error };
    const rec = podOf(q.pod);
    if (!rec) return { ok: false, error: 'Add a Fusion pod first (Connection).', noPod: true };
    const p = full(rec);
    const cred = credentials(p);
    if (!cred.user || !cred.password) {
      return { ok: false, needsLogin: true, error: p.login === 'own' ? 'No password for ' + (cred.user || 'its user') + ' on this PC: enter it in Connection.'
        : 'No app login on this PC: File → Sign in for your app… (or give this pod its own Fusion user in Connection).' };
    }
    const cap = q.check ? 0 : clamp(q.rowLimit || p.rowLimit, 1, 100000, DEFAULTS.rowLimit);
    const sql = q.check ? checkSql(v.stmt) : capSql(v.stmt, cap);
    const b64 = Buffer.from(sql, 'utf8').toString('base64');
    const timeoutMs = q.timeoutMs ? Math.max(Number(q.timeoutMs), p.timeoutMs) : p.timeoutMs;
    const done = (r) => Object.assign(r, { ms: Date.now() - t0, pod: p.name, user: cred.user });

    const xml = await runReport(p, cred, b64, 'xml', timeoutMs);
    let rows = null, decoded = null;
    if (xml.bytes) { decoded = decode64(xml.bytes); annotate(decoded); rows = parseRows(decoded); }
    if (rows === null && !xml.fault) {
      // CSV only when XML gave neither data nor a fault: an XML fault (ORA-00904…) is the real error
      const csv = await runReport(p, cred, b64, 'csv', timeoutMs);
      if (csv.bytes) { const d2 = decode64(csv.bytes); annotate(d2); rows = parseRows(d2); decoded = decoded || d2; }
      else if (!xml.bytes) return done({ ok: false, error: hint(csv.fault || 'HTTP ' + csv.status, b64), raw: csv.raw });
    }
    if (rows && rows.length && rows.every((r) => Object.keys(r).every(isEnvelopeKey))) {
      const why = diagnose(decoded);
      if (why && !/^Fusion answered without rows/.test(why)) return done({ ok: false, error: hint(why, b64), raw: xml.raw, decoded: cut(decoded, 3000) });
      rows = [];
    }
    if (rows === null && !xml.fault) {
      const why = diagnose(decoded);
      if (why) return done({ ok: false, error: hint(why, b64), raw: xml.raw, decoded: cut(decoded, 3000) });
    }
    if (rows === null) {
      return done({ ok: false, error: hint(xml.fault || (decoded ? 'The runner report answered, but not with a DBMS_XMLGEN row set: its layout changes the data. Deploy the runner again (Connection) so it is a data-only report.' : 'HTTP ' + xml.status), b64),
        raw: xml.raw, decoded: cut(decoded, 3000) });
    }
    if (!rows.length && decoded) {
      // no rows, but an Oracle error in the answer: that is the answer
      const why = diagnose(decoded);
      if (why && /Oracle error/.test(why)) return done({ ok: false, error: hint(why, b64), raw: xml.raw, decoded: cut(decoded, 3000) });
    }
    const out = { ok: true, rows, columns: columnsOf(rows), rowCount: rows.length, capped: !q.check && rows.length >= cap, cap };
    if (b64.length > 4000) out.warning = 'The statement is long (' + b64.length + ' bytes as sent): pods without MAX_STRING_SIZE=EXTENDED stop at 4,000.';
    return done(out);
  }

  async function test(id) {
    const rec = podOf(id);
    if (!rec) return { ok: false, error: 'Add a Fusion pod first.' };
    const r = await execute({ sql: 'SELECT 1 AS n FROM dual', rowLimit: 1, pod: rec.id });
    const good = r.ok && r.rowCount === 1 && String(r.rows[0].N) === '1';
    markPod(rec.id, { testedAt: now().toISOString(), testOk: good, testMs: r.ms || 0, testUser: str(r.user),
      testError: good ? '' : cut(str(r.ok ? 'The runner answered, but not with N = 1.' : r.error).split('\n')[0], 300) });
    if (good) return { ok: true, ms: r.ms, user: r.user, pod: r.pod, origin: rec.url };
    return { ok: false, ms: r.ms, user: r.user, error: r.ok ? 'The runner answered, but not with N = 1: is Report path the DBMS_XMLGEN runner?' : r.error, needsLogin: r.needsLogin, raw: r.raw, decoded: r.decoded };
  }

  async function deploy(id) {
    const rec = podOf(id);
    if (!rec) return { ok: false, error: 'Add a Fusion pod first.', steps: [] };
    const p = full(rec);
    const cred = credentials(p);
    const steps = [];
    if (!cred.user || !cred.password) return { ok: false, steps, error: 'No user and password for this pod on this PC.' };
    const url = p.url + p.catalogServicePath;
    const basic = Buffer.from(cred.user + ':' + cred.password, 'utf8').toString('base64');
    steps.push('Pod ' + p.url + ' · user ' + cred.user + ' (' + cred.source + ')');
    const call = async (op, inner) => {
      const r = await post(url, op, catalogEnvelope(op, inner, cred.user, cred.password), basic, p.timeoutMs, 'CatalogService.' + op);
      if (r.netError) return { fault: r.netError, raw: '' };
      const f = (/<(?:\w+:)?faultstring[^>]*>([\s\S]*?)<\/(?:\w+:)?faultstring>/.exec(r.text || '') || [])[1];
      const fault = f ? unescapeOnce(f.trim()) : (r.status >= 400 ? 'HTTP ' + r.status : '');
      return { fault: fault || null, raw: cut(r.text, 1200) };
    };
    const folder = await call('createFolder', '<pub:folderAbsolutePath>' + esc(p.folderPath) + '</pub:folderAbsolutePath>');
    if (folder.fault && !/exist/i.test(folder.fault)) return { ok: false, steps: steps.concat(['✗ Folder ' + p.folderPath]), error: hint(folder.fault), raw: folder.raw };
    steps.push(folder.fault ? '✓ Folder already there: ' + p.folderPath : '✓ Folder made: ' + p.folderPath);
    const uploads = [{ path: p.dataModelPath, type: 'xdmz', entry: '_datamodel.xdm', xml: dataModelXml(p.dataSource), label: 'Data model' },
      { path: p.reportPath, type: 'xdoz', entry: '_report.xdo', xml: reportXml(p.dataModelPath), label: 'Report' }];
    for (const u of uploads) {
      const body = '<pub:reportObjectAbsolutePathURL>' + esc(u.path) + '</pub:reportObjectAbsolutePathURL><pub:objectType>' + u.type + '</pub:objectType>'
        + '<pub:objectDescription>Build.Rite Fusion SQL runner</pub:objectDescription><pub:objectZippedData>' + zipStore(u.entry, u.xml).toString('base64') + '</pub:objectZippedData>';
      let up = await call('uploadObject', body);
      if (up.fault && /exist/i.test(up.fault)) {
        const del = await call('deleteObject', '<pub:objectAbsolutePath>' + esc(u.path) + '</pub:objectAbsolutePath>');
        if (del.fault) return { ok: false, steps: steps.concat(['✗ ' + u.label + ': the one there could not be replaced']), error: del.fault, raw: del.raw };
        steps.push('• The ' + u.label.toLowerCase() + ' there removed, to be replaced');
        up = await call('uploadObject', body);
      }
      if (up.fault) return { ok: false, steps: steps.concat(['✗ ' + u.label + ' ' + u.path]), error: hint(up.fault), raw: up.raw };
      steps.push('✓ ' + u.label + ' uploaded: ' + u.path);
    }
    const t = await test(rec.id);
    if (!t.ok) return { ok: false, steps: steps.concat(['✗ The test query SELECT 1 FROM dual']), error: t.error, raw: t.raw };
    steps.push('✓ The test query answered in ' + t.ms + ' ms');
    markPod(rec.id, { deployedAt: now().toISOString() });
    return { ok: true, steps };
  }

  // ── The schema browser, cached per pod (never asked again until Refresh) ──
  function cacheFile(p) { return cacheDir ? path.join(cacheDir, 'schema-' + str(new URL(p.url).host).replace(/[^\w.-]/g, '_').slice(0, 120) + '.json') : ''; }
  function cacheRead(p) { try { return JSON.parse(fs.readFileSync(cacheFile(p), 'utf8')); } catch (e) { return {}; } }
  function cacheWrite(p, c) { const f = cacheFile(p); if (!f) return; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(c)); }
  function cacheGet(p, key) { return cacheRead(p)[key]; }
  function cacheSet(p, key, value) { const c = cacheRead(p); c[key] = value; cacheWrite(p, c); }
  const kindOf = (k) => KINDS[str(k).toUpperCase().replace(/[^A-Z]/g, '')] || (Object.values(KINDS).indexOf(str(k).toUpperCase()) !== -1 ? str(k).toUpperCase() : 'TABLE');
  const ownerOf = (s) => str(s).trim().toUpperCase().replace(/[^\w$#]/g, '') || 'FUSION';
  const nameOk = (s) => /^[\w$#.]{1,128}$/.test(str(s));

  async function q(p, sql, rowLimit) { return execute({ sql, rowLimit, pod: p.id }); }
  async function owners(id, refresh) {
    const rec = podOf(id);
    if (!rec) return { ok: false, error: 'Add a Fusion pod first.' };
    const p = full(rec);
    const hit = !refresh && cacheGet(p, 'owners');
    if (hit) return { ok: true, owners: hit, cached: true };
    const r = await q(p, 'SELECT username FROM all_users ORDER BY username', 5000);
    if (!r.ok) return r;
    const list = r.rows.map((x) => str(x.USERNAME)).filter(Boolean);
    if (list.indexOf('PUBLIC') === -1) list.push('PUBLIC');
    cacheSet(p, 'owners', list);
    return { ok: true, owners: list, cached: false };
  }
  async function objects(id, owner, kind, refresh) {
    const rec = podOf(id);
    if (!rec) return { ok: false, error: 'Add a Fusion pod first.' };
    const p = full(rec);
    const ow = ownerOf(owner), k = kindOf(kind);
    const key = 'schema.' + ow + '.' + k;
    const hit = !refresh && cacheGet(p, key);
    if (hit) return Object.assign({ ok: true, cached: true }, hit);
    const names = [];
    let capped = false;
    for (let from = 1; ; from += PAGE) {
      const r = await q(p, 'SELECT object_name FROM (SELECT object_name, ROW_NUMBER() OVER (ORDER BY object_name) rn FROM all_objects WHERE owner = ' + L(ow)
        + ' AND object_type = ' + L(k) + ') WHERE rn BETWEEN ' + from + ' AND ' + (from + PAGE - 1), PAGE);
      if (!r.ok) { if (!names.length) return r; capped = true; break; }
      r.rows.forEach((x) => names.push(str(x.OBJECT_NAME)));
      if (r.rows.length < PAGE) break;
      if (names.length >= OBJECT_CEILING) { capped = true; break; }
    }
    const val = { at: now().toISOString(), names, capped };
    cacheSet(p, key, val);
    return Object.assign({ ok: true, cached: false }, val);
  }
  async function search(id, owner, kind, term) {
    const rec = podOf(id);
    if (!rec) return { ok: false, error: 'Add a Fusion pod first.' };
    const t = str(term).trim().toUpperCase();
    if (t.length < 2) return { ok: false, error: 'Type at least two letters.' };
    const like = '%' + t.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    const r = await q(full(rec), 'SELECT owner, object_name, object_type FROM all_objects WHERE owner = ' + L(ownerOf(owner)) + ' AND object_type = ' + L(kindOf(kind))
      + ' AND UPPER(object_name) LIKE ' + L(like) + " ESCAPE '\\' ORDER BY object_name", 2000);
    return r.ok ? { ok: true, names: r.rows.map((x) => str(x.OBJECT_NAME)) } : r;
  }
  async function detail(id, owner, kind, name, refresh) {
    const rec = podOf(id);
    if (!rec) return { ok: false, error: 'Add a Fusion pod first.' };
    if (!nameOk(name)) return { ok: false, error: 'Not an object name.' };
    const p = full(rec);
    const ow = ownerOf(owner), k = kindOf(kind), n = str(name);
    const key = 'detail.' + ow + '.' + k + '.' + n;
    const hit = !refresh && cacheGet(p, key);
    if (hit) return Object.assign({ ok: true, cached: true }, hit);
    const out = { columns: [], arguments: [], indexes: [], fks: [], comments: '', target: '' };
    if (k === 'SYNONYM') {
      const s = await q(p, 'SELECT table_owner, table_name FROM all_synonyms WHERE owner = ' + L(ow) + ' AND synonym_name = ' + L(n), 1);
      if (!s.ok) return s;
      if (s.rows[0]) out.target = str(s.rows[0].TABLE_OWNER) + '.' + str(s.rows[0].TABLE_NAME);
    } else if (['PROCEDURE', 'FUNCTION', 'PACKAGE'].indexOf(k) !== -1) {
      const a = await q(p, "SELECT NVL(object_name, '-') AS subprogram, NVL(argument_name, '(return)') AS argument_name, data_type, in_out FROM all_arguments WHERE owner = " + L(ow)
        + ' AND ' + (k === 'PACKAGE' ? 'package_name' : 'object_name') + ' = ' + L(n) + ' ORDER BY object_name, overload, position', 1000);
      if (!a.ok) return a;
      out.arguments = a.rows.map((x) => ({ subprogram: str(x.SUBPROGRAM), name: str(x.ARGUMENT_NAME), type: str(x.DATA_TYPE), inOut: str(x.IN_OUT) }));
    } else if (['TABLE', 'VIEW', 'MATERIALIZED VIEW'].indexOf(k) !== -1) {
      const c = await q(p, "SELECT c.column_name, c.data_type || CASE WHEN c.data_type IN ('VARCHAR2','CHAR','NVARCHAR2','NCHAR') THEN '(' || c.char_length || ')' "
        + "WHEN c.data_type = 'NUMBER' AND c.data_precision IS NOT NULL THEN '(' || c.data_precision || NVL2(c.data_scale, ',' || c.data_scale, '') || ')' END AS data_type, "
        + 'c.nullable, SUBSTR(m.comments, 1, 200) AS comments FROM all_tab_columns c LEFT JOIN all_col_comments m ON m.owner = c.owner AND m.table_name = c.table_name AND m.column_name = c.column_name '
        + 'WHERE c.owner = ' + L(ow) + ' AND c.table_name = ' + L(n) + ' ORDER BY c.column_id', 1000);
      if (!c.ok) return c;
      out.columns = c.rows.map((x) => ({ name: str(x.COLUMN_NAME), type: str(x.DATA_TYPE), nullable: str(x.NULLABLE) !== 'N', comments: str(x.COMMENTS) }));
      if (k === 'TABLE') {
        const i = await q(p, "SELECT i.index_name, i.uniqueness, LISTAGG(c.column_name, ', ') WITHIN GROUP (ORDER BY c.column_position) AS columns FROM all_indexes i "
          + 'JOIN all_ind_columns c ON c.index_owner = i.owner AND c.index_name = i.index_name WHERE i.table_owner = ' + L(ow) + ' AND i.table_name = ' + L(n)
          + ' GROUP BY i.index_name, i.uniqueness ORDER BY i.uniqueness DESC, i.index_name', 500);
        if (i.ok) out.indexes = i.rows.map((x) => ({ name: str(x.INDEX_NAME), unique: str(x.UNIQUENESS) === 'UNIQUE', columns: str(x.COLUMNS) }));
        const f = await q(p, "SELECT c.constraint_name AS fk_name, LISTAGG(cc.column_name, ', ') WITHIN GROUP (ORDER BY cc.position) AS fk_columns, r.owner || '.' || r.table_name AS ref_table "
          + 'FROM all_constraints c JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name '
          + 'LEFT JOIN all_constraints r ON r.owner = c.r_owner AND r.constraint_name = c.r_constraint_name '
          + "WHERE c.owner = " + L(ow) + ' AND c.table_name = ' + L(n) + " AND c.constraint_type = 'R' GROUP BY c.constraint_name, r.owner, r.table_name ORDER BY c.constraint_name", 500);
        if (f.ok) out.fks = f.rows.map((x) => ({ name: str(x.FK_NAME), columns: str(x.FK_COLUMNS), ref: str(x.REF_TABLE) }));
      }
      const tc = await q(p, 'SELECT SUBSTR(comments, 1, 400) AS comments FROM all_tab_comments WHERE owner = ' + L(ow) + ' AND table_name = ' + L(n), 1);
      if (tc.ok && tc.rows[0]) out.comments = str(tc.rows[0].COMMENTS);
    }
    out.at = now().toISOString();
    cacheSet(p, key, out);
    return Object.assign({ ok: true, cached: false }, out);
  }
  /** What the schema cache of a pod holds (Connection → Schema cache). */
  function cacheInfo(id) {
    const rec = podOf(id);
    if (!rec) return { ok: false, error: 'There is no such pod.' };
    const p = full(rec);
    const f = cacheFile(p);
    let st = null;
    try { st = f ? fs.statSync(f) : null; } catch (e) { st = null; }
    if (!st) return { ok: true, pod: rec.name, owners: 0, lists: 0, details: 0, bytes: 0, at: '' };
    const c = cacheRead(p);
    const keys = Object.keys(c);
    return { ok: true, pod: rec.name, owners: (c.owners || []).length, lists: keys.filter((k) => k.indexOf('schema.') === 0).length,
      details: keys.filter((k) => k.indexOf('detail.') === 0).length, bytes: st.size, at: st.mtime.toISOString() };
  }
  function clearCache(id) {
    const rec = podOf(id);
    if (!rec) return { ok: false, error: 'There is no such pod.' };
    try { fs.unlinkSync(cacheFile(full(rec))); } catch (e) { /* none */ }
    return { ok: true };
  }

  // ── Saved queries (this PC) ──
  function queries() { return { ok: true, queries: read().queries.slice().sort((a, b) => str(a.name).localeCompare(str(b.name))) }; }
  function saveQuery(input) {
    const b = input || {};
    const name = str(b.name).trim();
    if (!name) return { ok: false, error: 'Give the query a name.' };
    const v = validate(b.sql);
    if (v.error) return { ok: false, error: v.error };
    const d = read();
    let rec = d.queries.filter((x) => (b.id && x.id === b.id) || str(x.name).toLowerCase() === name.toLowerCase())[0];
    const at = now().toISOString();
    if (!rec) { rec = { id: crypto.randomBytes(6).toString('hex'), createdAt: at, runs: 0 }; d.queries.push(rec); }
    Object.assign(rec, { name: name.slice(0, 120), sql: str(b.sql).trim().slice(0, 40000), description: str(b.description).trim().slice(0, 1000), folder: str(b.folder).trim().slice(0, 60), updatedAt: at, by: str(b.by) });
    write(d);
    return { ok: true, query: rec };
  }
  function removeQuery(id) {
    const d = read();
    const n = d.queries.length;
    d.queries = d.queries.filter((x) => x.id !== id);
    if (d.queries.length === n) return { ok: false, error: 'There is no such query.' };
    write(d);
    return { ok: true };
  }
  function ranQuery(id) { const d = read(); const r = d.queries.filter((x) => x.id === id)[0]; if (r) { r.runs = (Number(r.runs) || 0) + 1; r.lastRun = now().toISOString(); write(d); } return { ok: !!r }; }
  function importQueries(list) {
    let added = 0, updated = 0, skipped = 0;
    (Array.isArray(list) ? list : []).slice(0, 2000).forEach((x) => {
      const before = read().queries.some((q2) => str(q2.name).toLowerCase() === str(x && x.name).trim().toLowerCase());
      const r = saveQuery({ name: x && x.name, sql: x && x.sql, description: x && x.description, folder: x && x.folder, by: x && x.by });
      if (!r.ok) skipped++; else if (before) updated++; else added++;
    });
    return { ok: true, added, updated, skipped };
  }

  // ── Ask AI: look-ups in the data dictionary, then the SQL checked on the pod ──
  function stepOf(askId, s) { if (askId && asks[askId]) asks[askId].steps.push(Object.assign({ at: Date.now() }, s)); }
  function progress(askId) { const a = asks[str(askId)]; return a ? { ok: true, steps: a.steps, done: a.done } : { ok: false, steps: [], done: true }; }
  const rowsText = (r, max) => {
    if (!r.ok) return 'ERROR: ' + cut(r.error, 400);
    if (!r.rows.length) return '(no rows)';
    const cols = r.columns;
    return [cols.join(' | ')].concat(r.rows.slice(0, max || 60).map((x) => cols.map((c) => cut(x[c] === undefined ? '' : x[c], 120)).join(' | '))).join('\n') + (r.rows.length > (max || 60) ? '\n…' : '');
  };
  async function lookup(p, req) {
    const t = str(req && req.tool);
    const like = (s) => L(str(s).trim().toUpperCase().replace(/\*/g, '%') || '%');
    if (t === 'search_objects') {
      const type = str(req.type).trim().toUpperCase();
      const r = await q(p, 'SELECT owner, object_name, object_type FROM all_objects WHERE UPPER(object_name) LIKE ' + like(req.pattern)
        + (type ? ' AND object_type = ' + L(type) : " AND object_type IN ('TABLE','VIEW','SYNONYM','PACKAGE','PROCEDURE','FUNCTION','MATERIALIZED VIEW')") + ' ORDER BY object_name', 80);
      return { label: 'Searching objects ' + str(req.pattern), text: rowsText(r, 80) };
    }
    if (t === 'search_columns') {
      const r = await q(p, 'SELECT owner, table_name, column_name, data_type FROM all_tab_columns WHERE UPPER(column_name) LIKE ' + like(req.column)
        + (req.table ? ' AND UPPER(table_name) LIKE ' + like(req.table) : '') + ' ORDER BY table_name, column_name', 80);
      return { label: 'Searching columns ' + str(req.column) + (req.table ? ' in ' + req.table : ''), text: rowsText(r, 80) };
    }
    if (t === 'describe') {
      const n = str(req.name).trim().toUpperCase();
      if (!nameOk(n)) return { label: 'Describe', text: 'ERROR: not an object name.' };
      let ow = str(req.owner).trim().toUpperCase();
      const f = await q(p, 'SELECT owner, object_type FROM all_objects WHERE object_name = ' + L(n) + (ow ? ' AND owner = ' + L(ow) : '')
        + " AND object_type IN ('TABLE','VIEW','MATERIALIZED VIEW','SYNONYM','PACKAGE','PROCEDURE','FUNCTION') ORDER BY DECODE(owner, 'FUSION', 0, 1), object_type", 5);
      if (!f.ok) return { label: 'Describing ' + n, text: rowsText(f) };
      if (!f.rows.length) return { label: 'Describing ' + n, text: 'No object ' + n + ' that this user can see.' };
      ow = str(f.rows[0].OWNER);
      const kind = str(f.rows[0].OBJECT_TYPE);
      const d = await detail(p.id, ow, kind, n);
      if (!d.ok) return { label: 'Describing ' + n, text: 'ERROR: ' + d.error };
      const lines = [ow + '.' + n + ' (' + kind + ')' + (d.comments ? ': ' + d.comments : '') + (d.target ? ' → ' + d.target : '')];
      d.columns.forEach((c) => lines.push('  ' + c.name + ' ' + c.type + (c.nullable ? '' : ' NOT NULL') + (c.comments ? ' — ' + cut(c.comments, 100) : '')));
      d.arguments.forEach((a) => lines.push('  ' + a.subprogram + ' ' + a.name + ' ' + a.inOut + ' ' + a.type));
      d.indexes.forEach((i) => lines.push('  index ' + i.name + (i.unique ? ' UNIQUE' : '') + ' (' + i.columns + ')'));
      d.fks.forEach((x) => lines.push('  fk ' + x.name + ' (' + x.columns + ') → ' + x.ref));
      return { label: 'Describing ' + ow + '.' + n, text: lines.join('\n') };
    }
    if (t === 'source') {
      const n = str(req.name).trim().toUpperCase();
      const type = str(req.type).trim().toUpperCase() || 'PACKAGE';
      if (!nameOk(n)) return { label: 'Source', text: 'ERROR: not an object name.' };
      if (type === 'VIEW') {
        const v = await q(p, 'SELECT owner, text_vc FROM all_views WHERE view_name = ' + L(n), 1);
        return { label: 'Reading the SQL of view ' + n, text: v.ok && v.rows[0] ? str(v.rows[0].OWNER) + '.' + n + ':\n' + cut(v.rows[0].TEXT_VC, 6000) : rowsText(v) };
      }
      const from = clamp(req.from, 1, 1000000, 1);
      const s = await q(p, 'SELECT line, text FROM all_source WHERE name = ' + L(n) + ' AND type = ' + L(type) + ' AND line BETWEEN ' + from + ' AND ' + (from + 199) + ' ORDER BY owner, line', 200);
      return { label: 'Reading the source of ' + n + ' (' + type + ')', text: s.ok ? (s.rows.length ? s.rows.map((x) => x.LINE + ': ' + str(x.TEXT).replace(/\s+$/, '')).join('\n') : '(no source visible: wrapped, or not granted)') : rowsText(s) };
    }
    if (t === 'dependencies') {
      const n = str(req.name).trim().toUpperCase();
      if (!nameOk(n)) return { label: 'Dependencies', text: 'ERROR: not an object name.' };
      const u = await q(p, 'SELECT DISTINCT referenced_owner, referenced_name, referenced_type FROM all_dependencies WHERE name = ' + L(n) + " AND referenced_owner NOT IN ('SYS','PUBLIC') ORDER BY 2", 60);
      const b = await q(p, 'SELECT DISTINCT owner, name, type FROM all_dependencies WHERE referenced_name = ' + L(n) + ' ORDER BY 2', 60);
      return { label: 'Dependencies of ' + n, text: 'Uses:\n' + rowsText(u, 60) + '\nUsed by:\n' + rowsText(b, 60) };
    }
    if (t === 'sample') {
      const r = await q(p, str(req.sql), 5);
      return { label: 'Sample: ' + cut(str(req.sql).replace(/\s+/g, ' '), 80), text: rowsText(r, 5) };
    }
    return { label: 'Unknown look-up', text: 'ERROR: unknown tool "' + t + '". Tools: search_objects, search_columns, describe, source, dependencies, sample.' };
  }
  /** The tables a question is about, from the cached object lists (FUSION first), with their cached columns. */
  async function hints(p, question, editorSql) {
    const terms = K.keywords(question + ' ' + str(editorSql).slice(0, 2000));
    if (!terms.length) return '';
    const cache = cacheRead(p);
    const cands = [];
    Object.keys(cache).filter((k) => /^schema\.[^.]+\.(TABLE|VIEW)$/.test(k)).forEach((k) => {
      const ow = k.split('.')[1];
      (cache[k].names || []).forEach((n) => { const s = K.score(n, terms); if (s > 0) cands.push({ ow, n, s: s + (ow === 'FUSION' ? 0.5 : 0) }); });
    });
    let picked = cands.sort((a, b) => b.s - a.s).slice(0, 40);
    if (picked.length < 5) {
      // nothing cached (or nothing close): ask the dictionary itself
      const ors = terms.slice(0, 6).map((t) => 'UPPER(object_name) LIKE ' + L('%' + t.t.replace(/[\\%_]/g, (c) => '\\' + c) + '%') + " ESCAPE '\\'").join(' OR ');
      const r = await q(p, "SELECT owner, object_name FROM all_objects WHERE object_type IN ('TABLE','VIEW') AND (" + ors + ") AND ROWNUM <= 400", 400);
      if (r.ok) r.rows.forEach((x) => { const s = K.score(x.OBJECT_NAME, terms); if (s > 0 && !picked.some((c) => c.n === x.OBJECT_NAME)) picked.push({ ow: str(x.OWNER), n: str(x.OBJECT_NAME), s }); });
      picked = picked.sort((a, b) => b.s - a.s).slice(0, 40);
    }
    if (!picked.length) return '';
    const lines = [];
    picked.forEach((c, i) => {
      const d = cache['detail.' + c.ow + '.TABLE.' + c.n] || cache['detail.' + c.ow + '.VIEW.' + c.n];
      lines.push(c.ow + '.' + c.n + (d && d.columns && d.columns.length ? ': ' + d.columns.map((x) => x.name).join(', ').slice(0, 900) : i < 40 ? '' : ''));
    });
    return lines.join('\n');
  }

  async function ask(input, chat) {
    const b = input || {};
    const question = str(b.question).trim();
    if (!question) return { ok: false, error: 'Ask a question first.' };
    if (typeof chat !== 'function') return { ok: false, error: 'Set up AI first (Tools → AI settings).' };
    const rec = podOf(b.pod);
    if (!rec) return { ok: false, error: 'Add a Fusion pod first (Connection).' };
    const p = full(rec);
    const askId = str(b.askId).slice(0, 40) || crypto.randomBytes(6).toString('hex');
    asks[askId] = { steps: [], done: false, at: Date.now() };
    Object.keys(asks).forEach((k) => { if (Date.now() - asks[k].at > 30 * 60000) delete asks[k]; });
    try {
      stepOf(askId, { kind: 'hints', label: 'Finding the tables the question is about' });
      const start = await hints(p, question, b.editorSql);
      const history = (Array.isArray(b.history) ? b.history : []).slice(-8).filter((h) => h && h.text && (h.role === 'user' || h.role === 'assistant'))
        .map((h) => (h.role === 'user' ? 'User: ' : 'Assistant: ') + cut(h.text, 3000)).join('\n\n');
      const head = [history ? '# Earlier in this conversation\n' + history + '\n' : '',
        str(b.editorSql).trim() ? '# CURRENT EDITOR SQL\n```sql\n' + cut(b.editorSql, 6000) + '\n```\n' : '',
        start ? '# STARTING HINTS (tables that may matter; columns where Build.Rite knows them)\n' + start + '\n' : '',
        '# Question\n' + question].filter(Boolean).join('\n');
      const notes = []; // look-ups and checks so far, sent back each round
      let answer = null, sql = '', checked = false, checkError = '', fixes = 0, provider = '', model = '';
      for (let round = 1; round <= MAX_ROUNDS + MAX_FIXES; round++) {
        const left = MAX_ROUNDS + MAX_FIXES - round;
        let notesText = notes.join('\n\n');
        if (notesText.length > 40000) notesText = '…(earlier look-ups cut)…\n' + notesText.slice(-40000);
        const user = head + (notesText ? '\n\n# What Build.Rite found for you so far\n' + notesText : '')
          + (left <= 1 ? '\n\nThis is your last turn: answer now with what you verified.' : '');
        stepOf(askId, { kind: 'ai', label: round === 1 ? 'Asking the AI' : 'Asking the AI again (' + round + ')' });
        const r = await chat(ASK_SYSTEM, user);
        if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'The AI did not answer.', needsSetup: !!(r && r.needsSetup), steps: asks[askId].steps };
        provider = r.provider || provider; model = r.model || model;
        const text = str(r.text);
        const lk = /```\s*lookup\s*\n([\s\S]*?)```/i.exec(text);
        if (lk && left <= 0) break; // still looking things up on its last turn: no answer
        if (lk) {
          let reqs = [];
          try { reqs = JSON.parse(lk[1]); } catch (e) { reqs = null; }
          if (!Array.isArray(reqs)) { notes.push('Your lookup block was not a JSON array: ' + cut(lk[1], 200)); continue; }
          for (const req of reqs.slice(0, 6)) {
            const res = await lookup(p, req);
            stepOf(askId, { kind: 'lookup', label: res.label });
            notes.push('## ' + JSON.stringify(req) + '\n' + cut(res.text, 6000));
          }
          continue;
        }
        answer = text;
        sql = K.lastSql(text);
        if (!sql) break;
        const v = validate(sql);
        if (v.error) { checkError = v.error; } else {
          stepOf(askId, { kind: 'check', label: 'Checking the SQL on ' + p.name });
          const c = await execute({ sql: K.nullParams(v.stmt), pod: p.id, check: true });
          checked = c.ok;
          checkError = c.ok ? '' : str(c.error).split('\n')[0];
          stepOf(askId, { kind: 'checked', ok: c.ok, label: c.ok ? 'The pod accepts it' : 'The pod refused it: ' + cut(checkError, 160) });
        }
        if (checked || fixes >= MAX_FIXES || left <= 0) break;
        fixes++;
        notes.push('## Your SQL was refused\nBuild.Rite ran your SQL on the pod as SELECT * FROM (…) WHERE 1 = 0, with every {{PARAM}} as NULL, and Fusion answered:\n'
          + checkError + '\nYour SQL was:\n```sql\n' + sql + '\n```\nFix it: look up what you need, then answer again.');
      }
      if (answer === null) return { ok: false, error: 'The AI kept looking things up and did not answer: ask a narrower question.', steps: asks[askId].steps };
      return { ok: true, text: answer, sql, checked, checkError, provider, model, steps: asks[askId].steps };
    } finally {
      if (asks[askId]) asks[askId].done = true;
    }
  }

  return { settings, savePod, removePod, setActive, execute, test, deploy, calls: (clear) => { if (clear) callLog.length = 0; return { ok: true, calls: callLog.slice() }; },
    owners, objects, search, detail, clearCache, cacheInfo, queries, saveQuery, removeQuery, ranQuery, importQueries, ask, progress, KINDS };
}

module.exports = { open, validate, capSql, checkSql, runReportEnvelope, catalogEnvelope, readSoap, parseRows, parseCsv, coerce, columnsOf, diagnose,
  dataModelXml, reportXml, zipStore, crc32, redact, xmlTree, unescapeOnce, RUNNER_SQL, DEFAULTS, ASK_SYSTEM };
