#!/usr/bin/env node
'use strict';
/**
 * The local server runs any VB app as it is (desktop/lib/devserver.js), never one app's names:
 *   - every backend that signs in (a VB credential) gets the app's login, whatever it is named; a login given for one
 *     credential goes to the backends using it; a backend that does not sign in gets none
 *   - service connections inside the app (webApps/<app>/services/catalog.json, which the build does not copy) are
 *     served and forwarded like the project's
 *   - a 404 page from a signed-in backend (Fusion answers a wrong login so) is said as a refused login
 */
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const H = require('./_harness');
const DS = require('../desktop/lib/devserver');

const T = H.makeAsserter();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'br-devgen-'));
const get = (url, headers) => new Promise((resolve) => {
  http.get(url, { headers: headers || {} }, (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') })); })
    .on('error', (e) => resolve({ status: 0, body: e.message }));
});

(async () => {
  const seen = [];
  // a stand-in backend: says what it got; /missing answers a 404 page as Fusion's gateway does
  const backend = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization || '' });
    if (/missing/.test(req.url)) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<html><body>Not Found</body></html>'); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
  });
  await new Promise((r) => backend.listen(0, '127.0.0.1', r));
  const B = 'http://127.0.0.1:' + backend.address().port;
  let srv = null;
  try {
    T.section('the login, whatever the backend is named');
    const id = { username: 'priya.raman', fusion: { user: 'priya.raman', password: 'pw-one' }, logins: { vb_oic_credential: { user: 'oic.user', password: 'pw-two' } } };
    T.check('a backend that signs in: the app\'s login', DS.loginFor({ basic: true, credentials: 'vb_any' }, id).user === 'priya.raman');
    T.check('…a login given for its credential: that one', DS.loginFor({ basic: true, credentials: 'vb_oic_credential' }, id).user === 'oic.user');
    T.check('…a backend that does not sign in: none', DS.loginFor({ basic: false, credentials: '' }, id) === null);
    T.check('…no login at all: none', DS.loginFor({ basic: true, credentials: 'x' }, { username: 'a' }) === null);
    T.check('the app\'s main credential: the one most backends share (not a name)', DS.fusionCredential({ a: { basic: true, credentials: 'c1' }, b: { basic: true, credentials: 'c2' }, c: { basic: true, credentials: 'c2' }, d: { basic: false } }) === 'c2');

    T.section('service connections inside the app, served and forwarded');
    // a built app with no project-level catalog (processed/services/catalog.json): its own is in its source
    const repo = path.join(tmp, 'project');
    const build = path.join(tmp, 'build');
    fs.mkdirSync(path.join(build, 'processed', 'webApps', 'shop', 'version_1'), { recursive: true });
    fs.writeFileSync(path.join(build, 'processed', 'webApps', 'shop', 'index.html'), '<html><head></head><body>shop</body></html>');
    fs.writeFileSync(path.join(build, 'processed', 'webApps', 'shop', 'version_1', 'app-flow.json'), '{"id":"shop"}');
    fs.mkdirSync(path.join(repo, 'webApps', 'shop', 'services'), { recursive: true });
    const signs = (cred) => ({ authentication: { authenticated: { type: 'basic', credentials: cred } }, forceProxy: 'always' });
    fs.writeFileSync(path.join(repo, 'webApps', 'shop', 'services', 'catalog.json'), JSON.stringify({ backends: {
      Fusion_PWP: { servers: [{ url: B, 'x-vb': signs('vb_main') }] },
      callPWPBIP: { servers: [{ url: B, 'x-vb': signs('vb_main') }] },
      oicApp: { servers: [{ url: B, 'x-vb': signs('vb_oic_credential') }] },
      openApi: { servers: [{ url: B, 'x-vb': { anonymousAccess: true } }] } } }));
    const problems = [];
    srv = await DS.createDevServer({ buildDir: build, repoRoot: repo, webApp: 'shop', port: 0, getIdentity: () => id, onProblem: (p) => problems.push(p) });
    const base = srv.url.replace(/\/$/, '');
    const cat = await get(base + '/version_1/services/catalog.json');
    const cj = JSON.parse(cat.body || '{}');
    T.check('the app\'s own catalog served, each backend pointed at this server', cat.status === 200 && Object.keys(cj.backends || {}).sort().join() === 'Fusion_PWP,callPWPBIP,oicApp,openApi'
      && /\/__backend\/Fusion_PWP$/.test(cj.backends.Fusion_PWP.servers[0].url) && !cj.backends.Fusion_PWP.servers[0]['x-vb'].authentication, cat.body.slice(0, 300));
    await get(base + '/__backend/Fusion_PWP/fscmRestApi/resources/x');
    await get(base + '/__backend/callPWPBIP/xmlpserver/y');
    await get(base + '/__backend/oicApp/ic/api/z');
    await get(base + '/__backend/openApi/v1/w');
    const authOf = (u) => { const s = seen.find((x) => x.url.indexOf(u) === 0); return s ? Buffer.from(s.auth.replace(/^Basic /, ''), 'base64').toString('utf8').split(':')[0] : '?'; };
    T.check('Fusion_PWP and callPWPBIP (no "fusion" in sight): the app\'s login', authOf('/fscmRestApi') === 'priya.raman' && authOf('/xmlpserver') === 'priya.raman', JSON.stringify(seen));
    T.check('…oicApp: the login given for its credential', authOf('/ic/api') === 'oic.user');
    T.check('…openApi (no sign-in): no login sent', seen.find((x) => x.url.indexOf('/v1/w') === 0).auth === '');

    T.section('a 404 page from a backend that signs in');
    await get(base + '/__backend/Fusion_PWP/fscmRestApi/missing');
    T.check('said as a refused login (Fusion answers a wrong login with a 404 page)', problems.some((p) => p.kind === 'refused' && p.status === 404 && p.backend === 'Fusion_PWP'), JSON.stringify(problems));
    await get(base + '/__backend/openApi/missing');
    T.check('…from one that does not sign in: just a 404', !problems.some((p) => p.backend === 'openApi'));
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    if (srv) await srv.close();
    backend.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  T.report();
})();
