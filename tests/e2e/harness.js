'use strict';
/*
 * Browser runs of Build.Rite against stand-ins.
 *
 * Serves Build.Rite's build (build/processed/webApps/buildrite — run `npm run build` first) on a local server, as the
 * desktop app does, with the stand-in stores a script passes (the desktop app's engines: VB Studio, Code fix, Issues,
 * the pages catalog, Jira, SQL…); points every backend (jira, and any other) at one fake HTTP server; opens Chromium
 * with Playwright and records what the page sends.
 *
 *   const E = require('./harness');
 *   const env = await E.start({ port: 19100, handle: (req, res) => { if (req.path === '/rest/api/2/search/jql') return res.json({ issues: [] }); } });
 *   await env.open('/?open=jira');
 *   ...
 *   env.writes     // [{ method, path, query, body }] every non-GET backend call
 *   env.calls      // ['GET /rest/api/2/...?...'] every backend call
 *   env.errors     // browser console errors and warnings (VB's routine warnings left out)
 *   await env.shot('jira.png')
 *   await env.close()
 *
 * Not part of `npm test` (needs a build and Chromium): `node tests/e2e/run-all.js`, or one `node tests/e2e/<file>.e2e.js`.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'vb-sample');
const DS = require(path.join(ROOT, 'desktop', 'lib', 'devserver.js'));

const QUIET = /not fully qualified|Skip URL mapping/;
// the desktop app's engines a script can stand in for (passed to Build.Rite's local server as they are)
const STORES = ['sqlStore', 'aiStore', 'jiraStore', 'recStore', 'transcribe', 'minutesStore', 'followupsStore', 'fddStore', 'analysisStore', 'pagesStore',
  'fixStore', 'issuesStore', 'apiStore', 'apiProject', 'scenarioStore', 'vbsStore', 'vbsFind', 'vbsRun', 'vbsConsole', 'vbsOpenPath', 'vbsPickFolder'];

/** A BI Publisher runReport SOAP answer whose report holds `rows` (each a { TAG: value } object) as G_1 rows. */
function bipReport(rows) {
  const xml = '<DATA_DS>' + rows.map((r) => '<G_1>' + Object.entries(r).map(([k, v]) => `<${k}>${v}</${k}>`).join('') + '</G_1>').join('') + '</DATA_DS>';
  return '<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>'
    + '<ns2:runReportResponse><ns2:runReportReturn><ns2:reportBytes>' + Buffer.from(xml).toString('base64')
    + '</ns2:reportBytes></ns2:runReportReturn></ns2:runReportResponse></soap:Body></soap:Envelope>';
}

/**
 * @param {Object}   o
 * @param {number}   o.port         Build.Rite's local server on this port (give each script its own)
 * @param {Function} [o.handle]     (req, res) => answer, or undefined for the default (an empty list; 201 for a POST).
 *                                  req: { method, path, query (URLSearchParams), body (string), json(), headers, auth }
 *                                  res: { json(obj, status), xml(text, status), bytes(buf, type), bip(rows) }
 * @param {string}   [o.username]   who you are (/_currentuser): username, fullName, email (default priya.raman)
 * @param {string}   [o.fullName]
 * @param {string}   [o.email]
 * @param {number}   [o.width]      viewport width (default 1440)
 * @param {Function} [o.init]       run in the page before the app (addInitScript), e.g. window.erpDesktop's record calls
 * @param {Object}   [o.desktop]    as inside the desktop app: window.erpDesktop = { isDesktop: true, app: 'buildrite' }
 * @param {*}        [o.<store>]    a stand-in for one of the desktop app's engines (STORES above), given to the server
 */
async function start(o) {
  const calls = [];
  const writes = [];
  const backend = http.createServer((req, raw) => {
    const u = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push(`${req.method} ${u.pathname}${u.search}`);
      const res = {
        json: (b, s) => { raw.writeHead(s || 200, { 'content-type': 'application/json' }); raw.end(JSON.stringify(b)); return true; },
        xml: (t, s) => { raw.writeHead(s || 200, { 'content-type': 'text/xml' }); raw.end(t); return true; },
        bytes: (buf, type) => { raw.writeHead(200, { 'content-type': type || 'application/octet-stream' }); raw.end(buf); return true; },
        bip: (rows) => res.xml(bipReport(rows)),
        raw: (status, headers, buf) => { raw.writeHead(status, headers || {}); raw.end(buf); return true; },
      };
      const r = { method: req.method, path: u.pathname, query: u.searchParams, body, json: () => (body ? JSON.parse(body) : null),
        headers: req.headers, auth: req.headers.authorization || '' };
      if (req.method !== 'GET') {
        let parsed = body;
        try { parsed = body ? JSON.parse(body) : null; } catch (e) { /* SOAP and other text bodies stay text */ }
        if (!u.pathname.endsWith('/ExternalReportWSSService')) writes.push({ method: req.method, path: u.pathname, query: u.search, body: parsed });
      }
      if (o.handle && o.handle(r, res)) return;
      if (u.pathname.endsWith('/ExternalReportWSSService')) return res.bip([]);
      if (req.method === 'POST') return res.json({ id: 1 }, 201);
      return res.json({ data: [] });
    });
  });
  await new Promise((r) => backend.listen(0, '127.0.0.1', r));
  const fake = `http://127.0.0.1:${backend.address().port}`;
  const name = o.username || 'priya.raman';
  const identity = { username: name, fullName: o.fullName || '', email: o.email || '' };
  // every backend to the fake server: a test never reaches a real Jira (its calls land at /rest/api/2/…)
  const overrides = { jira: fake, shop: fake, fusion: fake, bipservice: fake };
  const serverLog = [];
  const opts = { buildDir: path.join(ROOT, 'build'), webApp: 'buildrite', port: o.port, getIdentity: () => identity, backendOverrides: overrides, onLog: (l) => serverLog.push(l) };
  STORES.forEach((k) => { if (o[k] !== undefined) opts[k] = o[k]; });
  if (!DS.isBuilt(opts.buildDir, 'buildrite')) throw new Error('Build.Rite is not built: npm run build');
  const server = await DS.createDevServer(opts);
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: o.width || 1440, height: 1000 } });
  if (typeof o.init === 'function') await page.addInitScript(o.init);
  if (o.desktop) await page.addInitScript(() => { window.erpDesktop = Object.assign({ isDesktop: true, app: 'buildrite' }, window.erpDesktop || {}); });
  const errors = [];
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !QUIET.test(m.text())) errors.push(`${m.type()}: ${m.text()}`.slice(0, 400)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`.slice(0, 400)));
  const out = o.shots || path.join(require('os').tmpdir(), 'buildrite-e2e');
  fs.mkdirSync(out, { recursive: true });
  const base = `http://localhost:${o.port}`;

  return {
    page, calls, writes, errors, serverLog,
    url: base,
    nextUrl: base,
    /** Opens a path of Build.Rite ('/', '/?open=jira', '/?open=issues') and waits for its shell (its menu). */
    async open(p) {
      await page.goto(base + (p || '/'), { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.nx-nav-item', { state: 'attached', timeout: 60000 });
      await page.waitForTimeout(1200);
    },
    /** Chooses the look in your menu, as a user does ('redwood' or 'current'), and waits until every screen shows it. */
    async setLook(look) {
      await page.click('#nxUser');
      await page.waitForSelector('#nxLook-' + look, { timeout: 15000 });
      await page.click('#nxLook-' + look);
      await page.waitForFunction((l) => document.documentElement.getAttribute('data-nx-look') === l, look, { timeout: 10000 });
      await page.keyboard.press('Escape');
      await page.waitForSelector('#nxProfilePanel', { state: 'detached', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
    },
    /** Visible text of a selector, whitespace collapsed. */
    async text(sel) { return (await page.innerText(sel)).replace(/\s+/g, ' ').trim(); },
    async shot(name) { const f = path.join(out, name); await page.screenshot({ path: f, fullPage: true }); return f; },
    async close() {
      await browser.close();
      await server.close();
      backend.close();
    },
  };
}

// Record on a Jira story, as in the desktop app (pass as o.init, with o.recStore): window.erpDesktop's record calls
// (desktop/preload.js; each logged in window.__rec, the shortcut handler kept in window.__recKey) and the screen, a canvas
// that keeps changing, handed out as getDisplayMedia would (Electron answers it in desktop/main.js).
function recorderStub() {
  window.__rec = [];
  window.erpDesktop = {
    recordSources: () => Promise.resolve([{ id: 'window:42:0', name: 'Shop - Order Workbench', kind: 'window', thumb: '' },
      { id: 'screen:1:0', name: 'Entire screen', kind: 'screen', thumb: '' }]),
    recordUse: (id) => { window.__rec.push('use ' + id); return Promise.resolve(true); },
    recordState: (on) => { window.__rec.push('state ' + on); return Promise.resolve({ shot: 'Ctrl+Alt+S', stop: 'Ctrl+Alt+X' }); },
    recordWindow: (what) => { window.__rec.push('window ' + what); return Promise.resolve(true); },
    onRecordKey: (cb) => { window.__recKey = cb; },
  };
  const md = navigator.mediaDevices || {};
  md.getDisplayMedia = () => {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 360;
    const g = c.getContext('2d');
    let n = 0;
    const paint = () => { n++; g.fillStyle = 'hsl(' + (n * 7 % 360) + ',70%,50%)'; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText('Testing · ' + n, 40, 180); };
    paint();
    const timer = setInterval(paint, 66);
    const stream = c.captureStream(15);
    stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
    window.__shared = (window.__shared || 0) + 1;
    return Promise.resolve(stream);
  };
  // Record my voice: a microphone, stubbed as a silent audio track (a muted oscillator), so the recording has audio.
  md.getUserMedia = (c) => {
    window.__micCalls = (window.__micCalls || 0) + 1;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;                 // silent: a track, not a noise
      osc.connect(gain).connect(dest);
      osc.start();
      return Promise.resolve(dest.stream);
    } catch (e) {
      return Promise.resolve(new MediaStream());
    }
  };
}

/**
 * A throwaway project for the FDD library (desktop/lib/fdd.js), to pass as o.fddStore: uploads go into it (and, as in the
 * desktop app, into the build's copy of resources/fdd, which restore() puts back). With { git: true } it is a git
 * repository on branch fdd/test whose origin is a bare repository beside it, so Commit & push really pushes.
 *
 *   const fdd = await fddSandbox({ git: true });  →  { root, remote, store, git(args…), restore() }
 */
async function fddSandbox(opts) {
  const o = opts || {};
  const os = require('os');
  const { execFileSync } = require('child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'br-fdd-e2e-'));
  fs.mkdirSync(path.join(root, 'webApps', 'buildrite', 'resources', 'fdd'), { recursive: true });
  // its own (empty) library, so the app shows this project's, whatever FDDs the real project holds
  fs.writeFileSync(path.join(root, 'webApps', 'buildrite', 'resources', 'fdd', 'library.json'), JSON.stringify({ latest: '', docs: [] }, null, 2) + '\n');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let remote = '';
  if (o.git) {
    remote = fs.mkdtempSync(path.join(os.tmpdir(), 'br-fdd-e2e-remote-'));
    git(remote, 'init', '--bare', '-q');
    git(root, 'init', '-q', '-b', 'fdd/test');
    git(root, 'config', 'user.email', 'test@example.com'); git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(root, 'webApps', 'buildrite', 'app.txt'), 'app\n');
    git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'start');
    git(root, 'remote', 'add', 'origin', remote); git(root, 'push', '-q', '-u', 'origin', 'fdd/test');
  }
  const store = require(path.join(ROOT, 'desktop', 'lib', 'fdd.js')).open({ root });
  // the build's copy, as it is now, to put back afterwards
  const web = path.join(ROOT, 'build', 'processed', 'webApps', 'buildrite');
  const ver = fs.existsSync(web) ? fs.readdirSync(web).filter((n) => /^version_/.test(n)).sort().pop() : '';
  const res = ver ? path.join(web, ver, 'resources', 'fdd') : '';
  const saved = {};
  if (res && fs.existsSync(res)) fs.readdirSync(res).forEach((f) => { saved[f] = fs.readFileSync(path.join(res, f)); });
  function restore() {
    if (res && fs.existsSync(res)) {
      fs.readdirSync(res).forEach((f) => { if (!saved[f]) fs.unlinkSync(path.join(res, f)); });
      Object.keys(saved).forEach((f) => fs.writeFileSync(path.join(res, f), saved[f]));
    }
    [root, remote].filter(Boolean).forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* tmp */ } });
  }
  return { root, remote, store, git: (...args) => git(root, ...args), gitRemote: (...args) => git(remote, ...args), restore };
}

/**
 * A throwaway project for the Application pages catalog (desktop/lib/pages.js), to pass as o.pagesStore: the sample VB
 * app's code (tests/fixtures/vb-sample: the shop and its services) beside Build.Rite's own data folder layout, a git
 * repository on branch pages/test whose origin is a bare one beside it, so Commit & push really pushes. Its catalog is
 * also written into the build's copy of resources/pages (as in the desktop app), which restore() puts back. `capture`
 * stands in for the desktop app's hidden-window screenshot.
 *
 *   const pg = await pagesSandbox({ capture });  →  { root, remote, store, gitRemote(args…), restore() }
 */
async function pagesSandbox(opts) {
  const o = opts || {};
  const os = require('os');
  const { execFileSync } = require('child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'br-pages-e2e-'));
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'br-pages-e2e-remote-'));
  // the sample VB app's code and services; the catalog starts empty (resources/pages of its own)
  fs.cpSync(path.join(FIXTURE, 'webApps'), path.join(root, 'webApps'), { recursive: true });
  fs.cpSync(path.join(FIXTURE, 'services'), path.join(root, 'services'), { recursive: true });
  fs.copyFileSync(path.join(FIXTURE, 'visual-application.json'), path.join(root, 'visual-application.json'));
  // Build.Rite's data folder layout beside it: the catalog, sheets and screenshots go in webApps/buildrite/resources/pages
  fs.mkdirSync(path.join(root, 'webApps', 'buildrite', 'resources', 'pages'), { recursive: true });
  // your workspace: its working folder (as the desktop app's rootFn gives it, named as the top bar does) is this same
  // project, reached by a link of its own — the catalog (the data) stays in the project, the code is read as your workspace's
  const label = o.label || 'Shop App ▸ Dev_One (dev-one)';
  const working = root + '-working';
  fs.symlinkSync(root, working, 'dir');
  const ws = { root, rootFn: () => working, rootLabel: () => label };
  require(path.join(ROOT, 'desktop', 'lib', 'pages.js')).open(ws).rescan();
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(remote, 'init', '--bare', '-q');
  git(root, 'init', '-q', '-b', 'pages/test'); git(root, 'config', 'user.email', 'test@example.com'); git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'start'); git(root, 'remote', 'add', 'origin', remote); git(root, 'push', '-q', '-u', 'origin', 'pages/test');
  const store = require(path.join(ROOT, 'desktop', 'lib', 'pages.js')).open(Object.assign({}, ws, { capture: o.capture }, o.store || {}));
  // the build's copy of resources/pages, as it is now, to put back afterwards
  const web = path.join(ROOT, 'build', 'processed', 'webApps', 'buildrite');
  const ver = fs.existsSync(web) ? fs.readdirSync(web).filter((n) => /^version_/.test(n)).sort().pop() : '';
  const res = ver ? path.join(web, ver, 'resources', 'pages') : '';
  const saved = res && fs.existsSync(res) ? fs.mkdtempSync(path.join(os.tmpdir(), 'br-pages-build-')) : '';
  if (saved) fs.cpSync(res, saved, { recursive: true });
  function restore() {
    if (res) { try { fs.rmSync(res, { recursive: true, force: true }); if (saved) fs.cpSync(saved, res, { recursive: true }); } catch (e) { /* the next build puts it back */ } }
    try { fs.unlinkSync(working); } catch (e) { /* gone */ }
    [root, remote, saved].filter(Boolean).forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* tmp */ } });
  }
  return { root, working, remote, store, gitRemote: (...args) => git(remote, ...args), restore };
}

module.exports = { start, bipReport, recorderStub, fddSandbox, pagesSandbox, ROOT, FIXTURE };
