/*
 * The local server (desktop/lib/devserver.js) that serves a built Visual Builder app on this PC — Build.Rite's own, or
 * your workspace's app when Build.Rite runs it — doing what VB Studio's server does for a deployed app:
 *   - the app's files from build/processed (the shell for a deep route; never a file outside it)
 *   - app-flow.json's %{env.userProfileUrl}% filled with /_currentuser, and /_currentuser the identity given
 *   - services/catalog.json next to the app, every backend pointed at /__backend/<name> on its own origin (no VB proxy,
 *     no credential reference)
 *   - /__backend/<name>/… forwarded to the backend's real address: anonymous backends get nothing, the Fusion ones
 *     (fusion, bipService) the Fusion login as basic auth; a 401 challenge never reaches the page
 *   - a refused or missing login and an unreachable backend reported (onProblem), the report named
 *   - the web services page (/__services: every operation of the app's service connections)
 *   - this PC only; BUILDRITE_BACKEND_<NAME> and BUILDRITE_USER/ROLES/FUSION_* read from the environment
 * The roles answered here (Run as): tests/devserver-roles.test.js.
 *
 * Run:  node tests/desktop-devserver.test.js
 */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const H = require('./_harness');

const T = H.makeAsserter();
const DS = require('../desktop/lib/devserver');
const CAT = require('../desktop/lib/catalog');

const soap = (report, params) => '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:pub="http://xmlns.oracle.com/oxp/service/PublicReportService">'
  + '<soap:Body><pub:runReport><pub:reportRequest><pub:reportAbsolutePath>' + report + '</pub:reportAbsolutePath>'
  + (params || []).map((p) => '<pub:item><pub:name>' + p[0] + '</pub:name><pub:values><pub:item>' + p[1] + '</pub:item></pub:values></pub:item>').join('')
  + '</pub:reportRequest></pub:runReport></soap:Body></soap:Envelope>';

// ── the catalog ──────────────────────────────────────────────────────

T.section('catalog — every backend through this server, nothing through VB Studio');
const realCatalog = H.readJson(path.join(H.SERVICES, 'catalog.json'));
const { catalog, backends } = DS.rewriteCatalog(realCatalog, 'http://localhost:18893');
const servers = Object.keys(catalog.backends).map((n) => [n, catalog.backends[n].servers[0]]);
T.check('every backend points at /__backend/<name>', servers.length === 3 && servers.every(([n, s]) => s.url === `http://localhost:18893/__backend/${n}`));
T.check('no forceProxy left', servers.every(([, s]) => !s['x-vb'].forceProxy));
T.check('no VB Studio credential reference left', servers.every(([, s]) => !s['x-vb'].authentication));
T.eq('shop keeps its real address for forwarding', backends.shop.url, 'https://shop.example.com/api');
T.eq('shop is anonymous', backends.shop.basic, false);
T.check('the Fusion credential is the one bipService and fusion share', DS.fusionCredential(backends) === backends.bipService.credentials && backends.fusion.credentials === backends.bipService.credentials);
T.check('the source catalog is not modified', realCatalog.backends.shop.servers[0]['x-vb'].forceProxy === 'always');

// ── the user ─────────────────────────────────────────────────────────

T.section('user — what VB reads from /_currentuser');
T.eq('profile URL placeholder filled', DS.fillAppFlow('{"url": "%{env.userProfileUrl}%", "oauthUrl": "%{env.oauthUserProfileUrl}%"}'), '{"url": "/_currentuser", "oauthUrl": ""}');
const user = DS.currentUser({ username: 'priya.raman', fullName: 'Priya Raman', email: 'priya.raman@example.com' });
T.eq('isAnonymous is exactly false (VB ignores the user otherwise)', user.isAnonymous, false);
T.check('userName, full name and email carried', user.userName === 'priya.raman' && user.fullName === 'Priya Raman' && user.email === 'priya.raman@example.com');
T.eq('no identity -> anonymous', DS.currentUser(null).isAnonymous, true);

// ── the environment ─────────────────────────────────────────────────

T.section('the environment: who the app runs as, a backend moved for a run');
const idEnv = DS.identityFromEnv({ BUILDRITE_USER: 'sam.lee', BUILDRITE_ROLES: 'shop_admin, SHOP_CLERK', BUILDRITE_FUSION_PASSWORD: 'pw' });
T.check('BUILDRITE_USER and BUILDRITE_ROLES (upper-cased); BUILDRITE_FUSION_PASSWORD with the user as the Fusion user', idEnv.username === 'sam.lee' && idEnv.roles.join() === 'SHOP_ADMIN,SHOP_CLERK'
  && idEnv.fusion.user === 'sam.lee' && idEnv.fusion.password === 'pw', JSON.stringify(idEnv));
T.check('…nothing set: anonymous, no roles, no login', !DS.identityFromEnv({}).username && DS.identityFromEnv({}).roles === null && DS.identityFromEnv({}).fusion === null);
T.eq('BUILDRITE_BACKEND_<NAME>=url points one backend elsewhere', JSON.stringify(DS.backendOverridesFromEnv({ BUILDRITE_BACKEND_SHOP: 'http://127.0.0.1:9/', OTHER: 'x' })), JSON.stringify({ shop: 'http://127.0.0.1:9' }));

// ── the web services page's data ─────────────────────────────────────

T.section('web services — every operation, its parameters and its callers');
const ws = CAT.buildCatalog(H.FIXTURE);
const opsIn = (svc) => { const d = H.readJson(path.join(H.SERVICES, svc, 'openapi3.json')); return Object.keys(d.paths).reduce((n, p) => n + Object.keys(d.paths[p]).filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).length, 0); };
T.eq('one row per operation in services/', ws.rows.length, ['shopApi', 'bipService', 'fusionLov'].reduce((n, s) => n + opsIn(s), 0));
const orders = ws.rows.find((r) => r.o === 'getOrders');
T.check('query parameters read', !!orders && orders.params.map((p) => p.name + ':' + p.in).join() === 'limit:query,q:query,status:query');
T.check('callers found (the chains that call it)', !!orders && orders.f.some((f) => /order-list-page-chains\/LoadOrdersChain\.js$/.test(f)) && orders.f.some((f) => /LoadDashboardChain\.js$/.test(f)), JSON.stringify(orders && orders.f));
const one = ws.rows.find((r) => r.o === 'getOrderById');
T.check('a path parameter from the path template', !!one && one.params.some((p) => p.name === 'id' && p.in === 'path' && p.required));
T.eq('shopApi is anonymous', ws.services.find((s) => s.name === 'shopApi').auth, 'anon');
T.check('the Fusion services sign in with a login (a VB credential: the app\'s login stands in)', ws.services.find((s) => s.name === 'fusionLov').auth === 'login' && ws.services.find((s) => s.name === 'bipService').auth === 'login');
T.eq('double-encoded dash repaired', CAT.fixMojibake('a â€” b'), 'a — b');
T.eq('ordinary accents left alone', CAT.fixMojibake('Ångström café'), 'Ångström café');

// ── the server, for real ─────────────────────────────────────────────

function get(port, p, opts) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: (opts && opts.method) || 'GET',
      headers: Object.assign({ host: `localhost:${port}` }, (opts && opts.headers) || {}) }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(opts && opts.body);
  });
}

(async () => {
  T.section('server — files, user, catalog and forwarding');
  const seen = [];
  const backend = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization || '', body: b });
      res.writeHead(401, { 'www-authenticate': 'Basic realm="x"', 'content-type': 'application/json' });
      res.end('{"seen":true}');
    });
  });
  await new Promise((r) => backend.listen(0, '127.0.0.1', r));
  const fake = `http://127.0.0.1:${backend.address().port}`;

  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'br-build-'));
  const web = path.join(build, 'processed', 'webApps', 'shop');
  fs.mkdirSync(path.join(web, 'version_1'), { recursive: true });
  fs.mkdirSync(path.join(build, 'processed', 'services'), { recursive: true });
  fs.writeFileSync(path.join(web, 'index.html'), '<html>shell</html>');
  fs.writeFileSync(path.join(web, 'version_1', 'app-flow.json'), '{"url":"%{env.userProfileUrl}%"}');
  fs.writeFileSync(path.join(build, 'processed', 'secret.txt'), 'outside the web root');
  fs.writeFileSync(path.join(build, 'processed', 'services', 'catalog.json'), JSON.stringify(realCatalog));

  let identity = { username: 'priya.raman', roles: null, fusion: { user: 'tech.user', password: 'pw' } };
  const problems = [];
  const logs = [];
  const srv = await DS.createDevServer({
    buildDir: build, repoRoot: H.FIXTURE, webApp: 'shop', port: 0, getIdentity: () => identity,
    backendOverrides: { shop: fake, bipservice: fake, fusion: fake },
    onProblem: (p) => problems.push(p),
    onLog: (l) => logs.push(l),
  });
  const P = srv.port;
  try {
    T.check('its address: localhost, the port it took', /^http:\/\/localhost:\d+\/$/.test(srv.url) && srv.port > 0, srv.url);
    T.eq('/ serves the app', (await get(P, '/')).body, '<html>shell</html>');
    T.eq('a deep route gets the app shell (router "path")', (await get(P, '/vp/shell/orders/order-list')).body, '<html>shell</html>');
    T.eq('…an address that starts with two slashes too', (await get(P, '//vp/shell')).body, '<html>shell</html>');
    T.eq('a missing asset is a 404', (await get(P, '/nope.js')).status, 404);
    T.check('cannot read outside the web root', (await get(P, '/../../secret.txt')).body.indexOf('outside') < 0
      && (await get(P, '/%2e%2e/%2e%2e/secret.txt')).body.indexOf('outside') < 0);
    T.eq('app-flow.json gets the profile URL', (await get(P, '/version_1/app-flow.json')).body, '{"url":"/_currentuser"}');
    T.eq('/_currentuser is the identity given', JSON.parse((await get(P, '/_currentuser')).body).userName, 'priya.raman');
    const cat = JSON.parse((await get(P, '/version_1/services/catalog.json')).body);
    T.eq('catalog served next to the web app, on the page\'s own origin', cat.backends.shop.servers[0].url, `http://localhost:${P}/__backend/shop`);

    await get(P, '/__backend/shop/shop/v1/orders?status=OPEN&limit=5');
    T.eq('shop: path and query forwarded', seen[0] && seen[0].url, '/shop/v1/orders?status=OPEN&limit=5');
    T.eq('shop: no credentials sent (anonymous, as in VB Studio)', seen[0] && seen[0].auth, '');
    const r401 = await get(P, '/__backend/fusion/fscmRestApi/resources/x');
    T.eq('fusion: the Fusion login as basic auth', seen[1] && seen[1].auth, `Basic ${Buffer.from('tech.user:pw').toString('base64')}`);
    T.eq('a 401 challenge is not passed on (no browser login box)', r401.headers['www-authenticate'], undefined);

    T.section('server — refused calls are reported, not left as silently empty lists');
    const refusedP = problems.find((p) => p.kind === 'refused' && p.backend === 'fusion');
    T.check('a refused Fusion login is reported', !!refusedP, JSON.stringify(problems));
    T.check('…and names the exact call that failed (so the user sees which API 401d)', !!refusedP
      && refusedP.method === 'GET' && refusedP.path === '/fscmRestApi/resources/x' && /\/fscmRestApi\/resources\/x$/.test(refusedP.url || ''), JSON.stringify(refusedP));
    identity = { username: 'priya.raman', roles: ['SHOP_CLERK'], fusion: null };
    problems.length = 0;
    const customers = soap('/Custom/Shop/CUSTOMERS_RP.xdo', [['P_CUSTOMER_ID', '']]);
    await get(P, '/__backend/bipService/xmlpserver/services/ExternalReportWSSService', { method: 'POST', body: customers });
    T.check('a report without a Fusion login -> "no-login", naming the report', problems.length === 1 && problems[0].kind === 'no-login' && problems[0].report === 'CUSTOMERS_RP', JSON.stringify(problems));
    T.check('the backend-calls log names the report and the way out', logs.some((l) => /bipService CUSTOMERS_RP -> 401 .*no login for it: File > Sign in for your app/.test(l)), logs.slice(-3).join(' | '));
    T.eq('report name read from the request', DS.reportName(customers), 'CUSTOMERS_RP');

    const page = await get(P, '/__services/');
    T.check('web services page served', page.status === 200 && /web-services\.js/.test(page.body));
    T.eq('its script served', (await get(P, '/__services/web-services.js')).status, 200);
    const wsData = await get(P, '/__services/data.json');
    const wsJson = JSON.parse(wsData.body);
    T.check('its data: the app\'s operations, with who it runs as', wsJson.rows.length === ws.rows.length && wsJson.identity.username === 'priya.raman', wsJson.rows.length + ' rows');
    T.check('…and never the password', wsJson.identity.hasFusionLogin === false && wsData.body.indexOf('"pw"') < 0);

    backend.close();
    const down = await get(P, '/__backend/shop/x');
    T.check('backend down -> 502 that names the backend', down.status === 502 && /shop/.test(down.body) && /Build\.Rite's local server/.test(down.body), down.body);
    T.check('…and reported as unreachable', problems.some((p) => p.kind === 'unreachable' && p.backend === 'shop'));

    T.section('isBuilt; the port taken');
    T.check('isBuilt: the app built here, another not', DS.isBuilt(build, 'shop') && !DS.isBuilt(build, 'other-app'));
    let taken = '';
    try { await DS.createDevServer({ buildDir: build, webApp: 'shop', port: P, getIdentity: () => identity }); } catch (e) { taken = e.message; }
    T.check('the same port twice: said, with what to do', /already in use/.test(taken) && /BUILDRITE_PORT/.test(taken), taken);
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    await srv.close();
    try { backend.close(); } catch (e) { /* closed */ }
    fs.rmSync(build, { recursive: true, force: true });
  }
  T.report();
})();
