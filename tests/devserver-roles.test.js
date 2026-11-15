/*
 * Who your workspace's app runs as, answered on this PC (desktop/lib/devserver.js; Run as in the Run console):
 *   - /_currentuser carries the roles chosen (VB's $application.user.roles) after VB's own authenticated-user role
 *   - an app that reads its user's roles from a BI Publisher report (o.rolesReport: the report its own code names, found
 *     by desktop/lib/appRoles.js) gets that one report answered here with those roles, in the shape Fusion returns —
 *     never forwarded; any other report goes to BI Publisher as before
 *   - no roles chosen, or no roles report known: forwarded (the roles come from the backend, with the Fusion login)
 *
 * Run:  node tests/devserver-roles.test.js
 */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const DS = require('../desktop/lib/devserver');
const AR = require('../desktop/lib/appRoles');

const T = H.makeAsserter();
const REPORT = AR.rolesReportIn(H.FIXTURE, 'shop');
const soap = (report, params) => '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:pub="http://xmlns.oracle.com/oxp/service/PublicReportService">'
  + '<soap:Body><pub:runReport><pub:reportRequest><pub:reportAbsolutePath>' + report + '</pub:reportAbsolutePath>'
  + (params || []).map((p) => '<pub:item><pub:name>' + p[0] + '</pub:name><pub:values><pub:item>' + p[1] + '</pub:item></pub:values></pub:item>').join('')
  + '</pub:reportRequest></pub:runReport></soap:Body></soap:Envelope>';
const rolesIn = (body) => { const m = /<ns2:reportBytes>([^<]+)</.exec(body || ''); const xml = m ? Buffer.from(m[1], 'base64').toString('utf8') : ''; return Array.from(xml.matchAll(/<ORACLE_ROLE_COMMON_NAME>([^<]*)</g)).map((x) => x[1]); };

T.section('the pieces');
T.eq('the sample app\'s roles report, found in its own code', REPORT, '/Custom/Shop/USER_ROLES.xdo');
const rolesBody = soap(REPORT, [['P_LOGIN', 'priya.raman']]);
T.check('the app\'s roles report is recognised — only with the report given', DS.isRolesReport(rolesBody, REPORT) && !DS.isRolesReport(rolesBody, '') && !DS.isRolesReport(rolesBody, undefined));
T.check('another report is not', !DS.isRolesReport(soap('/Custom/Shop/CUSTOMERS_RP.xdo'), REPORT));
T.check('…nor a call that only names it (not a runReport)', !DS.isRolesReport('<x>' + REPORT + '</x>', REPORT));
const ans = DS.rolesReportResponse('priya.raman', ['SHOP_ADMIN', 'SHOP_CLERK']);
T.check('the answer: Fusion\'s shape (runReportResponse, base64 report bytes), a row per role', /runReportResponse/.test(ans) && rolesIn(ans).join() === 'SHOP_ADMIN,SHOP_CLERK');
T.check('names are XML-escaped', /a&lt;b/.test(Buffer.from(/<ns2:reportBytes>([^<]+)</.exec(DS.rolesReportResponse('a<b', ['X']))[1], 'base64').toString()));
const cu = DS.currentUser({ username: 'priya.raman', roles: ['SHOP_ADMIN'] });
T.check('/_currentuser: VB\'s authenticated-user role, then the roles chosen', cu.roles.join() === 'approle.authenticated.user,SHOP_ADMIN' && DS.currentUser({ username: 'x' }).roles.join() === 'approle.authenticated.user');

function call(port, p, opts) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: (opts && opts.method) || 'GET', headers: { host: `localhost:${port}` } }, (res) => {
      let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end(opts && opts.body);
  });
}

(async () => {
  T.section('served: the app\'s roles report answered with the roles chosen');
  const seen = [];
  const backend = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => { seen.push({ url: req.url, auth: req.headers.authorization || '', body: b }); res.writeHead(200, { 'content-type': 'application/soap+xml' }); res.end('<from-fusion/>'); });
  });
  await new Promise((r) => backend.listen(0, '127.0.0.1', r));
  const fake = `http://127.0.0.1:${backend.address().port}`;
  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'br-roles-'));
  const web = path.join(build, 'processed', 'webApps', 'shop');
  fs.mkdirSync(web, { recursive: true });
  fs.mkdirSync(path.join(build, 'processed', 'services'), { recursive: true });
  fs.writeFileSync(path.join(web, 'index.html'), '<html>shop</html>');
  fs.copyFileSync(path.join(H.SERVICES, 'catalog.json'), path.join(build, 'processed', 'services', 'catalog.json'));
  let identity = { username: 'priya.raman', roles: ['SHOP_ADMIN', 'SHOP_CLERK'], fusion: { user: 'tech.user', password: 'pw' } };
  let report = REPORT;
  const logs = [];
  const srv = await DS.createDevServer({ buildDir: build, repoRoot: H.FIXTURE, webApp: 'shop', port: 0, getIdentity: () => identity,
    rolesReport: () => report, backendOverrides: { shop: fake, bipservice: fake, fusion: fake }, onLog: (l) => logs.push(l) });
  const BIP = '/__backend/bipService/xmlpserver/services/ExternalReportWSSService';
  try {
    const me = JSON.parse((await call(srv.port, '/_currentuser')).body);
    T.check('/_currentuser: who it runs as, with the roles chosen', me.userName === 'priya.raman' && me.roles.join() === 'approle.authenticated.user,SHOP_ADMIN,SHOP_CLERK', JSON.stringify(me.roles));
    const r1 = await call(srv.port, BIP, { method: 'POST', body: rolesBody });
    T.check('the roles report: answered here with those roles, never forwarded', r1.status === 200 && rolesIn(r1.body).join() === 'SHOP_ADMIN,SHOP_CLERK' && seen.length === 0, r1.body.slice(0, 200));
    T.check('…said in the backend-calls log', logs.some((l) => /roles answered locally: SHOP_ADMIN, SHOP_CLERK/.test(l)), logs.join(' | '));
    await call(srv.port, BIP, { method: 'POST', body: soap('/Custom/Shop/CUSTOMERS_RP.xdo', [['P_CUSTOMER_ID', '']]) });
    T.check('another report: forwarded to BI Publisher, with the Fusion login', seen.length === 1 && /CUSTOMERS_RP/.test(seen[0].body) && seen[0].auth === 'Basic ' + Buffer.from('tech.user:pw').toString('base64'));
    identity = { username: 'priya.raman', roles: null, fusion: { user: 'tech.user', password: 'pw' } };
    await call(srv.port, BIP, { method: 'POST', body: rolesBody });
    T.check('no roles chosen: the roles report goes to BI Publisher (the user\'s own roles, with the login)', seen.length === 2 && /USER_ROLES/.test(seen[1].body) && /^Basic /.test(seen[1].auth));
    identity = { username: 'priya.raman', roles: ['SHOP_VIEWER'], fusion: null };
    report = '';
    await call(srv.port, BIP, { method: 'POST', body: rolesBody });
    T.check('no roles report known for the app: nothing answered here (forwarded)', seen.length === 3);
    report = REPORT;
    const r2 = await call(srv.port, BIP, { method: 'POST', body: rolesBody });
    T.check('Run as changed: the next call answers with the new roles (read on each request)', rolesIn(r2.body).join() === 'SHOP_VIEWER' && seen.length === 3);
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    await srv.close();
    backend.close();
    fs.rmSync(build, { recursive: true, force: true });
  }
  T.report();
})();
