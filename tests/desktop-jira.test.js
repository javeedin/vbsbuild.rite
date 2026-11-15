/*
 * Connect Jira in the desktop app (desktop/lib/jiraAuth.js, served by desktop/lib/devserver.js at /__jira/*), for the
 * Jira stories screens: the site, email, API token and project key kept on this PC with the token encrypted and never
 * sent back to the page; /__jira/* only for this PC's own page (the X-Build-Rite-Jira header); the token added only to
 * calls to the jira backend (/__backend/jira), never to another backend.
 *
 * Run:  node tests/desktop-jira.test.js
 */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const DS = require(path.join(ROOT, 'desktop', 'lib', 'devserver.js'));
const JA = require(path.join(ROOT, 'desktop', 'lib', 'jiraAuth.js'));

const enc = (t) => Buffer.from('enc:' + Buffer.from(t).toString('base64'));
const dec = (b) => Buffer.from(String(b).replace(/^enc:/, ''), 'base64').toString();

T.section('the store');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-jira-'));
const file = path.join(dir, 'jira-connection.json');
const store = JA.open({ file, encrypt: enc, decrypt: dec });
T.eq('not connected at first, and no site of its own', JSON.stringify(store.settings()), JSON.stringify({ site: '', project: '', email: '', hasToken: false, connected: false, keychain: true }));
T.eq('a site from a word, a host or a URL', ['acme', 'acme.atlassian.net', 'https://Acme.atlassian.net/jira/software'].map(JA.normaliseSite).join(' '),
  'https://acme.atlassian.net https://acme.atlassian.net https://acme.atlassian.net');
T.eq('…not another host', JA.normaliseSite('https://evil.example.com'), '');
let threw = '';
try { store.save({ email: 'sam@example.com', token: 'x' }); } catch (e) { threw = e.message; }
T.eq('a site is needed (none of its own)', threw, 'Enter your Jira site (https://<your-site>.atlassian.net).');
threw = '';
try { store.save({ site: 'acme', email: 'not-an-email', token: 'x' }); } catch (e) { threw = e.message; }
T.eq('an email is needed', threw, 'Enter the email you sign in to Jira with.');
threw = '';
try { store.save({ site: 'acme', email: 'sam@example.com', token: 'x', project: 'not a key' }); } catch (e) { threw = e.message; }
T.check('a project key is letters and digits', !!threw, threw);
const s1 = store.save({ site: 'acme', email: 'sam@example.com', token: 'ATATT-secret-1', project: 'abc' });
T.check('…the project key kept upper-cased, with the site', s1.project === 'ABC' && s1.site === 'https://acme.atlassian.net' && store.auth().project === 'ABC' && store.auth().site === 'https://acme.atlassian.net', JSON.stringify(s1));
T.check('saved: connected, and the token never comes back', s1.connected && s1.hasToken && JSON.stringify(s1).indexOf('ATATT') === -1);
T.check('…kept encrypted on disk', fs.readFileSync(file, 'utf8').indexOf('ATATT') === -1);
T.eq('…the proxy\'s header', store.auth().header, 'Basic ' + Buffer.from('sam@example.com:ATATT-secret-1').toString('base64'));
store.save({ site: 'acme', email: 'sam@example.com', token: '' });
T.check('an empty token keeps the saved one (and no project given keeps the project)', store.settings().project === 'ABC' && store.auth().header.endsWith(Buffer.from('sam@example.com:ATATT-secret-1').toString('base64')));
T.check('read back by a new run', JA.open({ file, encrypt: enc, decrypt: dec }).settings().connected);
const noKeychain = JA.open({ file: path.join(dir, 'nk.json'), encrypt: null, decrypt: null });
noKeychain.save({ site: 'acme', email: 'a@b.co', token: 'T1' });
T.check('without a keychain: this run only, nothing on disk', noKeychain.auth() && fs.readFileSync(path.join(dir, 'nk.json'), 'utf8').indexOf('T1') === -1
  && !JA.open({ file: path.join(dir, 'nk.json') }).settings().hasToken);

(async () => {
  T.section('the server: /__jira/* and the jira backend');
  const seen = [];
  const backend = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization || '' });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"displayName":"Sam"}');
  });
  await new Promise((r) => backend.listen(0, '127.0.0.1', r));
  const fake = `http://127.0.0.1:${backend.address().port}`;
  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'br-build-'));
  const web = path.join(build, 'processed', 'webApps', 'buildrite');
  fs.mkdirSync(path.join(web, 'version_1'), { recursive: true });
  fs.mkdirSync(path.join(build, 'processed', 'services'), { recursive: true });
  fs.writeFileSync(path.join(web, 'index.html'), '<html>build.rite</html>');
  // the jira backend (Build.Rite's own) and another one (the sample app's shop)
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', 'catalog.json'), 'utf8'));
  cat.backends.shop = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'vb-sample', 'services', 'catalog.json'), 'utf8')).backends.shop;
  fs.writeFileSync(path.join(build, 'processed', 'services', 'catalog.json'), JSON.stringify(cat));
  const live = JA.open({ file: path.join(dir, 'live.json'), encrypt: enc, decrypt: dec });
  const srv = await DS.createDevServer({ buildDir: build, webApp: 'buildrite', repoRoot: ROOT, port: 0, getIdentity: () => ({ username: 'sam' }),
    backendOverrides: { jira: fake, shop: fake }, jiraStore: live, onLog: () => {} });
  const req = (method, p, headers, body) => new Promise((resolve, reject) => {
    const r = http.request({ host: 'localhost', port: srv.port, path: p, method, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}) }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
  const H1 = { 'x-build-rite-jira': '1' };
  try {
    T.eq('without the page\'s header: refused', (await req('GET', '/__jira/settings')).status, 403);
    T.eq('from another site: refused', (await req('GET', '/__jira/settings', Object.assign({ origin: 'https://evil.example.com' }, H1))).status, 403);
    T.check('the page reads the connection (no token)', JSON.parse((await req('GET', '/__jira/settings', H1)).body).connected === false);
    const saved = JSON.parse((await req('POST', '/__jira/settings', H1, { site: 'acme', email: 'sam@example.com', token: 'ATATT-2', project: 'ABC' })).body);
    T.check('Connect Jira: saved with its project key, and the token is not in the answer', saved.connected && saved.project === 'ABC' && JSON.stringify(saved).indexOf('ATATT') === -1);
    T.eq('…a bad one says why', JSON.parse((await req('POST', '/__jira/settings', H1, { site: 'evil.example.com', email: 'a@b.co' })).body).error,
      'That is not a Jira Cloud address (https://<your-site>.atlassian.net).');
    await req('GET', '/__backend/jira/rest/api/2/myself');
    await req('GET', '/__backend/shop/v1/orders');
    T.eq('the jira backend gets the token; another backend never does', seen.map((x) => x.url.split('?')[0] + ' ' + (x.auth ? 'Basic' : 'none')).join(' | '),
      '/rest/api/2/myself Basic | /v1/orders none');
    T.eq('…the right one', seen[0].auth, 'Basic ' + Buffer.from('sam@example.com:ATATT-2').toString('base64'));
    const gone = JSON.parse((await req('POST', '/__jira/forget', H1, {})).body);
    seen.length = 0;
    await req('GET', '/__backend/jira/rest/api/2/myself');
    T.check('Disconnect: forgotten, and calls go without it', !gone.connected && seen[0].auth === '');
  } finally {
    await srv.close();
    backend.close();
  }
  T.report();
})();
