#!/usr/bin/env node
'use strict';
/**
 * Fusion SQL (desktop/lib/fusionSql.js + resources/js/fusionSqlKit.js), against a stand-in pod (tests/fakeFusionPod.js):
 *   - read-only: SELECT / WITH only, no inline PL/SQL, one statement; the row cap (and its line breaks)
 *   - the runner's answer read: the ROWSET escaped once in RESULT (XML) or with real tags in a CSV field, NULLs left
 *     out (columns = their union, in SELECT order), COUNT(*) tags, numbers vs ids and codes, an empty answer = 0 rows,
 *     an Oracle error or a cut answer said, an HTML page said
 *   - placeholders: {{NAME}} and :NAME (not in strings or comments), blank → NULL, O'Neil → 'O''Neil', dates
 *   - the runner's BI Publisher objects and the ZIP they are uploaded in
 *   - pods: https only, the password sealed (never back to the page), your app's login; execute XML first and CSV only
 *     when XML gave nothing (an XML fault is the real error); deploy (and again: replaced); the call log (***)
 *   - the schema browser paged and cached per pod; saved queries; Ask AI (look-ups, a refused SQL fixed); /__fsql/*
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const H = require('./_harness');
const F = require('../desktop/lib/fusionSql');
const K = require('../webApps/buildrite/resources/js/fusionSqlKit.js');
const Pod = require('./fakeFusionPod');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function request(port, method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: 'localhost', port, method, path: p, headers: Object.assign({ 'X-Build-Rite-FSQL': '1' }, data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}, headers || {}) }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const t = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(t); } catch (e) { json = null; } resolve({ status: res.statusCode, text: t, json }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const tmp = [];
  const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'br-fsql-')); tmp.push(d); return d; };
  const pods = [];
  const seal = { encrypt: (t) => Buffer.from('sealed:' + Buffer.from(t).toString('base64')), decrypt: (b) => Buffer.from(String(b).replace(/^sealed:/, ''), 'base64').toString() };
  try {
    T.section('read-only');
    T.check('SELECT and WITH run; a trailing ; and a leading comment are fine', F.validate('select 1 from dual;').stmt === 'select 1 from dual' && !!F.validate('-- top\nWITH a AS (SELECT 1 x FROM dual) SELECT * FROM a').stmt);
    T.check('…DELETE, UPDATE, BEGIN refused', ['DELETE FROM t', 'update t set a=1', 'BEGIN null; END;', 'drop table t'].every((s) => /read-only/.test(F.validate(s).error || '')));
    T.check('…inline PL/SQL refused (WITH FUNCTION, PRAGMA AUTONOMOUS_TRANSACTION)', /Inline PL\/SQL/.test(F.validate('WITH FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END; SELECT f FROM dual').error || '') && /Inline/.test(F.validate('select 1 from dual -- x\n where 1=1 and pragma autonomous_transaction').error || ''));
    T.check('…two statements refused; a ; inside a string is not a second one', /One statement at a time/.test(F.validate('select 1 from dual; select 2 from dual').error || '') && !!F.validate("select ';x' from dual").stmt);
    T.eq('the cap: line breaks keep a last -- comment from swallowing the parenthesis', F.capSql('select 1 from dual -- note', 50), 'SELECT * FROM (\nselect 1 from dual -- note\n) WHERE ROWNUM <= 50');

    T.section('the runner\'s answer');
    const inner = '<ROWSET><ROW><INVOICE_ID>300000012345678</INVOICE_ID><NAME>A &amp; B &lt;x&gt; "q"\nz</NAME><COUNT_x0028__x002A__x0029_>3</COUNT_x0028__x002A__x0029_><CODE>0101</CODE><BIG>12345678901234567890</BIG></ROW>'
      + '<ROW><INVOICE_ID>2</INVOICE_ID><CODE/></ROW></ROWSET>';
    const xmlOut = '<DATA_DS><P_QRY_STMT>U0VMRUNU</P_QRY_STMT><G_1><RESULT>' + esc(inner) + '</RESULT></G_1></DATA_DS>';
    const rows = F.parseRows(xmlOut);
    T.check('XML output (the ROWSET escaped once in RESULT): rows, special characters exact, a NULL left out', rows.length === 2 && rows[0].NAME === 'A & B <x> "q"\nz' && !('CODE' in rows[1]) && rows[1].INVOICE_ID === 2, JSON.stringify(rows));
    T.check('…COUNT(*) from its escaped tag; a 15-digit id a number, a 20-digit one text, a leading-zero code text', rows[0]['COUNT(*)'] === 3 && rows[0].INVOICE_ID === 300000012345678 && rows[0].BIG === '12345678901234567890' && rows[0].CODE === '0101');
    T.eq('…columns: their union, in the SELECT order', F.columnsOf(rows).join(), 'INVOICE_ID,NAME,COUNT(*),CODE,BIG');
    T.eq('…columns when the first row has a NULL: the order of a full row', F.columnsOf([{ A: 1, C: 3 }, { A: 1, B: 2, C: 3 }]).join(), 'A,B,C');
    const csvOut = 'RESULT\n"' + inner.replace(/"/g, '""') + '"\n';
    T.check('CSV output (real tags in a quoted field): the same rows', JSON.stringify(F.parseRows(csvOut)) === JSON.stringify(rows));
    T.check('an empty answer (RESULT blank or <ROWSET/>) = 0 rows, not an error', F.parseRows('<DATA_DS><P_QRY_STMT>x</P_QRY_STMT><G_1><RESULT/></G_1></DATA_DS>').length === 0 && F.parseRows('<ROWSET/>').length === 0);
    T.check('a doubly escaped ROWSET is read too', F.parseRows('<X>' + esc(esc(inner)) + '</X>').length === 2);
    T.eq('an Oracle error in RESULT: said', F.diagnose('<DATA_DS><G_1><RESULT>ORA-00904: "X": invalid identifier</RESULT></G_1></DATA_DS>'), 'Fusion answered with an Oracle error: ORA-00904: "X": invalid identifier');
    T.check('…an answer cut short: said', /cut the answer short/.test(F.diagnose('<RESULT>&lt;ROWSET&gt;&lt;ROW&gt;&lt;A&gt;1&lt;/A&gt;</RESULT>')));
    T.check('…only the echoed statement: nothing to say', F.diagnose('<DATA_DS><P_QRY_STMT>U0VMRUNUIDEgRlJPTSBkdWFs</P_QRY_STMT><G_1><RESULT/></G_1></DATA_DS>') === null);
    T.check('a web page instead of SOAP (a proxy, a sign-in page): said', /web page came back[\s\S]*Sign In/.test(F.readSoap('<html><head><title>Sign In</title></head><body/></html>', 'reportBytes').fault)
      && /not XML/.test(F.readSoap('<p>broken', 'reportBytes').fault));
    T.check('a SOAP fault: its text', F.readSoap('<s:Envelope xmlns:s="x"><s:Body><s:Fault><faultstring>Report not found</faultstring></s:Fault></s:Body></s:Envelope>', 'reportBytes').fault === 'Report not found');
    T.check('CSV: quotes, "" escapes, commas and line breaks in a field', JSON.stringify(F.parseCsv('A,B\n"x, ""y""","1\n2"\n')) === JSON.stringify([{ A: 'x, "y"', B: '1\n2' }]));

    T.section('placeholders');
    T.eq('{{NAME}} and :NAME found once each — not in strings, comments or :: / x:Y', K.params("select {{A}}, :B, ':C', q'[:D]', x:E, a::F from t -- :G\n/* {{H}} */ where z = {{a}} and :B = 1").join(), 'A,B');
    T.eq('blank → NULL; O\'Neil → \'O\'\'Neil\'; a number as it is', K.substitute("where s = {{SUPPLIER}} and v = :V and n = {{N}}", { SUPPLIER: "O'Neil", V: '', N: '42' }), "where s = 'O''Neil' and v = NULL and n = 42");
    T.eq('a date in any common format → DATE \'YYYY-MM-DD\'; inside TO_DATE(…) the text as typed', K.substitute("d >= {{D1}} and d < {{D2}} and e = TO_DATE({{D3}}, 'DD/MM/YYYY')", { D1: '16-Nov-2026', D2: '2026/12/01 08:30', D3: '01/02/2026' }),
      "d >= DATE '2026-11-16' and d < TO_DATE('2026-12-01 08:30:00','YYYY-MM-DD HH24:MI:SS') and e = TO_DATE('01/02/2026', 'DD/MM/YYYY')");
    T.eq('nullParams: every placeholder NULL (to compile it)', K.nullParams('where a = {{A}} and b = :B'), 'where a = NULL and b = NULL');
    T.check('ids: *_ID, *NUMBER, *_NUM shown as text', K.isId('INVOICE_ID') && K.isId('PARTY_NUMBER') && K.isId('INVOICE_NUM') && !K.isId('AMOUNT'));
    const kw = K.keywords('open supplier invoices').map((t) => t.t);
    T.check('Ask AI: a question\'s words → the Fusion tables they mean', kw.indexOf('POZ_') !== -1 && kw.indexOf('AP_INVOICES') !== -1 && kw.indexOf('OPEN') === -1 && K.score('AP_INVOICES_ALL', K.keywords('supplier invoices')) > K.score('AP_INVOICES_ALL_BK', K.keywords('supplier invoices')));
    T.eq('lastSql: the last ```sql block, no semicolon', K.lastSql('a\n```sql\nselect 1 from dual\n```\nb\n```sql\nselect 2 from dual;\n```'), 'select 2 from dual');
    const v = K.view({ columns: ['ID', 'AMT'], rows: Array.from({ length: 250 }, (_, i) => ({ ID: i + 1, AMT: (i % 7) * 1000 })) }, { q: '', sortCol: 'AMT', sortDir: -1, page: 2 });
    T.check('the grid view: 100 rows a page, sorted, numbers with separators, ids plain', v.pages === 3 && v.page === 2 && v.rows.length === 50 && v.rows[0].n === 201 && /,/.test(v.rows.find((r) => r.cells[1].t !== '0').cells[1].t)
      && !/,/.test(v.rows[0].cells[0].t) && v.cols[1].sort === '▼');

    T.section('the runner\'s BI Publisher objects');
    const dm = F.dataModelXml('ApplicationDB_FSCM');
    T.check('the data model: DBMS_XMLGEN over the base64 P_QRY_STMT, rowset tag off, upper-case tags, row G_1', /DBMS_XMLGEN\.getxml/.test(dm) && /UTL_ENCODE\.base64_decode\(UTL_RAW\.cast_to_raw\(:P_QRY_STMT\)\)/.test(dm)
      && /include_rowsettag" value="false"/.test(dm) && /xml_tag_case" value="upper"/.test(dm) && /xmlRowTagName="G_1"/.test(dm) && /rootName="DATA_DS"/.test(dm));
    T.check('the report: bound to the data model', /<dataModel url="\/Custom\/BuildRite\/QueryRunnerDM\.xdm"\/>/.test(F.reportXml('/Custom/BuildRite/QueryRunnerDM.xdm')));
    const z = F.zipStore('_report.xdo', 'héllo <xml/>');
    const un = Pod.unzipOne(z);
    T.check('the ZIP (stored): one entry, its text exact, its CRC right', un.name === '_report.xdo' && un.text === 'héllo <xml/>' && z.readUInt32LE(14) === F.crc32(Buffer.from('héllo <xml/>')));
    T.check('the envelope: credentials in the body, escaped; redacted for the log', /<v2:userID>A&amp;B<\/v2:userID>/.test(F.runReportEnvelope('/x.xdo', 'QQ==', 'A&B', 'p<w', 'xml'))
      && F.redact(F.runReportEnvelope('/x.xdo', 'QQ==', 'u', 'secret', 'xml')).indexOf('secret') === -1);

    T.section('a pod');
    const pod = await Pod.start({ runner: true });
    pods.push(pod);
    let dir = mk();
    let appLogin = null;
    const S = F.open(Object.assign({ file: path.join(dir, 'f.json'), cacheDir: path.join(dir, 'cache'), fetch: (u, i) => fetch(u, i), appLogin: () => appLogin, appPod: () => 'https://abcd.fa.us2.oraclecloud.com/fscmUI/faces' }, seal));
    T.check('https only (the stand-in pod is http)', /Only https/.test(S.savePod({ url: pod.url, login: 'own', username: 'U', password: 'P' }).error || ''));
    const S2 = F.open(Object.assign({ file: path.join(dir, 'f.json'), cacheDir: path.join(dir, 'cache'), fetch: (u, i) => fetch(u, i), appLogin: () => appLogin, appPod: () => 'https://abcd.fa.us2.oraclecloud.com/fscmUI/faces', allowHttp: true }, seal));
    let st = S2.settings();
    T.check('no pod yet; your app\'s pod suggested (its origin only)', st.pods.length === 0 && st.suggest.url === 'https://abcd.fa.us2.oraclecloud.com');
    const saved = S2.savePod({ url: pod.url + '/xmlpserver/x', login: 'own', username: pod.user, password: pod.password });
    st = S2.settings();
    T.check('saved: named from its host, the address its origin, in use, the password sealed in the file and never shown', saved.ok && st.pods[0].url === pod.url && st.pods[0].active && st.pods[0].hasPassword && st.pods[0].passwordKept === 'keychain'
      && JSON.stringify(st).indexOf(pod.password) === -1 && fs.readFileSync(path.join(dir, 'f.json'), 'utf8').indexOf(pod.password) === -1);
    S2.savePod({ id: saved.id, url: pod.url, login: 'own', username: pod.user, password: '' });
    let r = await S2.execute({ sql: 'SELECT 1 AS n FROM dual' });
    T.check('…an empty password keeps the saved one: SELECT 1 → N = 1 (a number)', r.ok && r.rows[0].N === 1 && r.user === pod.user, JSON.stringify(r).slice(0, 300));
    r = await S2.execute({ sql: 'select invoice_id, invoice_num from ap_invoices_all', rowLimit: 2 });
    T.check('a row limit: exactly that many, capped', r.ok && r.rowCount === 2 && r.capped && r.cap === 2);
    r = await S2.execute({ sql: 'select * from ap_invoices_all where vendor_id = 999' });
    T.check('no rows: success, empty', r.ok && r.rowCount === 0 && !r.capped);
    const n0 = pod.calls.length;
    r = await S2.execute({ sql: 'select bad_col from ap_invoices_all' });
    T.check('a bad column: the XML attempt\'s ORA-00904, no CSV attempt to hide it', !r.ok && /ORA-00904/.test(r.error) && pod.calls.length === n0 + 1);
    r = await S2.execute({ sql: 'select * from xx_secret' });
    T.check('an error the report puts in RESULT (ORA-00942): said, with what it means', !r.ok && /ORA-00942/.test(r.error) && /data roles/.test(r.error));
    const n1 = pod.calls.length;
    r = await S2.execute({ sql: 'delete from ap_invoices_all' });
    T.check('DELETE: refused before any call', !r.ok && pod.calls.length === n1);
    const log = S2.calls().calls;
    T.check('the call log: newest first, the password ***, the decoded answer kept', log.length >= 5 && log.every((c) => c.request.indexOf(pod.password) === -1 && c.request.indexOf(esc(pod.password)) === -1) && /<v2:password>\*\*\*<\/v2:password>/.test(log[0].request) && log.some((c) => /DATA_DS/.test(c.decoded)));
    T.check('…cleared', S2.calls(true).calls.length === 0);

    T.section('CSV only, the app\'s login, a wrong password');
    const csvPod = await Pod.start({ runner: true, csvOnly: true });
    pods.push(csvPod);
    const S3 = F.open(Object.assign({ file: path.join(mk(), 'f.json'), fetch: (u, i) => fetch(u, i), appLogin: () => appLogin, allowHttp: true }, seal));
    const p3 = S3.savePod({ url: csvPod.url, login: 'app', name: 'CSV' });
    r = await S3.execute({ sql: 'SELECT 1 AS n FROM dual' });
    T.check('your app\'s login, none on this PC: said where to sign in, nothing sent', !r.ok && r.needsLogin && /Sign in for your app/.test(r.error) && csvPod.calls.length === 0);
    appLogin = { user: csvPod.user, password: 'wrong' };
    r = await S3.execute({ sql: 'SELECT 1 AS n FROM dual' });
    T.check('…a wrong password: the pod\'s refusal, said', !r.ok && /authenticate/.test(r.error) && /refused the user or password/.test(r.error));
    appLogin = { user: csvPod.user, password: csvPod.password };
    r = await S3.execute({ sql: 'select invoice_num, description from ap_invoices_all', rowLimit: 3 });
    T.check('…signed in: XML gives nothing (no bytes, no fault), so CSV: the same rows, special characters exact', r.ok && r.rowCount === 3 && r.rows[0].DESCRIPTION === 'Steel <rods> & "bolts"\nline two' && csvPod.calls.slice(-2).map((c) => c.format).join() === 'xml,csv', JSON.stringify(r).slice(0, 300));
    T.check('…the page sees your app\'s user, never a password', S3.settings().pods.filter((p) => p.id === p3.id)[0].username === csvPod.user && JSON.stringify(S3.settings()).indexOf(csvPod.password) === -1);

    T.section('deploy');
    const clean = await Pod.start({ tables: Array.from({ length: 5003 }, (_, i) => 'ZZ_T' + String(i).padStart(5, '0')) });
    pods.push(clean);
    dir = mk();
    const S4 = F.open(Object.assign({ file: path.join(dir, 'f.json'), cacheDir: path.join(dir, 'cache'), fetch: (u, i) => fetch(u, i), allowHttp: true }, seal));
    S4.savePod({ url: clean.url, login: 'own', username: clean.user, password: clean.password });
    let t = await S4.test();
    T.check('no runner yet: the test says so, with what to do', !t.ok && /not found/.test(t.error) && /Deploy the runner/.test(t.error));
    let d = await S4.deploy();
    T.check('deploy: folder, data model, report, then the test', d.ok && d.steps.length === 5 && /Folder made/.test(d.steps[1]) && clean.catalog['/Custom/BuildRite/QueryRunnerDM.xdm'].entry === '_datamodel.xdm' && clean.catalog['/Custom/BuildRite/QueryRunner.xdo'].entry === '_report.xdo', JSON.stringify(d));
    T.check('…the catalog calls carry Basic auth too', clean.calls.filter((c) => c.service === 'CatalogService').every((c) => c.basic === clean.user + ':' + clean.password));
    d = await S4.deploy();
    T.check('again: the folder already there, both objects replaced', d.ok && /already there/.test(d.steps[1]) && d.steps.filter((s) => /removed, to be replaced/.test(s)).length === 2);
    T.check('…the pod marked deployed and tested', !!S4.settings().pods[0].deployedAt && S4.settings().pods[0].testOk === true);

    T.section('the schema browser');
    const before = clean.sql.length;
    let o = await S4.owners();
    T.check('owners (PUBLIC added), then from the cache', o.ok && o.owners.join() === 'APPS,FUSION,FUSION_RO,PUBLIC' && !o.cached && (await S4.owners()).cached && clean.sql.length === before + 1);
    o = await S4.objects('', 'FUSION', 'TABLE');
    T.check('5,012 tables read in pages of 5,000 (ROW_NUMBER windows)', o.ok && o.names.length === 5012 && clean.sql.filter((s) => /rn BETWEEN 5001 AND 10000/.test(s)).length === 1 && !o.capped);
    const n2 = clean.sql.length;
    T.check('…then from the cache, until Refresh', (await S4.objects('', 'FUSION', 'TABLE')).cached && clean.sql.length === n2 && !(await S4.objects('', 'FUSION', 'TABLE', true)).cached);
    const det = await S4.detail('', 'FUSION', 'TABLE', 'AP_INVOICES_ALL');
    T.check('an object: columns (types, NOT NULL, comments), indexes, foreign keys, its comment', det.ok && det.columns.length === 6 && det.columns[0].type === 'NUMBER(18)' && !det.columns[0].nullable && det.indexes[0].unique && det.fks[0].ref === 'FUSION.POZ_SUPPLIERS' && det.comments === 'Payables invoices');
    T.check('…a name that is not one: refused', !(await S4.detail('', 'FUSION', 'TABLE', "X' OR 1=1")).ok);
    const se = await S4.search('', 'FUSION', 'TABLE', 'ap_inv');
    T.check('search: the dictionary, LIKE escaped', se.ok && se.names.indexOf('AP_INVOICES_ALL') !== -1 && clean.sql.some((s) => /LIKE '%AP\\_INV%' ESCAPE '\\'/.test(s)));
    T.check('the cache cleared', S4.clearCache().ok && !(await S4.owners()).cached);

    T.section('saved queries');
    let q = S4.saveQuery({ name: 'Open invoices', sql: 'select * from ap_invoices_all', description: 'all' });
    S4.saveQuery({ name: 'open INVOICES', sql: 'select invoice_id from ap_invoices_all' });
    T.check('saved; the same name (any case) replaces it', q.ok && S4.queries().queries.length === 1 && /invoice_id/.test(S4.queries().queries[0].sql));
    T.check('…a statement that is not a SELECT, or no name: refused', !S4.saveQuery({ name: 'x', sql: 'delete from t' }).ok && !S4.saveQuery({ name: '', sql: 'select 1 from dual' }).ok);
    S4.ranQuery(q.query.id);
    const imp = S4.importQueries([{ name: 'Suppliers', sql: 'select * from poz_suppliers' }, { name: 'Open invoices', sql: 'select 1 from dual' }, { name: 'Bad', sql: 'update t set x = 1' }]);
    T.check('import: new, replaced, skipped', imp.added === 1 && imp.updated === 1 && imp.skipped === 1 && S4.queries().queries.length === 2);
    T.check('…removed', S4.removeQuery(q.query.id).ok && S4.queries().queries.length === 1);

    T.section('Ask AI');
    await S4.objects('', 'FUSION', 'TABLE');
    await S4.detail('', 'FUSION', 'TABLE', 'AP_INVOICES_ALL');
    const asked = [];
    const chat = async (system, user) => {
      asked.push({ system, user });
      if (asked.length === 1) return { ok: true, provider: 'X', text: '```lookup\n[{"tool":"describe","name":"AP_INVOICES_ALL"},{"tool":"sample","sql":"select invoice_num from ap_invoices_all"},{"tool":"nope"}]\n```' };
      if (asked.length === 2) return { ok: true, provider: 'X', text: '```sql\nselect bad_col from ap_invoices_all\n```' };
      return { ok: true, provider: 'X', text: 'Done.\n```sql\nselect invoice_num from ap_invoices_all where vendor_id = {{V}};\n```' };
    };
    const a = await S4.ask({ question: 'invoices of a supplier', askId: 'q1', editorSql: 'select * from ap_invoices_all' }, chat);
    T.check('three turns: look-ups, a SQL the pod refused, the fixed one checked', a.ok && asked.length === 3 && a.checked && a.sql === 'select invoice_num from ap_invoices_all where vendor_id = {{V}}' && !a.checkError, JSON.stringify(a).slice(0, 400));
    T.check('…the look-ups\' answers sent back (columns, sample rows, an unknown tool said)', /INVOICE_AMOUNT NUMBER/.test(asked[1].user) && /INV-1001/.test(asked[1].user) && /unknown tool "nope"/.test(asked[1].user));
    T.check('…the starting hints (the cached tables the question names) and the editor\'s SQL', /STARTING HINTS[\s\S]*AP_INVOICES_ALL: INVOICE_ID, INVOICE_NUM/.test(asked[0].user) && /CURRENT EDITOR SQL/.test(asked[0].user));
    T.check('…the refusal sent back with the SQL', /Fusion answered:[\s\S]*ORA-00904[\s\S]*select bad_col/.test(asked[2].user));
    T.check('…its steps, for the page while it works', S4.progress('q1').done && S4.progress('q1').steps.map((s) => s.kind).join() === 'hints,ai,lookup,lookup,lookup,ai,check,checked,ai,check,checked');
    T.check('no AI set up: said', /Set up AI/.test((await S4.ask({ question: 'x' }, null)).error));
    const stubborn = await S4.ask({ question: 'x' }, async () => ({ ok: true, text: '```lookup\n[{"tool":"describe","name":"AP_INVOICES_ALL"}]\n```' }));
    T.check('an AI that only looks things up: stopped, said', !stubborn.ok && /did not answer/.test(stubborn.error));

    T.section('/__fsql/*');
    const DS = require('../desktop/lib/devserver');
    const port = 19500 + Math.floor(Math.random() * 400);
    const srv = await DS.createDevServer({ buildDir: path.join(ROOT, 'build'), webApp: 'buildrite', port, fusionSqlStore: S2, aiStore: { chat: async () => ({ ok: true, text: '```sql\nselect 1 as n from dual\n```' }) }, onLog: () => {} });
    try {
      let res = await request(port, 'GET', '/__fsql/settings');
      T.check('settings: the pods, never a password', res.json && res.json.ok && res.json.pods.length === 1 && res.text.indexOf(pod.password) === -1);
      res = await request(port, 'GET', '/__fsql/settings', null, { 'X-Build-Rite-FSQL': '0' });
      T.check('…not from Build.Rite (no header): refused', res.status === 403);
      res = await request(port, 'POST', '/__fsql/run', { sql: 'select invoice_num from ap_invoices_all', rowLimit: 3 });
      T.check('run', res.json && res.json.ok && res.json.rowCount === 3);
      res = await request(port, 'POST', '/__fsql/ask', { question: 'one', askId: 'r1' });
      T.check('ask (the SQL AI), checked on the pod', res.json && res.json.ok && res.json.checked && res.json.sql === 'select 1 as n from dual');
      res = await request(port, 'GET', '/__fsql/schema/detail?owner=FUSION&kind=TABLE&name=AP_INVOICES_ALL');
      T.check('the schema browser', res.json && res.json.ok && res.json.columns.length === 6);
      res = await request(port, 'GET', '/__fsql/calls');
      T.check('the call log, password ***', res.json && res.json.calls.length > 0 && res.text.indexOf(pod.password) === -1);
    } finally { await srv.close(); }
    const none = await DS.createDevServer({ buildDir: path.join(ROOT, 'build'), webApp: 'buildrite', port: port + 1, onLog: () => {} });
    try {
      const res = await request(port + 1, 'GET', '/__fsql/settings');
      T.check('without the desktop app: said', res.json && res.json.unavailable && /desktop app/.test(res.json.error));
    } finally { await none.close(); }
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    for (const p of pods) await p.close();
    tmp.forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* tmp */ } });
  }
  T.report();
})();
