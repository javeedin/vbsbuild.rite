'use strict';

/**
 * Build.Rite's local server: serves a built Visual Builder app — Build.Rite's own, or your workspace's app built from its
 * working folder — and does the server-side jobs Visual Builder does for it when deployed, so the app runs on a laptop
 * against the live backends.
 *
 * Oracle's own `grunt vb-serve` is only express.static plus a canned /_currentuser. Under VBCS the server also
 *   1. fills the %{env.…}% placeholders the build leaves in app-flow.json, among them the URL VB reads the
 *      signed-in user from (left as-is, VB fetches "/%{env.userProfileUrl}%", gets a 404 and has no user);
 *   2. serves the application's services/catalog.json next to the web app (the build writes it to
 *      build/processed/services/, so locally VB configured no REST endpoint at all);
 *   3. proxies every "forceProxy" / authenticated backend, adding the stored credential.
 * This does the same:
 *   /_currentuser                    the local identity (isAnonymous: false, userName, …)
 *   <version>/app-flow.json          userProfileUrl placeholder -> /_currentuser
 *   <version>/services/catalog.json  each backend's server -> /__backend/<name> on this server, with forceProxy and
 *                                    the VBCS credential reference removed, so VB calls it directly (same origin)
 *   /__backend/<name>/…              forwarded to the backend's real URL; backends that use the Fusion credential
 *                                    get the local Fusion login as basic auth
 *   /__services/                     the web services page (desktop/web-services.html): every endpoint of every
 *                                    service connection, with a GET tester that calls through /__backend
 *
 * Roles: /_currentuser carries the roles chosen for the app (Run as), as VB's user. An app that reads its user's roles
 * from a BI Publisher report (o.rolesReport, found in the app's own code: lib/appRoles.js) has that one report answered
 * here with those roles, in the shape Fusion returns, so a role can be used without a Fusion login.
 *
 * Plain Node, no dependencies, no shell (eScan-safe). The desktop shell runs it in-process; `npm run serve` runs it
 * standalone (see the bottom of this file).
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const tls = require('tls');
// The certificates a backend's HTTPS is checked against: Node's own and this PC's (Windows / macOS / Linux store), so a
// corporate network that re-signs HTTPS with its own authority works as in the browser. Read once.
const CA = (() => {
  try {
    if (typeof tls.getCACertificates !== 'function') return null;
    const all = new Set(tls.getCACertificates('default'));
    try { tls.getCACertificates('system').forEach((c) => all.add(c)); } catch (e) { /* no system store here */ }
    return [...all];
  } catch (e) { return null; }
})();
const path = require('path');
const TT = require('./testTrace');
const INT = require('./integrations');
const { buildCatalog } = require('./catalog');

const DESKTOP_DIR = path.join(__dirname, '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer'];
const MAX_BODY = 100 * 1024 * 1024;
// The technical trace of a recorded test: how much of an answer is kept (lib/testTrace.js cuts what it shows further).
const TRACE_RAW_MAX = 4 * 1024 * 1024;
const BACKEND_TIMEOUT_MS = 120000;

/** A request from this PC itself (a page on this PC, never another device). */
function isLoopback(addr) {
  const a = String(addr || '');
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1' || a.startsWith('127.');
}

/**
 * Points every backend server at /__backend/<name> on `origin` and drops what would make VB route it through
 * VBCS's proxy (forceProxy, authentication). Returns the rewritten catalog and each backend's real URL and
 * VBCS credential id.
 */
function rewriteCatalog(catalog, origin) {
  const out = JSON.parse(JSON.stringify(catalog || {}));
  const backends = {};
  Object.keys(out.backends || {}).forEach((name) => {
    (out.backends[name].servers || []).forEach((server) => {
      const xvb = server['x-vb'] || {};
      const authenticated = (xvb.authentication && xvb.authentication.authenticated) || null;
      if (!backends[name]) {
        backends[name] = {
          url: String(server.url || '').replace(/\/+$/, ''),
          basic: !!(authenticated && authenticated.type === 'basic'),
          credentials: (authenticated && authenticated.credentials) || null,
        };
      }
      server.url = `${origin}/__backend/${encodeURIComponent(name)}`;
      delete xvb.forceProxy;
      delete xvb.authentication;
      xvb.anonymousAccess = true;
      server['x-vb'] = xvb;
    });
  });
  return { catalog: out, backends };
}

/** The VB credential most of the app's signed-in backends share (its main login), or null — whatever they are named. */
function fusionCredential(backends) {
  const n = {};
  Object.values(backends || {}).forEach((b) => { if (b && b.basic && b.credentials) n[b.credentials] = (n[b.credentials] || 0) + 1; });
  const best = Object.keys(n).sort((a, b) => n[b] - n[a] || (a < b ? -1 : 1))[0];
  return best || null;
}

/** The login a backend's calls go out with: one given for its VB credential (identity.logins), else the app's login
 *  (identity.fusion) — for every backend that signs in, whatever its name; none for a backend that does not. */
function loginFor(backend, identity) {
  if (!backend || !backend.basic) return null;
  const id = identity || {};
  const own = id.logins && backend.credentials ? id.logins[backend.credentials] : null;
  if (own && own.user && own.password) return own;
  return id.fusion && id.fusion.user && id.fusion.password ? id.fusion : null;
}

/** Fills the placeholders VBCS resolves when it serves app-flow.json. */
function fillAppFlow(text) {
  return String(text)
    .replace(/%\{env\.userProfileUrl\}%/g, '/_currentuser')
    .replace(/%\{env\.oauthUserProfileUrl\}%/g, '');
}

/** What VB's DefaultSecurityProvider reads; it only takes a user when isAnonymous is exactly false. */
function currentUser(identity) {
  const name = identity && identity.username;
  if (!name) {
    return { isAnonymous: true, roles: [], forbiddenPages: {} };
  }
  return {
    isAnonymous: false,
    id: name,
    userName: name,
    fullName: identity.fullName || name,
    email: identity.email || '',
    roles: ['approle.authenticated.user'].concat(Array.isArray(identity.roles) ? identity.roles : []),
    permissions: [],
    forbiddenPages: {},
  };
}

function xmlEscape(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

/** A runReport response for ROLES_RP carrying `roles`: DATA_DS / G_1 rows, base64 in ns2:reportBytes, as Fusion sends. */
function rolesReportResponse(username, roles) {
  const rows = (roles || []).map((r) => '<G_1>'
    + `<USERNAME>${xmlEscape(username)}</USERNAME>`
    + '<EMAIL_ADDRESS></EMAIL_ADDRESS>'
    + `<ORACLE_ROLE_COMMON_NAME>${xmlEscape(r)}</ORACLE_ROLE_COMMON_NAME>`
    + `<ORACLE_ROLE_DISPLAY>${xmlEscape(r)}</ORACLE_ROLE_DISPLAY>`
    + '</G_1>').join('');
  const data = `<?xml version="1.0" encoding="UTF-8"?><DATA_DS><P_LOGIN>${xmlEscape(username)}</P_LOGIN>${rows}</DATA_DS>`;
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Header/><env:Body>'
    + '<ns2:runReportResponse xmlns:ns2="http://xmlns.oracle.com/oxp/service/PublicReportService"><ns2:runReportReturn>'
    + `<ns2:reportBytes>${Buffer.from(data, 'utf8').toString('base64')}</ns2:reportBytes>`
    + '<ns2:reportContentType>text/xml</ns2:reportContentType>'
    + '</ns2:runReportReturn></ns2:runReportResponse></env:Body></env:Envelope>';
}

/** "EQP_CUSTOMERS_LOV_RP" from a runReport request, so the backend-calls log names the report, not the SOAP URL. */
function reportName(body) {
  const m = /<pub:reportAbsolutePath>([^<]+)<\/pub:reportAbsolutePath>/.exec(String(body || '').slice(0, 20000));
  return m ? path.posix.basename(m[1].trim(), '.xdo') : '';
}

/** A runReport call for the app's roles report (report: its path, as the app's code names it); never with no report. */
function isRolesReport(body, report) {
  const s = String(body || '');
  return !!report && s.indexOf('runReport') >= 0 && s.indexOf(String(report)) >= 0;
}

/** BUILDRITE_BACKEND_<NAME>=url points one backend somewhere else (e.g. another eqpt server), for this run only. */
function backendOverridesFromEnv(env) {
  const out = {};
  Object.keys(env || {}).forEach((k) => {
    const m = /^BUILDRITE_BACKEND_(.+)$/i.exec(k);
    if (m && env[k]) {
      out[m[1].toLowerCase()] = String(env[k]).replace(/\/+$/, '');
    }
  });
  return out;
}

/** webRoot-relative file for a URL path, or null when it would leave webRoot. */
function safeFile(webRoot, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const file = path.resolve(webRoot, `.${path.posix.normalize(`/${rel}`)}`);
  return file === webRoot || file.startsWith(webRoot + path.sep) ? file : null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('request body too large'));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, type, body, extra) {
  res.writeHead(status, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-cache' }, extra || {}));
  res.end(body);
}

function time() {
  return new Date().toTimeString().slice(0, 8);
}

/**
 * Starts the server. Resolves { server, port, url, close() }.
 * @param {object}   o
 * @param {string}   o.buildDir          the project's build/ folder (holds processed/)
 * @param {string}   [o.repoRoot]        the project folder (services/, webApps/); defaults to buildDir's parent
 * @param {string}   [o.webApp]          the web app under webApps/ to serve ('buildrite': Build.Rite itself; a workspace's
 *                                       app by its name). One server per web app, each at the site root as VB expects.
 * @param {string|Function} [o.rolesReport] the BI Publisher report the app reads its user's roles from (as its code names
 *                                       it, lib/appRoles.js), answered here with identity.roles; none: never answered
 * @param {number}   o.port              0 picks a free one
 * @param {Function} o.getIdentity       () => { username, fullName?, email?, roles?: string[], fusion?: { user, password } }
 * @param {object}   [o.backendOverrides] { backendName(lower-case): url }
 * @param {Function} [o.onLog]            (line) => void, one line per backend call and per problem
 * @param {Function} [o.onProblem]        ({ kind: 'no-login'|'refused'|'unreachable', backend, report, host }) => void,
 *                                        when a Fusion call is refused (401/403) or a backend cannot be reached
 * @param {string}   [o.host]             the address to listen on: 127.0.0.1 (this PC only, the default)
 * @param {object}   [o.sqlStore]         Build.Rite's SQL worksheet (lib/oracleSql.js: Oracle connections kept on this PC,
 *                                        passwords in the OS keychain), served at /__sql/* to this PC only, by its own name, and
 *                                        only to the app's own page (the X-Build-Rite-SQL header, which no other site can send)
 * @param {object}   [o.aiStore]          Ask AI in the SQL worksheet (lib/aiSql.js): the LLM chosen and its key, kept on this PC; served
 *                                        at /__sql/ai/* behind the same guard as /__sql/*
 * @param {object}   [o.jiraStore]        Connect Jira (lib/jiraAuth.js): the Jira site, email and API token kept on this PC, for the
 *                                        Jira stories page: /__jira/settings and /__jira/forget behind the /__sql
 *                                        guard (this PC, the X-Build-Rite-Jira header); the token goes only into /__backend/jira calls
 * @param {object}   [o.recStore]         Test evidence for Jira stories (lib/testEvidence.js: recordings and screenshots kept on this PC,
 *                                        a folder per story): /__rec/* to this PC only; writes need the X-Build-Rite-Rec header
 * @param {object}   [o.minutesStore]     Standup minutes (lib/minutes.js): the daily standup on the Jira backlog, kept on this PC, for
 *                                        Build.Rite's Minutes page: /__minutes/* to this PC only, behind the X-Build-Rite-Minutes
 *                                        header; voice→text reuses o.transcribe, "Format by AI" reuses o.aiStore (/__sql/ai/chat)
 * @param {object}   [o.analysisStore]    Saved AI analyses (lib/analyses.js), for Build.Rite's Analyze with AI: kept on this PC so
 *                                        an analysis opens without asking the AI again: /__ai/* to this PC only, behind X-Build-Rite-AI
 * @param {object}   [o.featuresStore]    Saved feature lists (lib/featureLists.js), for Build.Rite's Features: a project's Jira stories
 *                                        grouped into product features, kept on this PC: /__features/* to this PC only, behind X-Build-Rite-Features
 * @param {object}   [o.vbsStore]         Setup → Organizations & projects (lib/vbs.js, Build.Rite): VB Studio organizations and projects,
 *                                        their sign-in kept on this PC: /__vbs/* to this PC only, behind the X-Build-Rite-Vbs header
 * @param {Function} [o.vbsFind]          (url) => opens VB Studio in a window of the desktop app, read as its pages load (Find in VB Studio)
 * @param {object}   [o.fixStore]         Code Fix (lib/codeFix.js): AI-proposed changes to a page, written to the code only when approved (/__fix/*)
 * @param {object}   [o.crStore]          Change requests (lib/changeRequests.js): a change asked of a page, made with Code Fix (/__fix/cr-*)
 * @param {object}   [o.flowStore]        Saved flows (lib/savedFlows.js): integration flows saved, edited, commented on (/__pages/flows*)
 * @param {object}   [o.pagesStore]       The Application pages catalog (lib/pages.js): every VB page's technical sheet and the Jira stories
 *                                        mapped to it, saved into the project (git): /__pages/* to this PC only, behind X-Build-Rite-Pages
 * @param {object}   [o.fddStore]         The FDD library (lib/fdd.js): FDDs saved into the project (git) for Build.Rite's FDD library
 *                                        page and "Analyze with AI": /__fdd/* to this PC only, behind the X-Build-Rite-FDD header.
 *                                        Its JSON files are also written into this server's build copy, so the app sees an upload
 *                                        without a rebuild
 */
/** Every file of a page with its text (lib/pages.js texts: one scan, no git — the git status of each file made the
 *  window stop answering on Windows); an older store: its code() and codeFile(). */
function codeTexts(ps, id) {
  if (!ps) return { ok: false, error: 'The page catalog is not set up here.' };
  if (typeof ps.texts === 'function') return ps.texts(id);
  const c = ps.code ? ps.code(id) : { ok: false, error: 'The page catalog is not set up here.' };
  if (!c.ok) return c;
  return { ok: true, files: c.files.map((f) => { const t = ps.codeFile(id, f.path); return { path: f.path, text: t.ok ? t.text : '' }; }) };
}

function createDevServer(o) {
  const processed = path.join(o.buildDir, 'processed');
  const webRoot = path.join(processed, 'webApps', o.webApp || 'buildrite');
  const catalogFile = path.join(processed, 'services', 'catalog.json');
  const repoRoot = o.repoRoot || path.dirname(o.buildDir);
  // The FDD library writes into the project; the app reads the built copy (webApps/<app>/version_<n>/resources/fdd), so an
  // upload is also written there — the newest version folder, looked up at write time since every build makes a new one.
  if (o.pagesStore && o.pagesStore.setMirror && (o.webApp || '') === 'buildrite') {
    o.pagesStore.setMirror(() => {
      const v = fs.readdirSync(webRoot).filter((n) => /^version_/.test(n)).sort().pop();
      return path.join(webRoot, v || '', 'resources', 'pages');
    });
  }
  if (o.fddStore && o.fddStore.setMirror && (o.webApp || '') === 'buildrite') {
    o.fddStore.setMirror(() => {
      const v = fs.readdirSync(webRoot).filter((n) => /^version_/.test(n)).sort().pop();
      return path.join(webRoot, v || '', 'resources', 'fdd');
    });
  }
  const overrides = o.backendOverrides || {};
  const log = (line) => (o.onLog ? o.onLog(`${time()} ${line}`) : undefined);
  let backends = {};

  // The app's service connections: the project's catalog (the build writes it to processed/services) and the app's own
  // (webApps/<app>/services/catalog.json — the build does not copy it, VB Studio's server serves it), merged: the
  // app's own wins for a backend in both.
  const appCatalogFile = path.join(repoRoot, 'webApps', o.webApp || 'buildrite', 'services', 'catalog.json');
  const readCatalog = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
  const loadCatalog = (origin) => {
    const proj = readCatalog(catalogFile);
    const own = readCatalog(appCatalogFile);
    if (!proj && !own && !fs.existsSync(catalogFile)) throw new Error('no services/catalog.json (neither the project\'s nor the app\'s own)');
    const merged = Object.assign({}, proj || {}, { backends: Object.assign({}, (proj && proj.backends) || {}, (own && own.backends) || {}) });
    const rewritten = rewriteCatalog(merged, origin);
    backends = rewritten.backends;
    return rewritten.catalog;
  };

  // The API tester's project (o.apiProject(): { catalogFile, getIdentity } — your workspace's services/catalog.json and who
  // its app runs as): its calls go to that project's backends with that login, not this server's own (Build.Rite's).
  let apiSet = null, apiKey = '';
  function apiProject() {
    const p = typeof o.apiProject === 'function' ? o.apiProject() : null;
    const files = (Array.isArray(p && p.catalogFiles) ? p.catalogFiles : [p && p.catalogFile]).filter((f) => f && fs.existsSync(f));
    if (!files.length) return null;
    const key = files.map((f) => f + ':' + fs.statSync(f).mtimeMs).join('|');
    if (key !== apiKey) {
      const merged = { backends: {} };
      files.forEach((f) => { try { Object.assign(merged.backends, JSON.parse(fs.readFileSync(f, 'utf8')).backends || {}); } catch (e) { /* a broken catalog: left out */ } });
      apiSet = rewriteCatalog(merged, 'http://127.0.0.1').backends; apiKey = key;
    }
    return { backends: apiSet, identity: (typeof p.getIdentity === 'function' ? p.getIdentity() : null) || {} };
  }

  async function proxy(req, res, name, rest, search, alt) {
    if (!alt && !backends[name]) {
      loadCatalog(`http://${req.headers.host}`);
    }
    const set = alt ? alt.backends : backends;
    const backend = set[name];
    if (!backend) {
      return send(res, 404, 'application/json', JSON.stringify({ error: `no backend "${name}" in services/catalog.json` }));
    }
    const identity = alt ? alt.identity : (o.getIdentity() || {});
    const body = await readBody(req);
    const started = Date.now();
    const report = backend.basic ? reportName(body) : '';
    const label = `${req.method} ${name} ${report || `${rest}${search}`}`.slice(0, 220);
    const usesLogin = !!backend.basic; // it signs in (a VB credential): the app's login stands in for it
    const problem = (p) => (o.onProblem ? o.onProblem(Object.assign({ backend: name, report }, p)) : undefined);

    if (identity.roles && identity.roles.length && isRolesReport(body, typeof o.rolesReport === 'function' ? o.rolesReport() : o.rolesReport)) {
      log(`${label} -> roles answered locally: ${identity.roles.join(', ')}`);
      return send(res, 200, 'application/soap+xml; charset=utf-8', rolesReportResponse(identity.username, identity.roles));
    }

    // Connect Jira (lib/jiraAuth.js): the jira backend goes to the site the person connected, with their email and token.
    const jira = name === 'jira' && o.jiraStore ? o.jiraStore.auth() : null;
    // Jira not connected yet (no site, email or token on this PC): answered here as Jira would, never sent to the
    // catalog's placeholder address
    if (name === 'jira' && o.jiraStore && !jira && !overrides.jira) {
      log(`${req.method} jira ${rest} -> 401 (Jira is not connected: Jira stories → Connect Jira)`);
      return send(res, 401, 'application/json', JSON.stringify({ errorMessages: ['Jira is not connected: Jira stories → Connect Jira.'] }));
    }
    const base = overrides[name.toLowerCase()] || (jira && jira.site) || backend.url;
    let target;
    try {
      target = new URL(`${base}${rest}${search}`);
    } catch {
      return send(res, 502, 'application/json', JSON.stringify({ error: `bad backend URL ${base}` }));
    }
    const headers = Object.assign({}, req.headers);
    ['host', 'origin', 'referer', 'cookie', 'authorization', ...HOP_BY_HOP].forEach((h) => delete headers[h]);
    headers.host = target.host;
    headers['content-length'] = String(body.length);
    const login = loginFor(backend, identity);
    if (login) {
      headers.authorization = `Basic ${Buffer.from(`${login.user}:${login.password}`).toString('base64')}`;
    }
    if (jira) headers.authorization = jira.header;

    // Record on a Jira story, with its technical trace (lib/testTrace.js): while a traced recording runs, each call is
    // kept with what was sent and answered (secrets masked). Not Jira's own calls: they are the test tool's, not the app's.
    const rs = o.recStore;
    const tracing = !!(rs && rs.tracing && rs.tracing() && name !== 'jira');
    const resChunks = [];
    let resSize = 0;
    const trace = (status, resHeaders, error) => {
      if (!tracing) return;
      try {
        rs.traceAdd(TT.callEntry({ t: started, app: o.webApp, method: req.method, service: name, path: `${rest}${search}`, url: target.href, status,
          ms: Date.now() - started, error, reqHeaders: req.headers, reqBody: TT.bodyText(body, req.headers), resHeaders,
          // the login that actually went to the backend (the proxy adds it): its scheme and, for Basic, the username — never the secret
          auth: TT.authOf(headers),
          resBody: resHeaders ? TT.bodyText(Buffer.concat(resChunks), resHeaders) : '' }));
      } catch (e) { log(`trace: ${e.message}`); }
    };

    await new Promise((resolve) => {
      const mod = target.protocol === 'https:' ? https : http;
      const preq = mod.request(target, Object.assign({ method: req.method, headers, timeout: BACKEND_TIMEOUT_MS }, mod === https && CA ? { ca: CA } : {}), (pres) => {
        const out = Object.assign({}, pres.headers);
        // A 401 challenge would make the window pop a browser login box; the app handles the 401 itself.
        ['www-authenticate', 'set-cookie', ...HOP_BY_HOP].forEach((h) => delete out[h]);
        res.writeHead(pres.statusCode || 502, out);
        pres.pipe(res);
        if (tracing) pres.on('data', (c) => { if (resSize < TRACE_RAW_MAX) { resChunks.push(c); resSize += c.length; } });
        pres.on('end', () => {
          trace(pres.statusCode, pres.headers);
          // Oracle Fusion's gateway may answer a missing or wrong login with a 404 page (HTML), not a 401
          const html404 = usesLogin && !jira && pres.statusCode === 404 && /text\/html/i.test(String(pres.headers['content-type'] || ''));
          const refused = usesLogin && !jira && (pres.statusCode === 401 || pres.statusCode === 403 || html404);
          let note = '';
          if (refused && !headers.authorization) {
            note = ' (no login for it: File > Sign in for your app…)';
          } else if (html404) {
            note = ' (a 404 page: Fusion answers so for a wrong login — check File > Sign in for your app…)';
          } else if (refused) {
            note = pres.statusCode === 401 ? ' (the backend refused the login)' : ' (the login may not do this)';
          }
          log(`${label} -> ${pres.statusCode} (${Date.now() - started} ms)${note}`);
          if (refused) {
            problem({ kind: headers.authorization ? 'refused' : 'no-login', status: pres.statusCode });
          }
          resolve();
        });
        pres.on('error', resolve);
      });
      preq.on('timeout', () => preq.destroy(new Error(`no answer in ${BACKEND_TIMEOUT_MS / 1000}s`)));
      preq.on('error', (e) => {
        log(`${label} -> FAILED: ${e.message} (${target.origin})`);
        trace(0, null, e.message);
        problem({ kind: 'unreachable', host: target.origin, error: e.message });
        if (!res.headersSent) {
          send(res, 502, 'application/json', JSON.stringify({ error: `Build.Rite's local server could not reach ${name} at ${target.origin}: ${e.message}` }));
        } else {
          res.destroy();
        }
        resolve();
      });
      preq.end(body);
    });
  }

  /** The API tester's send (lib/apiTest.js): through this server's own /__backend proxy, so a test goes where the app's
   *  calls go, with the same login, and shows in the log like them. Resolves { status, statusText, headers, body, ms }. */
  let whereCache = null; // the page catalog, for /__api/scenarios/where (asked as you come back from the app's window)
  function sendBackend(name, rel, init) {
    const started = Date.now();
    const body = Buffer.from(init.body === undefined || init.body === null ? '' : String(init.body), 'utf8');
    return new Promise((resolve) => {
      const r = http.request({ host: '127.0.0.1', port: server.address().port, path: `${apiProject() ? '/__apibackend/' : '/__backend/'}${encodeURIComponent(name)}${rel}`, method: init.method,
        headers: Object.assign({}, init.headers, { 'content-length': String(body.length) }), timeout: BACKEND_TIMEOUT_MS + 5000 }, (pres) => {
        const chunks = [];
        let size = 0;
        pres.on('data', (c) => { size += c.length; if (size <= 8 * 1024 * 1024) chunks.push(c); });
        pres.on('end', () => resolve({ status: pres.statusCode, statusText: pres.statusMessage, headers: pres.headers, body: Buffer.concat(chunks), ms: Date.now() - started }));
        pres.on('error', (e) => resolve({ status: 0, error: e.message, headers: {}, body: Buffer.alloc(0), ms: Date.now() - started }));
      });
      r.on('timeout', () => r.destroy(new Error(`no answer in ${Math.round((BACKEND_TIMEOUT_MS + 5000) / 1000)}s`)));
      r.on('error', (e) => resolve({ status: 0, error: e.message, headers: {}, body: Buffer.alloc(0), ms: Date.now() - started }));
      r.end(body);
    });
  }
  /** Where a backend goes and with which login (the API tester shows it before anything is sent). */
  function backendInfo(name) {
    const alt = apiProject();
    if (!alt && !backends[name]) loadCatalog(`http://127.0.0.1:${server.address().port}`);
    const set = alt ? alt.backends : backends;
    const b = set[name];
    if (!b) return null;
    const identity = alt ? alt.identity : (o.getIdentity() || {});
    const fusion = !!b.basic; // it signs in: the app's login stands in for its VB credential
    const jira = name === 'jira' && o.jiraStore ? o.jiraStore.auth() : null;
    const url = overrides[name.toLowerCase()] || (jira && jira.site) || b.url;
    const lg = loginFor(b, identity);
    const user = lg ? lg.user : '';
    if (name === 'jira') return { url, login: jira ? 'Your Jira connection' : 'Jira is not connected (Jira stories → Connect Jira)', loginOk: !!jira, user: '' };
    if (fusion) return { url, login: user ? `Your app's login (${user})` : 'No login for it yet: File → Sign in for your app… (the backend will refuse)', loginOk: !!user, user };
    if (b.basic) return { url, login: 'Its VBCS credential, which is not on this PC (it may answer 401)', loginOk: false, user: '' };
    return { url, login: 'None needed', loginOk: true, user: '' };
  }

  function serveFile(req, res, pathname) {
    const file = safeFile(webRoot, pathname === '/' ? '/index.html' : pathname);
    if (!file) {
      return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        // Router strategy "path": a reload on /some/page must get the app shell, not a 404.
        if (!path.extname(pathname)) {
          return serveFile(req, res, '/index.html');
        }
        return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
      }
      const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      if (/[\\/]version_[^\\/]+[\\/]app-flow\.json$/.test(file)) {
        return send(res, 200, type, fillAppFlow(fs.readFileSync(file, 'utf8')));
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') {
        return res.end();
      }
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer((req, res) => {
    const u = new URL(String(req.url || '/').replace(/^\/{2,}/, '/'), 'http://local');
    const pathname = u.pathname;
    // a slow answer of this server's own (not a backend's: those are logged with their time already) is said in the log,
    // so a screen that takes long to open can be traced to what held it
    if (!/^\/__backend\//.test(pathname)) {
      const t0 = Date.now();
      res.on('finish', () => { const ms = Date.now() - t0; if (ms > 800) log(`slow: ${req.method} ${pathname} took ${ms} ms`); });
    }
    Promise.resolve().then(() => {
      // Only this PC: another device never uses the local server
      if (!isLoopback(req.socket.remoteAddress)) {
        return send(res, 403, 'text/plain; charset=utf-8', 'Build.Rite answers this PC only.');
      }
      if (pathname === '/__services') {
        res.writeHead(302, { Location: '/__services/' });
        return res.end();
      }
      if (pathname === '/__services/' || pathname === '/__services/web-services.js') {
        const name = pathname.endsWith('.js') ? 'web-services.js' : 'web-services.html';
        return send(res, 200, TYPES[path.extname(name)], fs.readFileSync(path.join(DESKTOP_DIR, name)));
      }
      if (pathname === '/__services/data.json') {
        const data = buildCatalog(repoRoot);
        const id = o.getIdentity() || {};
        data.identity = {
          username: id.username || '',
          roles: id.roles || null,
          hasFusionLogin: !!(id.fusion && id.fusion.password),
          fusionUser: (id.fusion && id.fusion.user) || '',
        };
        return send(res, 200, 'application/json', JSON.stringify(data));
      }
      if (pathname === '/_currentuser') {
        return send(res, 200, 'application/json', JSON.stringify(currentUser(o.getIdentity())));
      }
      if (pathname.startsWith('/__rec/') && o.recStore) {
        // Test evidence for a Jira story (Record, Screenshot on the story's panel): this PC only, by its own name. Reads
        // (the list, a file for <video>/<img>, which cannot send a header) need only that; writes also need the page's
        // X-Build-Rite-Rec header and its own origin, which a page of another site cannot send without a preflight.
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const rs = o.recStore;
        const json = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        const q = (k) => u.searchParams.get(k) || '';
        const fileMatch = /^\/__rec\/file\/([^/]+)\/([^/]+)$/.exec(pathname);
        if (req.method === 'GET' && fileMatch) {
          const file = rs.file(decodeURIComponent(fileMatch[1]), decodeURIComponent(fileMatch[2]));
          if (!file) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
          const size = fs.statSync(file).size;
          const type = /\.png$/i.test(file) ? 'image/png' : /\.jpe?g$/i.test(file) ? 'image/jpeg' : /\.webp$/i.test(file) ? 'image/webp'
            : /\.mp4$/i.test(file) ? 'video/mp4' : 'video/webm';
          // Ranges, so the video player can seek
          const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
          if (range && size) {
            const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2] || 0));
            const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
            if (start > end || start >= size) {
              res.writeHead(416, { 'Content-Range': `bytes */${size}` });
              return res.end();
            }
            res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`,
              'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
            fs.createReadStream(file, { start, end }).pipe(res);
            return undefined;
          }
          res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
          fs.createReadStream(file).pipe(res);
          return undefined;
        }
        // The technical trace of a recording: its timeline (the viewer), as a HAR file, and the failure in words.
        const traceMatch = /^\/__rec\/(trace|har|report)\/([^/]+)\/([^/]+)$/.exec(pathname);
        if (req.method === 'GET' && traceMatch) {
          const key = decodeURIComponent(traceMatch[2]);
          const nm = decodeURIComponent(traceMatch[3]);
          if (traceMatch[1] === 'trace') { const tr = rs.trace(key, nm); return tr ? json(200, tr) : json(404, { error: 'No trace for this recording.' }); }
          if (traceMatch[1] === 'report') { const txt = rs.report(key, nm); return txt ? send(res, 200, 'text/plain; charset=utf-8', txt) : send(res, 404, 'text/plain; charset=utf-8', 'No trace'); }
          const har = rs.har(key, nm);
          if (!har) return json(404, { error: 'No trace for this recording.' });
          const file = `${key} ${nm.replace(/\.[a-z0-9]+$/i, '')}.har`.replace(/[^\w .()-]/g, '_');
          return send(res, 200, 'application/json', JSON.stringify(har, null, 1), { 'Content-Disposition': `attachment; filename="${file}"`, 'Cache-Control': 'no-store' });
        }
        // A recording's transcript (lib/transcribe.js): the viewer's JSON, or a plain-text / SRT download.
        const txMatch = /^\/__rec\/(transcript|transcript\.srt|transcript\.txt)\/([^/]+)\/([^/]+)$/.exec(pathname);
        if (req.method === 'GET' && txMatch) {
          const key = decodeURIComponent(txMatch[2]);
          const nm = decodeURIComponent(txMatch[3]);
          if (txMatch[1] === 'transcript') { const t = rs.transcript(key, nm); return t ? json(200, t) : json(404, { error: 'This recording has no transcript yet.' }); }
          const body = txMatch[1] === 'transcript.srt' ? rs.transcriptSrt(key, nm) : rs.transcriptText(key, nm);
          if (!body) return send(res, 404, 'text/plain; charset=utf-8', 'No transcript');
          const file = `${key} ${nm.replace(/\.[a-z0-9]+$/i, '')}.${txMatch[1] === 'transcript.srt' ? 'srt' : 'txt'}`.replace(/[^\w .()-]/g, '_');
          return send(res, 200, 'text/plain; charset=utf-8', body, { 'Content-Disposition': `attachment; filename="${file}"`, 'Cache-Control': 'no-store' });
        }
        if (req.method === 'GET' && pathname === '/__rec/status') { return json(200, rs.status(q('id')) || { error: 'No recording in progress.' }); }
        if (req.method === 'GET' && pathname === '/__rec/info') return json(200, { available: true, dir: rs.dir });
        // Which transcription engines are set up (local Whisper on this PC, or OpenAI with the Ask AI key).
        if (req.method === 'GET' && pathname === '/__rec/transcribe-info') return json(200, o.transcribe ? o.transcribe.info() : { engines: [], local: { ready: false }, openai: { ready: false } });
        // Which stories have recordings or screenshots (the lists' icon), in one read.
        if (req.method === 'GET' && pathname === '/__rec/index') return json(200, rs.index());
        if (req.method === 'GET' && pathname === '/__rec/list') {
          try { return json(200, rs.list(q('key'))); } catch (e) { return json(200, { error: e.message }); }
        }
        const origin = req.headers.origin;
        if (req.headers['x-build-rite-rec'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from Build.Rite on this PC.' }));
        }
        (async () => {
          if (req.method !== 'POST') return json(404, { error: 'Not found' });
          if (pathname === '/__rec/start') {
            const st = rs.start(q('key'), q('ext'), { trace: q('trace') === '1' });
            log(`Recording ${q('key')}${st.trace ? ' with its technical trace (web service calls, console errors)' : ''}: ${st.name}`);
            return json(200, st);
          }
          if (pathname === '/__rec/chunk') return json(200, rs.chunk(q('id'), await readBody(req)));
          if (pathname === '/__rec/finish') {
            const item = rs.finish(q('id'));
            if (item) log(`Recording saved for ${q('key') || 'a story'}: ${item.name} (${Math.round(item.size / 1024)} KB)`);
            return json(200, { item });
          }
          if (pathname === '/__rec/image') {
            const item = rs.image(q('key'), await readBody(req), q('ext'));
            log(`Screenshot saved for ${q('key')}: ${item.name}`);
            return json(200, { item });
          }
          if (pathname === '/__rec/reveal') return json(200, rs.reveal(q('key')));
          if (pathname === '/__rec/remove') return json(200, rs.remove(q('key'), q('name')));
          // Transcribe a recording's voice with Whisper (local on this PC, or OpenAI), then keep the transcript next to it.
          // Set up local Whisper: download a model into the models folder, or open that folder.
          if (pathname === '/__rec/transcribe-model') {
            if (!o.transcribe) return json(200, { ok: false, error: 'Transcription is not available.' });
            const r = await o.transcribe.downloadModel(q('name'));
            if (r.ok) log(`Downloaded Whisper model ${r.name} (${Math.round(r.size / 1048576)} MB)`);
            return json(200, r);
          }
          if (pathname === '/__rec/transcribe-reveal') { return json(200, o.transcribe ? o.transcribe.revealModels() : { error: 'Transcription is not available.' }); }
          // Run the installer for a missing piece (the setup helper's Install button): winget / brew.
          if (pathname === '/__rec/transcribe-install') {
            if (!o.transcribe || !o.transcribe.install) return json(200, { ok: false, error: 'Transcription is not available.' });
            const r = await o.transcribe.install(q('what'));
            log(`Install ${q('what')} (${r.cmd || ''}): ${r.ok ? 'done' : 'failed'}`);
            return json(200, r);
          }
          if (pathname === '/__rec/transcribe') {
            if (!o.transcribe) return json(200, { ok: false, error: 'Transcription is not available.' });
            const file = rs.file(q('key'), q('name'));
            if (!file) return json(200, { ok: false, error: 'The recording was not found.' });
            const r = await o.transcribe.transcribe(file, { engine: q('engine'), lang: q('lang') });
            if (!r.ok) return json(200, r);
            const item = rs.saveTranscript(q('key'), q('name'), r);
            log(`Transcribed ${q('key')} ${q('name')} with ${r.engine} Whisper: ${(r.segments || []).length} lines (${Math.round((r.ms || 0) / 100) / 10}s)`);
            return json(200, { ok: true, engine: r.engine, lang: r.lang, lines: (r.segments || []).length, item });
          }
          return json(404, { error: 'Not found' });
        })().catch((e) => json(200, { error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__jira/') && o.jiraStore) {
        // Connect Jira, for the Jira stories page: this PC only, by its own name, and only the app's own page (it sends
        // X-Build-Rite-Jira, which a page of another site cannot send without a preflight this server never allows).
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const origin = req.headers.origin;
        if (req.headers['x-build-rite-jira'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from Build.Rite on this PC.' }));
        }
        const js = o.jiraStore;
        const json = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        (async () => {
          if (pathname === '/__jira/settings' && req.method === 'GET') return json(200, js.settings());
          if (pathname === '/__jira/settings' && req.method === 'POST') {
            const b = JSON.parse((await readBody(req)).toString('utf8') || '{}');
            try {
              const r = js.save(b);
              log(`Jira connected as ${r.email} on ${r.site}`);
              return json(200, r);
            } catch (e) { return json(200, { error: e.message }); }
          }
          if (pathname === '/__jira/forget' && req.method === 'POST') { log('Jira disconnected'); return json(200, js.forget()); }
          return json(404, { error: 'Not found' });
        })().catch((e) => json(200, { error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__minutes/')) {
        // Standup minutes (lib/minutes.js), for Build.Rite's Minutes page: this PC only, by its own name, and only the
        // app's own page (it sends X-Build-Rite-Minutes, which a page of another site cannot send without a preflight this
        // server never allows). The meeting notes stay on this PC; the Teams webhook is the only secret, kept encrypted.
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const jsonM = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        if (!o.minutesStore) return jsonM(200, { ok: false, error: 'Minutes is not set up in this app.' });
        const origin = req.headers.origin;
        if (req.headers['x-build-rite-minutes'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from Build.Rite on this PC.' }));
        }
        const ms = o.minutesStore;
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 30 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 30 * 1024 * 1024 ? reject(new Error('Too large')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        const post = req.method === 'POST';
        (async () => {
          const b = post ? JSON.parse((await bodyOf()) || '{}') : {};
          if (pathname === '/__minutes/settings' && req.method === 'GET') return jsonM(200, await ms.settings());
          if (pathname === '/__minutes/settings' && post) { try { return jsonM(200, await ms.saveSettings(b)); } catch (e) { return jsonM(200, { ok: false, error: e.message }); } }
          if (pathname === '/__minutes/list' && req.method === 'GET') return jsonM(200, await ms.list());
          if (pathname === '/__minutes/get' && req.method === 'GET') return jsonM(200, await ms.get(u.searchParams.get('id') || ''));
          if (pathname === '/__minutes/save' && post) { try { return jsonM(200, await ms.save(b)); } catch (e) { return jsonM(200, { ok: false, error: e.message }); } }
          if (pathname === '/__minutes/remove' && post) return jsonM(200, await ms.remove(b.id));
          if (pathname === '/__minutes/dictate' && post) return jsonM(200, await ms.dictate(b));
          if (pathname === '/__minutes/teams' && post) return jsonM(200, await ms.sendTeams(b));
          if (pathname === '/__minutes/contacts' && req.method === 'GET') return jsonM(200, ms.contacts ? await ms.contacts(u.searchParams.get('q') || '') : { ok: false, available: false, contacts: [] });
          if (pathname === '/__minutes/outlook' && post) return jsonM(200, ms.sendOutlook ? await ms.sendOutlook(b) : { ok: false, available: false, error: 'Sending via Outlook is not available.' });
          if (pathname === '/__minutes/send' && post) return jsonM(200, ms.sendMail ? await ms.sendMail(b) : { ok: false, error: 'Sending is not available.' });
          if (pathname === '/__minutes/graph/status' && req.method === 'GET') return jsonM(200, ms.graphStatus ? ms.graphStatus() : { configured: false, signedIn: false });
          if (pathname === '/__minutes/graph/check' && post) return jsonM(200, ms.graphCheck ? await ms.graphCheck() : (ms.graphStatus ? ms.graphStatus() : { configured: false, signedIn: false }));
          if (pathname === '/__minutes/graph/poll' && post) return jsonM(200, ms.graphPoll ? await ms.graphPoll() : (ms.graphStatus ? ms.graphStatus() : { configured: false, signedIn: false }));
          if (pathname === '/__minutes/graph/config' && post) return jsonM(200, ms.graphConfig ? await ms.graphConfig(b) : { ok: false });
          if (pathname === '/__minutes/graph/signin' && post) return jsonM(200, ms.graphBegin ? await ms.graphBegin() : { ok: false, error: 'Microsoft 365 is not available.' });
          if (pathname === '/__minutes/graph/interactive' && post) return jsonM(200, ms.graphInteractive ? await ms.graphInteractive() : { ok: false, error: 'In-app sign-in is not available.' });
          if (pathname === '/__minutes/graph/signout' && post) return jsonM(200, ms.graphSignOut ? await ms.graphSignOut() : { ok: false });
          if (pathname === '/__minutes/graph/test' && post) return jsonM(200, ms.graphTest ? await ms.graphTest(b) : { ok: false, error: 'Microsoft 365 is not available.' });
          if (pathname === '/__minutes/graph/send' && post) return jsonM(200, ms.graphSend ? await ms.graphSend(b) : { ok: false, error: 'Microsoft 365 is not available.' });
          return jsonM(404, { error: 'Not found' });
        })().catch((e) => jsonM(200, { ok: false, error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__followups/')) {
        // Saved follow-ups (lib/followups.js), for Build.Rite's Follow-ups page: this PC only, by its own name, and
        // only the app's own page (it sends X-Build-Rite-Followups, which a page of another site cannot send without a
        // preflight this server never allows). The follow-ups stay on this PC in DuckDB.
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const jsonF = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        if (!o.followupsStore) return jsonF(200, { ok: false, error: 'Follow-ups is not set up in this app.' });
        const origin = req.headers.origin;
        if (req.headers['x-build-rite-followups'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from Build.Rite on this PC.' }));
        }
        const fsStore = o.followupsStore;
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 30 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 30 * 1024 * 1024 ? reject(new Error('Too large')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        const post = req.method === 'POST';
        (async () => {
          const b = post ? JSON.parse((await bodyOf()) || '{}') : {};
          if (pathname === '/__followups/list' && req.method === 'GET') return jsonF(200, await fsStore.list());
          if (pathname === '/__followups/get' && req.method === 'GET') return jsonF(200, await fsStore.get(u.searchParams.get('id') || ''));
          if (pathname === '/__followups/save' && post) { try { return jsonF(200, await fsStore.save(b)); } catch (e) { return jsonF(200, { ok: false, error: e.message }); } }
          if (pathname === '/__followups/remove' && post) return jsonF(200, await fsStore.remove(b.id));
          // the messages the Copy to follow-up dialog offers (Follow-ups › Messages): yours, and your versions of the built-ins
          if (typeof fsStore.messages === 'function') {
            const author = () => { try { const id = o.getIdentity && o.getIdentity(); return (id && (id.displayName || id.username)) || ''; } catch (e) { return ''; } };
            if (pathname === '/__followups/messages' && req.method === 'GET') return jsonF(200, await fsStore.messages());
            if (pathname === '/__followups/messages/save' && post) return jsonF(200, await fsStore.saveMessage(Object.assign({}, b.message || {}, { author: author() })));
            if (pathname === '/__followups/messages/remove' && post) return jsonF(200, await fsStore.removeMessage(String(b.key || '')));
            if (pathname === '/__followups/messages/order' && post) return jsonF(200, await fsStore.setMessageOrder(b.keys));
          }
          return jsonF(404, { error: 'Not found' });
        })().catch((e) => jsonF(200, { ok: false, error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__ai/')) {
        // Saved AI analyses (lib/analyses.js): this PC only, by its own name, and only the app's own page (it sends
        // X-Build-Rite-AI, which a page of another site cannot send without a preflight this server never allows).
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const jsonA = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        if (!o.analysisStore) return jsonA(200, { ok: false, error: 'Saved analyses are not set up in this app.' });
        const origin = req.headers.origin;
        if (req.headers['x-build-rite-ai'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from Build.Rite on this PC.' }));
        }
        const as = o.analysisStore;
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 8 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 8 * 1024 * 1024 ? reject(new Error('Too large')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        const post = req.method === 'POST';
        const who = () => { try { const id = o.getIdentity && o.getIdentity(); return (id && (id.displayName || id.username)) || ''; } catch (e) { return ''; } };
        (async () => {
          const b = post ? JSON.parse((await bodyOf()) || '{}') : {};
          if (pathname === '/__ai/index' && req.method === 'GET') return jsonA(200, as.index());
          if (pathname === '/__ai/get' && req.method === 'GET') return jsonA(200, as.get(u.searchParams.get('key') || ''));
          if (pathname === '/__ai/save' && post) return jsonA(200, as.save(Object.assign({}, b, { by: b.by || who() })));
          if (pathname === '/__ai/chat' && post) return jsonA(200, as.chat(b.key, b.chat));
          if (pathname === '/__ai/remove' && post) return jsonA(200, as.remove(b.key));
          return jsonA(404, { error: 'Not found' });
        })().catch((e) => jsonA(200, { ok: false, error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__features/')) {
        // Saved feature lists (lib/featureLists.js): a project's Jira stories grouped into product features, kept on this
        // PC, by its own name, and only the app's own page (it sends X-Build-Rite-Features, which a page of another site
        // cannot send without a preflight this server never allows).
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const jsonFe = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        if (!o.featuresStore) return jsonFe(200, { ok: false, error: 'Saved feature lists are not set up in this app.' });
        const origin = req.headers.origin;
        if (req.headers['x-build-rite-features'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from Build.Rite on this PC.' }));
        }
        const fe = o.featuresStore;
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 8 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 8 * 1024 * 1024 ? reject(new Error('Too large')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        const post = req.method === 'POST';
        const who = () => { try { const id = o.getIdentity && o.getIdentity(); return (id && (id.displayName || id.username)) || ''; } catch (e) { return ''; } };
        (async () => {
          const b = post ? JSON.parse((await bodyOf()) || '{}') : {};
          if (pathname === '/__features/index' && req.method === 'GET') return jsonFe(200, fe.index());
          if (pathname === '/__features/get' && req.method === 'GET') return jsonFe(200, fe.get(u.searchParams.get('project') || ''));
          if (pathname === '/__features/save' && post) return jsonFe(200, fe.save(Object.assign({}, b, { by: b.by || who() })));
          if (pathname === '/__features/remove' && post) return jsonFe(200, fe.remove(b.project));
          return jsonFe(404, { error: 'Not found' });
        })().catch((e) => jsonFe(200, { ok: false, error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__pages/')) {
        // The Application pages catalog (lib/pages.js): build a page's technical sheet, map Jira stories to it, its
        // screenshot (captured by the desktop app, or uploaded), its AI explanation, and commit + push those files. This PC
        // only, and only the app's own page (X-Build-Rite-Pages). Reading the catalog needs none of this: it ships with the app.
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const jsonP = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        if (!o.pagesStore) return jsonP(200, { ok: false, error: 'The Application pages catalog is not set up in this app.' });
        const origin = req.headers.origin;
        if (req.headers['x-build-rite-pages'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from Build.Rite on this PC.' }));
        }
        const ps = o.pagesStore;
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 16 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 16 * 1024 * 1024 ? reject(new Error('Too large')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        const post = req.method === 'POST';
        const who = () => { try { const id = o.getIdentity && o.getIdentity(); return (id && (id.displayName || id.username)) || ''; } catch (e) { return ''; } };
        const commit = async (r, b, msg) => { if (r && r.ok && b.commit) r.git = await ps.gitSave({ message: msg, push: b.push !== false }); return r; };
        (async () => {
          const b = post ? JSON.parse((await bodyOf()) || '{}') : {};
          const by = who();
          if (pathname === '/__pages/info' && req.method === 'GET') return jsonP(200, { ok: true, canWrite: ps.canWrite(), canCapture: ps.canCapture(), canRun: !!(ps.canRun && ps.canRun()), data: ps.dataInfo ? ps.dataInfo() : null });
          // Integrations (lib/integrations.js, Application → Page Flows): every system the app talks to and every call it
          // makes, read from its code (the pages and services of your workspace's working folder); its report as a PDF
          if (pathname === '/__pages/integrations' && req.method === 'GET') {
            const r = INT.scan(ps.rootNow ? ps.rootNow() : repoRoot, { app: u.searchParams.get('app') || '' });
            if (r.ok) { r.by = by; delete r.root; log(`Integrations scanned: ${r.app} — ${r.totals.systems} systems, ${r.totals.endpoints} endpoints, ${r.totals.calls} calls`); }
            return jsonP(200, r);
          }
          // The AI Assistant (lib/assistant.js, Tools → AI Assistant): a question about the app answered from the workspace
          // (code, pages, integrations, saved flows, FDDs) by the AI set up for it; conversations kept on this PC
          if (pathname.startsWith('/__pages/assistant')) {
            const as = o.assistantStore;
            if (!as) return jsonP(200, { ok: false, error: 'The AI Assistant needs the desktop app.' });
            const q = (k) => u.searchParams.get(k) || '';
            if (pathname === '/__pages/assistant/suggest' && !post) return jsonP(200, as.suggestions());
            if (pathname === '/__pages/assistant/convs' && !post) return jsonP(200, as.list());
            if (pathname === '/__pages/assistant/conv' && !post) return jsonP(200, as.get(q('id')));
            if (pathname === '/__pages/assistant/file' && !post) return jsonP(200, as.file(q('path')));
            if (pathname === '/__pages/assistant/ask' && post) {
              const r = await as.ask({ question: b.question, scope: b.scope, page: b.page, convId: b.convId, redo: !!b.redo, by });
              log(`AI Assistant: ${r.ok ? 'answered' : 'not answered (' + r.error + ')'}${r.turn ? ' — ' + r.turn.looked.length + ' items looked at' : ''}`);
              return jsonP(200, r);
            }
            if (pathname === '/__pages/assistant/remove' && post) return jsonP(200, as.remove(b.id));
            if (pathname === '/__pages/assistant/rename' && post) return jsonP(200, as.rename(b.id, b.title));
            return jsonP(404, { ok: false, error: 'Not found' });
          }
          // Saved flows (lib/savedFlows.js, Page Flows → Saved flows): a flow saved under a name, edited, commented on
          if (pathname === '/__pages/flows' || pathname.startsWith('/__pages/flows/')) {
            const fl = o.flowStore;
            if (!fl) return jsonP(200, { ok: false, error: 'Saved flows need the desktop app.' });
            const q = (k) => u.searchParams.get(k) || '';
            if (pathname === '/__pages/flows' && !post) return jsonP(200, fl.list(q('q')));
            if (pathname === '/__pages/flows/get' && !post) return jsonP(200, fl.get(q('id')));
            if (pathname === '/__pages/flows/save' && post) { const r = fl.save(b.flow, by, { note: b.note, copy: !!b.copy }); if (r.ok) log(`Saved flow ${r.flow.id} v${r.flow.version}: ${r.flow.name}`); return jsonP(200, r); }
            if (pathname === '/__pages/flows/remove' && post) { const r = fl.remove(b.id); if (r.ok) log(`Saved flow ${b.id} removed`); return jsonP(200, r); }
            if (pathname === '/__pages/flows/comment' && post) return jsonP(200, fl.comment(b.id, { text: b.text, step: b.step }, by));
            if (pathname === '/__pages/flows/resolve' && post) return jsonP(200, fl.resolve(b.id, b.comment, !!b.resolved, by));
            if (pathname === '/__pages/flows/uncomment' && post) return jsonP(200, fl.uncomment(b.id, b.comment, by));
            return jsonP(404, { ok: false, error: 'Not found' });
          }
          if (pathname === '/__pages/integrations/pdf' && post) {
            if (typeof o.htmlToPdf !== 'function') return jsonP(200, { ok: false, noPdf: true, error: 'Saving a PDF needs the desktop app: use Print and choose Save as PDF.' });
            const html = String(b.html || '');
            if (!/^<!doctype html>/i.test(html) || html.length > 30 * 1024 * 1024) return jsonP(200, { ok: false, error: 'No report to print.' });
            try {
              const pdf = await o.htmlToPdf(html);
              log(`Integrations report printed to PDF: ${String(b.name || '').slice(0, 80)} (${Math.round(pdf.length / 1024)} KB)`);
              return jsonP(200, { ok: true, base64: Buffer.from(pdf).toString('base64'), size: pdf.length });
            } catch (e) { return jsonP(200, { ok: false, error: 'The PDF could not be made: ' + String((e && e.message) || e) }); }
          }
          if (pathname === '/__pages/run' && post) { const r = ps.run ? await ps.run(b.id) : { ok: false, error: 'Not here.' }; log(`Pages: run ${b.id} -> ${r.ok ? r.url : r.error}`); return jsonP(200, r); }
          if (pathname === '/__pages/git/pull' && post) return jsonP(200, ps.gitPull ? await ps.gitPull() : { ok: true, merged: false });
          if (pathname === '/__pages/catalog' && req.method === 'GET') return jsonP(200, Object.assign({ ok: true }, ps.catalog()));
          if (pathname === '/__pages/sheet' && req.method === 'GET') return jsonP(200, ps.sheet(u.searchParams.get('id') || ''));
          if (pathname === '/__pages/shot/data' && req.method === 'GET') return jsonP(200, ps.shotBytes ? ps.shotBytes(u.searchParams.get('id') || '', u.searchParams.get('which') || '') : { ok: false, error: 'Not supported.' });
          if (pathname === '/__pages/code' && req.method === 'GET') return jsonP(200, ps.code ? ps.code(u.searchParams.get('id') || '') : { ok: false, error: 'Not here.' });
          if (pathname === '/__pages/code/file' && req.method === 'GET') return jsonP(200, ps.codeFile ? ps.codeFile(u.searchParams.get('id') || '', u.searchParams.get('path') || '') : { ok: false, error: 'Not here.' });
          if (pathname === '/__pages/git/status' && req.method === 'GET') return jsonP(200, Object.assign({ ok: true }, await ps.gitStatus()));
          if (pathname === '/__pages/rescan' && post) return jsonP(200, await commit(ps.rescan(), b, 'Application pages: rescan'));
          if (pathname === '/__pages/build' && post) return jsonP(200, await commit(ps.build(b.id, { by }), b, 'Application pages: sheet of ' + b.id));
          if (pathname === '/__pages/assign' && post) {
            const r = ps.assign(b.id, b.key, { by });
            log(`Pages: ${b.key} -> ${b.id} ${r.ok ? (r.built ? '(sheet built)' : '(sheet reused)') : r.error}`);
            return jsonP(200, await commit(r, b, 'Application pages: map ' + String(b.key || '').toUpperCase() + ' to ' + b.id));
          }
          if (pathname === '/__pages/unassign' && post) return jsonP(200, await commit(ps.unassign(b.id, b.key), b, 'Application pages: unmap ' + String(b.key || '').toUpperCase() + ' from ' + b.id));
          if (pathname === '/__pages/shot' && post) return jsonP(200, await commit(ps.saveShot(b.id, Object.assign({}, b, { by, source: 'upload' })), b, 'Application pages: a screenshot of ' + b.id));
          if (pathname === '/__pages/capture' && post) {
            const r = await ps.capture(b.id, { by });
            log(`Pages: capture ${b.id} -> ${r.ok ? r.file : r.error}`);
            return jsonP(200, await commit(r, b, 'Application pages: screenshot of ' + b.id));
          }
          if (pathname === '/__pages/ai' && post) return jsonP(200, await commit(ps.saveAi(b.id, Object.assign({}, b, { by })), b, 'Application pages: AI explanation of ' + b.id));
          if (pathname === '/__pages/shot/remove' && post) return jsonP(200, await commit(ps.removeShot(b.id, b.shot), b, 'Application pages: a screenshot of ' + b.id + ' deleted'));
          if (pathname === '/__pages/delete' && post) { const r = ps.remove(b.id); log(`Pages: delete ${b.id} -> ${r.ok ? 'done' : r.error}`); return jsonP(200, await commit(r, b, 'Application pages: delete ' + b.id)); }
          if (pathname === '/__pages/restore' && post) return jsonP(200, await commit(ps.restore(b.id), b, 'Application pages: restore ' + b.id));
          if (pathname === '/__pages/git/save' && post) return jsonP(200, await ps.gitSave({ message: b.message, push: b.push !== false }));
          return jsonP(404, { error: 'Not found' });
        })().catch((e) => jsonP(200, { ok: false, error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__pflow/')) {
        // Process Flows (lib/processFlows.js, Application → Process Flows): a user process across the app's pages, written
        // by hand — a name, a description, the pages in order — and turned into a document (HTML → PDF; the description can
        // be drafted by the AI chosen in AI settings). This PC only, by its own name, and only the app's own page (it sends
        // X-Build-Rite-PFLOW, which a page of another site cannot send without a preflight this server never allows).
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const jsonPf = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        if (!o.processFlowStore) return jsonPf(200, { ok: false, unavailable: true, error: 'Process Flows run in the Build.Rite desktop app.' });
        const origin = req.headers.origin;
        if (req.headers['x-build-rite-pflow'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from Build.Rite on this PC.' }));
        }
        const pf = o.processFlowStore;
        const PFL = require('./processFlows');
        const post = req.method === 'POST';
        const get = (k) => u.searchParams.get(k) || '';
        const by = () => { try { const id = o.getIdentity && o.getIdentity(); return (id && (id.displayName || id.username)) || ''; } catch (e) { return ''; } };
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 8 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 8 * 1024 * 1024 ? reject(new Error('Too large.')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        (async () => {
          const b = post ? JSON.parse((await bodyOf()) || '{}') : {};
          if (pathname === '/__pflow/list' && !post) return jsonPf(200, pf.list(get('q')));
          if (pathname === '/__pflow/get' && !post) return jsonPf(200, pf.get(get('id')));
          if (pathname === '/__pflow/save' && post) { const r = pf.save(b.flow, by()); if (r.ok) log(`Process flow ${r.flow.id}: ${r.flow.name}`); return jsonPf(200, r); }
          if (pathname === '/__pflow/remove' && post) { const r = pf.remove(b.id); if (r.ok) log(`Process flow ${b.id} removed`); return jsonPf(200, r); }
          if (pathname === '/__pflow/document' && post) return jsonPf(200, { ok: true, html: PFL.renderDocument(b.flow || {}, { app: String(b.app || ""), date: new Date().toISOString().slice(0, 10) }) });
          if (pathname === '/__pflow/pdf' && post) {
            if (typeof o.htmlToPdf !== 'function') return jsonPf(200, { ok: false, noPdf: true, error: 'Saving a PDF needs the desktop app: use Print and choose Save as PDF.' });
            const html = PFL.renderDocument(b.flow || {}, { app: String(b.app || ""), date: new Date().toISOString().slice(0, 10) });
            try { const pdf = await o.htmlToPdf(html); return jsonPf(200, { ok: true, base64: Buffer.from(pdf).toString('base64'), size: pdf.length }); }
            catch (e) { return jsonPf(200, { ok: false, error: 'The PDF could not be made: ' + String((e && e.message) || e) }); }
          }
          if (pathname === '/__pflow/ai' && post) {
            const ai = o.aiStore;
            if (!ai || typeof ai.chat !== 'function') return jsonPf(200, { ok: false, needsSetup: true, error: 'Set up AI first (Tools → AI settings).' });
            const r = await ai.chat({ feature: 'pages', system: 'You write clear, factual process documentation. No preamble, no markdown headings, no lists — plain paragraphs only.', user: PFL.aiPrompt(b.flow || {}), maxTokens: 2000 });
            log(`Process flow AI draft -> ${r && r.ok ? 'ok' : (r && r.error) || 'no answer'}`);
            return jsonPf(200, r && r.ok ? { ok: true, text: String(r.text || '').trim(), provider: r.provider || '' } : { ok: false, error: (r && r.error) || 'The AI did not answer.', needsSetup: !!(r && r.needsSetup) });
          }
          // ── Record from the app: open the real app in a window, follow the pages walked through, build the steps ──
          if (pathname.indexOf('/__pflow/record/') === 0) {
            const rec = o.recorder;
            if (!rec || typeof rec.start !== 'function') return jsonPf(200, { ok: false, noRecord: true, error: 'Recording needs the desktop app with your workspace set up.' });
            const FR = require('./flowRecorder');
            const catalog = () => { try { return (o.pagesStore && o.pagesStore.catalog && o.pagesStore.catalog().pages) || []; } catch (e) { return []; } };
            if (pathname === '/__pflow/record/start' && post) { const r = await rec.start(String(b.app || '')); log('Process flow recording: start -> ' + (r && r.ok ? 'ok' : (r && r.error) || 'no')); return jsonPf(200, r || { ok: false, error: 'Could not start.' }); }
            if (pathname === '/__pflow/record/status' && !post) {
              const st = await rec.status();
              const built = FR.buildSteps((st && st.nav) || [], catalog());
              return jsonPf(200, { ok: true, running: !!(st && st.running), url: (st && st.url) || '', waiting: !!(st && st.waiting),
                steps: built.steps.map((s) => ({ page: s.page, name: s.name, kind: s.kind, url: s.url })), skipped: built.skipped });
            }
            if (pathname === '/__pflow/record/capture' && post) {
              const r = typeof rec.capture === 'function' ? await rec.capture() : { ok: false, error: 'Update the app to capture a screen.' };
              if (r && r.ok) log('Process flow recording: captured ' + (r.kind || 'screen') + ' "' + (r.name || '') + '" (' + r.count + ' so far)');
              return jsonPf(200, r || { ok: false, error: 'Could not capture.' });
            }
            if (pathname === '/__pflow/record/auto' && post) {
              const r = typeof rec.auto === 'function' ? await rec.auto(!!b.on) : { ok: false, error: 'Update the app for auto-capture.' };
              return jsonPf(200, r || { ok: false });
            }
            if (pathname === '/__pflow/record/stop' && post) {
              const st = await rec.stop();
              const built = FR.buildSteps((st && st.nav) || [], catalog(), (st && st.calls) || []);
              const nCalls = built.steps.reduce((a, s) => a + ((s.calls && s.calls.length) || 0), 0);
              log('Process flow recording: stop -> ' + built.steps.length + ' step(s), ' + nCalls + ' call(s), ' + built.skipped + ' skipped');
              return jsonPf(200, { ok: true, pages: built.steps, skipped: built.skipped });
            }
          }
          return jsonPf(404, { error: 'Not found' });
        })().catch((e) => jsonPf(200, { ok: false, error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__fix/')) {
        // Code Fix (lib/codeFix.js), the Code fix tab of Application pages: the AI proposes a change to a page; it is
        // written into the project's code only when approved (after git pull), then tested, committed or undone. This PC
        // only, by its own name, and only the app's own page (X-Build-Rite-Fix).
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const jsonF = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        if (!o.fixStore) return jsonF(200, { ok: false, error: 'Code Fix is not set up in this app (it needs the desktop app or npm run serve).' });
        const origin = req.headers.origin;
        if (req.headers['x-build-rite-fix'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from Build.Rite on this PC.' }));
        }
        const fx = o.fixStore;
        const post = req.method === 'POST';
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 48 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 48 * 1024 * 1024 ? reject(new Error('Too large (the screenshots together must be under 40 MB)')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        const who = () => { try { const id = o.getIdentity && o.getIdentity(); return (id && (id.displayName || id.username)) || ''; } catch (e) { return ''; } };
        (async () => {
          const b = post ? JSON.parse((await bodyOf()) || '{}') : {};
          const q = (k) => u.searchParams.get(k) || '';
          // Change requests (lib/changeRequests.js, Application → Change requests): a change asked of a page, with who
          // asked, the customer, the Jira story and the issue; made with Code Fix, its status following its fix
          if (pathname.startsWith('/__fix/cr-')) {
            const cr = o.crStore;
            if (!cr) return jsonF(200, { ok: false, error: 'Change requests need the desktop app.' });
            const fixOf = (id) => { try { const g = fx.get(id); return g && g.ok ? g.fix : null; } catch (e) { return null; } };
            if (pathname === '/__fix/cr-list' && !post) return jsonF(200, cr.list(q('q'), fixOf));
            if (pathname === '/__fix/cr-get' && !post) return jsonF(200, cr.get(q('id'), fixOf));
            if (pathname === '/__fix/cr-save' && post) { const r = cr.save(b.request, who(), fixOf); if (r.ok) log(`Change request ${r.request.code} saved`); return jsonF(200, r); }
            if (pathname === '/__fix/cr-remove' && post) return jsonF(200, cr.remove(b.id));
            if (pathname === '/__fix/cr-link' && post) return jsonF(200, cr.link(b.id, b.fix, who(), b.what, fixOf));
            if (pathname === '/__fix/cr-event' && post) return jsonF(200, cr.event(b.id, b.what, who(), b.note, fixOf));
            return jsonF(404, { ok: false, error: 'Not found' });
          }
          if (pathname === '/__fix/img' && !post) {
            const s = fx.img(q('id'), q('n'));
            if (!s.ok) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
            return send(res, 200, s.mime, fs.readFileSync(s.file), { 'Cache-Control': 'no-store' });
          }
          if (pathname === '/__fix/info' && !post) return jsonF(200, await fx.info());
          if (pathname === '/__fix/list' && !post) return jsonF(200, fx.list(q('page')));
          if (pathname === '/__fix/history' && !post) return jsonF(200, fx.history ? await fx.history(q('q')) : { ok: true, changes: [] });
          if (pathname === '/__fix/get' && !post) return jsonF(200, fx.get(q('id')));
          // one file of a fix in full, before and after, what changed marked (Change requests → How it was fixed)
          if (pathname === '/__fix/code' && !post) return jsonF(200, fx.code ? await fx.code({ fix: q('id'), file: q('file') }) : { ok: false, error: 'Not available.' });
          // the app's menu, its flows and where a page like the one given is registered (Change requests → New page)
          if (pathname === '/__fix/app-menu' && !post) return jsonF(200, fx.appMenu ? fx.appMenu({ id: q('id'), group: q('group'), after: q('after') }) : { ok: false, error: 'Not available.' });
          if (pathname === '/__fix/shot' && !post) {
            const s = fx.shot(q('id'), q('which'));
            if (!s.ok) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
            return send(res, 200, s.mime, fs.readFileSync(s.file), { 'Cache-Control': 'no-store' });
          }
          if (pathname === '/__fix/folder' && post) return jsonF(200, await fx.setFolder(b.path));
          if (pathname === '/__fix/pick' && post) return jsonF(200, await fx.pick());
          if (pathname === '/__fix/analyze' && post) {
            log(`Code fix: analyze ${b.id}`);
            const r = await fx.analyze(Object.assign({}, b, { by: who() }));
            log(`Code fix: ${b.id} -> ${r.ok ? r.fix.status + ' (' + r.fix.files.length + ' files)' : r.error}`);
            return jsonF(200, r);
          }
          if (pathname === '/__fix/preview' && post) return jsonF(200, await fx.preview(Object.assign({}, b, { by: who() })));
          if (pathname === '/__fix/apply' && post) {
            const r = await fx.apply(Object.assign({}, b, { by: who() }));
            log(`Code fix: apply ${b.fix} -> ${r.ok ? 'applied, tests ' + (r.fix.tests && r.fix.tests.ok ? 'ok' : 'not ok') : r.error}`);
            return jsonF(200, r);
          }
          // who did it goes into the change's history
          const withBy = Object.assign({}, b, { by: who() });
          if (pathname === '/__fix/test' && post) return jsonF(200, await fx.test(withBy));
          if (pathname === '/__fix/e2e' && post) return jsonF(200, await fx.e2e(withBy));
          if (pathname === '/__fix/undo' && post) { const r = await fx.undo(withBy); log(`Code fix: undo ${b.fix} -> ${r.ok ? 'undone' : r.error}`); return jsonF(200, r); }
          if (pathname === '/__fix/commit' && post) { const r = await fx.commit(withBy); log(`Code fix: commit ${b.fix} -> ${r.ok ? r.fix.commit.sha : r.error}`); return jsonF(200, r); }
          if (pathname === '/__fix/discard' && post) return jsonF(200, fx.discard(withBy));
          return jsonF(404, { error: 'Not found' });
        })().catch((e) => jsonF(200, { ok: false, error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__vbs/')) {
        // Setup → Organizations & projects (lib/vbs.js), Build.Rite: the VB Studio organizations and their projects, the
        // sign-in kept encrypted on this PC (never sent back). This PC only, by its own name, and only the app's own page
        // (X-Build-Rite-Vbs).
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const jsonV = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        if (!o.vbsStore) return jsonV(200, { ok: false, error: 'Organizations and projects need the desktop app.' });
        const origin = req.headers.origin;
        if (req.headers['x-build-rite-vbs'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from Build.Rite on this PC.' }));
        }
        const vs = o.vbsStore;
        const post = req.method === 'POST';
        const who = () => { try { const id = o.getIdentity && o.getIdentity(); return (id && (id.displayName || id.username)) || ''; } catch (e) { return ''; } };
        (async () => {
          const b = post ? JSON.parse(((await readBody(req)) || '').toString('utf8') || '{}') : {};
          if (pathname === '/__vbs/state' && !post) return jsonV(200, vs.state());
          if (pathname === '/__vbs/discovered' && !post) return jsonV(200, vs.discovered ? vs.discovered() : { ok: false, error: 'Not here.' });
          if (pathname === '/__vbs/diagnostic' && !post) return jsonV(200, { ok: true, text: vs.diagnostic ? vs.diagnostic() : '' });
          if (pathname === '/__vbs/work' && !post) return jsonV(200, vs.work ? vs.work() : { ok: false, error: 'Needs the desktop app.' });
          if (pathname === '/__vbs/console' && !post) return jsonV(200, o.vbsConsole ? Object.assign({ ok: true }, o.vbsConsole.lines(new URL(req.url, 'http://local').searchParams.get('after'))) : { ok: false, lines: [], error: 'The Run console needs the desktop app.' });
          if (pathname === '/__vbs/run/progress' && !post) return jsonV(200, o.vbsConsole && o.vbsConsole.progress ? o.vbsConsole.progress() : { ok: false, steps: [] });
          if (pathname === '/__vbs/console/status' && !post) return jsonV(200, o.vbsConsole ? o.vbsConsole.status() : { ok: false, error: 'The Run console needs the desktop app.' });
          if (pathname === '/__vbs/work/progress' && !post) return jsonV(200, vs.workProgress ? vs.workProgress() : { ok: true, active: false });
          if (pathname === '/__vbs/work/profile' && !post) return jsonV(200, typeof o.vbsProfile === 'function' ? await o.vbsProfile(new URL(req.url, 'http://local').searchParams.get('scan') === '1') : { ok: false, error: 'Reading your app needs the desktop app.' });
          if (!post) return jsonV(404, { error: 'Not found' });
          let r;
          if (pathname === '/__vbs/org') { try { r = vs.saveOrg(b); } catch (e) { r = { ok: false, error: e.message }; } }
          else if (pathname === '/__vbs/org/remove') r = vs.removeOrg(b.id);
          else if (pathname === '/__vbs/project') r = await vs.addProject(b);
          else if (pathname === '/__vbs/project/check') r = await vs.checkProject(b.id);
          else if (pathname === '/__vbs/project/remove') r = vs.removeProject(b.id);
          // Find in VB Studio: VB Studio in a window of the desktop app (its pages read as they load)
          else if (pathname === '/__vbs/find') r = typeof o.vbsFind === 'function' ? await o.vbsFind(String(b.url || '')) : { ok: false, error: 'Find in VB Studio needs the desktop app.' };
          else if (pathname === '/__vbs/discovered/clear') r = vs.clearDiscovered();
          // Sync from VB Studio (API): no window — the calls VB Studio's pages make, made directly
          else if (pathname === '/__vbs/sync') r = vs.sync ? await vs.sync({ orgId: String(b.orgId || ''), orgKey: String(b.orgKey || ''), project: String(b.project || '') }) : { ok: false, error: 'Sync needs the desktop app.' };
          // Find its repositories: VB Studio's API, else the names VB Studio usually gives, each checked with git
          // the working copy: a workspace cloned on this PC — checked, pulled, committed, pushed back to VB Studio (never forced)
          else if (pathname === '/__vbs/work/plan') r = vs.workPlan(b);
          else if (pathname === '/__vbs/work/use') r = await vs.workUse(b);
          else if (pathname === '/__vbs/work/apply') r = await vs.workApply(String(b.id || ''));
          else if (pathname === '/__vbs/work/cancel') r = vs.workCancel();
          else if (pathname === '/__vbs/pick-folder') r = typeof o.vbsPickFolder === 'function' ? { ok: true, folder: (await o.vbsPickFolder(String(b.folder || ''))) || '' } : { ok: false, error: 'Choosing a folder needs the desktop app: type its path.' };
          else if (pathname === '/__vbs/work/status') r = await vs.workStatus(String(b.id || ''), { fetch: !!b.fetch });
          else if (pathname === '/__vbs/work/pull') r = await vs.workPull(String(b.id || ''), who());
          else if (pathname === '/__vbs/work/commit') r = await vs.workCommit(String(b.id || ''), String(b.message || ''), who());
          else if (pathname === '/__vbs/work/push') r = await vs.workPush(String(b.id || ''));
          else if (pathname === '/__vbs/work/forget') r = vs.workForget(String(b.id || ''), !!b.removeFolder);
          else if (pathname === '/__vbs/work/stop') r = vs.workStop();
          // the Run console: its lines (after the last one seen), who the app runs as, a command (no shell: lib/runConsole.js)
          else if (pathname === '/__vbs/console/cmd') r = o.vbsConsole ? await o.vbsConsole.command(String(b.text || '').slice(0, 500)) : { ok: false, text: 'The Run console needs the desktop app.' };
          else if (pathname === '/__vbs/console/clear') r = o.vbsConsole ? { ok: true, last: o.vbsConsole.clear() } : { ok: false };
          else if (pathname === '/__vbs/console/runas') r = o.vbsConsole && o.vbsConsole.runAs ? await o.vbsConsole.runAs({ user: String(b.user || '').slice(0, 120), roles: Array.isArray(b.roles) ? b.roles.slice(0, 12).map(String) : [] }) : { ok: false, text: 'Run as needs the desktop app.' };
          // ▶ Run: your workspace's whole app, built from its working folder (when its code changed), in a window of its own
          else if (pathname === '/__vbs/work/run') r = typeof o.vbsRun === 'function' ? await o.vbsRun({ app: String(b.app || '') }) : { ok: false, error: 'Running your workspace needs the desktop app.' };
          else if (pathname === '/__vbs/work/open') { const c = (vs.work().copies || []).filter((x) => x.id === String(b.id || ''))[0]; const dir = c ? (b.which === 'main' ? c.main : b.which === 'base' ? c.base : c.working) : ''; r = c && typeof o.vbsOpenPath === 'function' ? (await o.vbsOpenPath(dir), { ok: true, path: dir }) : { ok: false, error: c ? 'Opening a folder needs the desktop app.' : 'No such workspace on this PC.' }; }
          // a workspace's Git: its branch, head commit and last commit (git, the saved sign-in)
          else if (pathname === '/__vbs/workspace-git') r = vs.workspaceGit ? await vs.workspaceGit({ orgKey: String(b.orgKey || ''), project: String(b.project || ''), repo: String(b.repo || ''), branch: String(b.branch || '') }) : { ok: false, error: 'Needs the desktop app.' };
          else if (pathname === '/__vbs/repos') r = vs.findRepos ? await vs.findRepos({ orgKey: String(b.orgKey || ''), project: String(b.project || ''), name: String(b.name || '') }) : { ok: false, error: 'Needs the desktop app.' };
          else return jsonV(404, { error: 'Not found' });
          log(`Setup: ${pathname.slice(7)} -> ${r && r.ok === false ? r.error : 'done'}`);
          return jsonV(200, r);
        })().catch((e) => jsonV(500, { ok: false, error: e.message }));
        return;
      }
      if (pathname.startsWith('/__api/')) {
        // The API tester (lib/apiTest.js), Application pages → a page → Integrations → Test: one of the page's REST calls or
        // BI Publisher reports, sent through this server's own /__backend proxy (the app's backend, the same login). This
        // PC only, by its own name, and only the app's own page (X-Build-Rite-Api).
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const jsonA = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        if (!o.apiStore) return jsonA(200, { ok: false, error: 'The API tester needs the desktop app (or npm run serve).' });
        const origin = req.headers.origin;
        if (req.headers['x-build-rite-api'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from Build.Rite on this PC.' }));
        }
        const api = o.apiStore;
        const post = req.method === 'POST';
        const env = { send: sendBackend, backend: backendInfo };
        (async () => {
          const b = post ? JSON.parse(((await readBody(req)) || '').toString('utf8') || '{}') : {};
          const q = (k) => u.searchParams.get(k) || '';
          if (pathname === '/__api/op' && !post) {
            return jsonA(200, q('report') ? api.report({ path: q('report'), name: q('name'), params: q('params'), rowTag: q('rowTag') }, env) : api.op(q('endpoint'), env));
          }
          if (pathname === '/__api/run' && post) {
            const r = await api.run(b, env);
            log(`API test ${b.report ? 'report ' + (b.report.path || '') : b.endpoint} -> ${r.status !== undefined ? r.status + ' (' + r.ms + ' ms)' : (r.needsConfirm ? 'waits for confirmation' : r.error)}`);
            return jsonA(200, r);
          }
          if (pathname === '/__api/check' && post) {
            const r = await api.check(b.endpoints, env);
            log(`API check: ${r.passed} ok, ${r.warned} differ, ${r.failed} failed, ${r.skipped} skipped`);
            return jsonA(200, r);
          }
          if (pathname === '/__api/last' && post) return jsonA(200, api.last(b.keys));
          // API Scenarios (lib/apiScenarios.js): a page's calls in order, run purely through the APIs, every run kept
          const sc = o.scenarioStore;
          if (pathname.startsWith('/__api/scenarios')) {
            if (!sc) return jsonA(200, { ok: false, error: 'API Scenarios need the desktop app.' });
            const who = () => { try { const id = o.getIdentity && o.getIdentity(); return (id && (id.displayName || id.username)) || ''; } catch (e) { return ''; } };
            if (pathname === '/__api/scenarios' && !post) return jsonA(200, sc.list(q('page'), env));
            // the page your app's window is on (▶ Run opens it): API Scenarios offers its scenarios
            if (pathname === '/__api/scenarios/where' && !post) {
              let w = null;
              try { w = typeof o.appWindow === 'function' ? o.appWindow() : null; } catch (e) { w = null; }
              if (!w || !w.url) return jsonA(200, { ok: true, open: false });
              const ps = o.pagesStore;
              if (!whereCache || Date.now() - whereCache.at > 30000) whereCache = { at: Date.now(), pages: ps && ps.catalog ? (ps.catalog().pages || []) : [] };
              const pg = require('./apiScenarios').pageOfUrl(whereCache.pages, w.url);
              return jsonA(200, { ok: true, open: true, url: String(w.url), page: pg ? pg.id : '', label: pg ? pg.label : '' });
            }
            if (pathname === '/__api/scenarios/get' && !post) return jsonA(200, sc.get(q('id'), env));
            if (pathname === '/__api/scenarios/runs' && !post) return jsonA(200, sc.runs(q('page')));
            if (pathname === '/__api/scenarios/run-of' && !post) return jsonA(200, sc.runOf(q('page'), q('run')));
            if (pathname === '/__api/scenarios/save' && post) return jsonA(200, sc.save(b.scenario, who(), env));
            if (pathname === '/__api/scenarios/remove' && post) return jsonA(200, sc.remove(b.id));
            // a page's facts read from its code now (its dropdowns and the values it sends), else its saved sheet; its
            // reports as the API tester finds them in its code (a name XX_RP → its path and parameters)
            const factsOf = (pid) => {
              const ps = o.pagesStore;
              let live = null;
              try { live = ps && ps.facts ? ps.facts(pid) : null; } catch (e) { live = null; }
              const sh = live ? null : (ps && ps.sheet ? ps.sheet(pid) : null);
              return live || (sh && (sh.facts || (sh.sheet && sh.sheet.facts))) || null;
            };
            const optsOf = (pid, facts) => {
              let reports = [];
              const names = ((facts.integrations && facts.integrations.reports) || []).map(String);
              if (names.length && api && api.reports) {
                try { const c = codeTexts(o.pagesStore, pid); if (c && c.ok) { const r = api.reports(c.files, names, pid.split('/')[0]); reports = r && r.ok ? r.reports : []; } } catch (e) { reports = []; }
              }
              return { reports, env };
            };
            // where a page goes next in the app (to continue the journey there)
            const nextOf = (facts) => ((facts && facts.next) || []).filter((n) => n && n.id && n.id !== facts.id).map((n) => ({ id: n.id, label: n.label || n.id, via: (n.via || []).slice(0, 3) }));
            if (pathname === '/__api/scenarios/draft' && post) {
              const pid = String(b.page || '');
              const facts = factsOf(pid);
              if (!facts) return jsonA(200, { ok: false, error: 'This page has no technical sheet yet: open it in Application pages and Build its sheet first.' });
              const r = sc.draft(pid, facts, who(), Object.assign(optsOf(pid, facts), b.into && typeof b.into === 'object' ? { into: b.into } : {}));
              return jsonA(200, r.ok ? Object.assign(r, { next: nextOf(facts) }) : r);
            }
            // a scenario built from a recorded Process Flow (on request): its captured calls in order, matched to the pages' catalog
            if (pathname === '/__api/scenarios/from-flow' && post) {
              const pf = o.processFlowStore;
              const flow = (b.flow && typeof b.flow === 'object') ? b.flow : (b.flowId && pf ? ((pf.get(String(b.flowId)) || {}).flow || null) : null);
              if (!flow) return jsonA(200, { ok: false, error: 'No such recorded flow.' });
              const pageIds = Array.from(new Set((flow.pages || []).map((p) => String((p && p.page) || '')).filter(Boolean)));
              const fb = {};
              pageIds.slice(0, 12).forEach((pg) => { const f = factsOf(pg); if (f) fb[pg] = f; });
              const first = pageIds.filter((pg) => fb[pg])[0] || pageIds[0] || '';
              const r = sc.fromFlow(flow, fb, who(), fb[first] ? optsOf(first, fb[first]) : { env });
              if (r.ok) log(`API Scenarios: from recording "${flow.name || flow.id}" -> ${r.scenario.name} (${(r.scenario.steps || []).length} step(s)${r.unmatched && r.unmatched.length ? ', ' + r.unmatched.length + ' left out' : ''})`);
              return jsonA(200, r);
            }
            // the journey continued on the next page (Next → the catalog → the cart)
            if (pathname === '/__api/scenarios/extend' && post) {
              const pid = String(b.page || '');
              const facts = factsOf(pid);
              if (!facts) return jsonA(200, { ok: false, error: 'That page is not in the code.' });
              const r = sc.extend(b.scenario, pid, facts, who(), optsOf(pid, facts));
              return jsonA(200, r.ok ? Object.assign(r, { next: nextOf(facts) }) : r);
            }
            // the link to a page the journey went on to: removed (that page and the pages after it), or read again and linked anew
            if ((pathname === '/__api/scenarios/unlink' || pathname === '/__api/scenarios/relink') && post) {
              const pid = String(b.page || '');
              const sc0 = b.scenario || {};
              let r;
              if (pathname === '/__api/scenarios/relink') {
                const facts = factsOf(pid);
                if (!facts) return jsonA(200, { ok: false, error: 'That page is not in the code any more.' });
                r = sc.relink(sc0, pid, facts, who(), optsOf(pid, facts));
              } else {
                const f0 = factsOf(String(sc0.page || ''));
                r = sc.unlink(sc0, pid, who(), f0 ? optsOf(String(sc0.page), f0) : {});
              }
              if (!r.ok) return jsonA(200, r);
              const j = r.scenario.journey || [];
              const last = factsOf(j.length ? j[j.length - 1].page : r.scenario.page);
              log(`API Scenarios: ${pathname.slice(-6)} ${pid} in "${r.scenario.name}" (${r.removed ? r.removed.steps : 0} step(s) removed)`);
              return jsonA(200, Object.assign(r, { next: last ? nextOf(last) : [] }));
            }
            // every API of a page, to test one or build a scenario from them
            if (pathname === '/__api/scenarios/apis' && !post) {
              const pid = q('page');
              const facts = factsOf(pid);
              if (!facts) return jsonA(200, { ok: false, error: 'That page is not in the code.' });
              const r = sc.apis(pid, facts, optsOf(pid, facts));
              // another page with the same title (two "Create Equipment Request"s): named, with its counts
              try {
                const ps = o.pagesStore;
                const label = String(facts.label || '').trim().toLowerCase();
                const twins = label && ps && ps.catalog ? (ps.catalog().pages || []).filter((x) => x.id !== pid && !x.deleted && String(x.label || '').trim().toLowerCase() === label).slice(0, 4) : [];
                r.twins = twins.map((x) => { const tf = factsOf(x.id); return { id: x.id, label: x.label, rest: tf ? (tf.integrations.rest || []).length : 0, reports: tf ? (tf.integrations.reports || []).length : 0 }; });
              } catch (e) { r.twins = []; }
              return jsonA(200, r);
            }
            // the order to run a scenario's steps in, and what they miss
            if (pathname === '/__api/scenarios/suggest' && post) {
              const scn = b.scenario || {};
              const pages = Array.from(new Set([String(scn.page || '')].concat((scn.journey || []).map((j) => String(j.page || '')), (scn.steps || []).map((st) => String(st.page || ''))).filter(Boolean)));
              const fb = {};
              pages.slice(0, 8).forEach((pg) => { const f = factsOf(pg); if (f) fb[pg] = f; });
              const first = pages[0] || '';
              return jsonA(200, sc.suggest(scn, fb, fb[first] ? optsOf(first, fb[first]) : { env }));
            }
            if (pathname === '/__api/scenarios/next' && !post) { const facts = factsOf(q('page')); return jsonA(200, { ok: true, next: nextOf(facts) }); }
            // the page's flow: every page it leads to, with how far the saved scenarios tested each
            if (pathname === '/__api/scenarios/flow' && !post) {
              const cache = {};
              const fo = (pid) => { if (!(pid in cache)) cache[pid] = factsOf(pid); return cache[pid]; };
              return jsonA(200, sc.flow(q('page'), fo, { depth: Number(q('depth')) || 5, max: 30 }));
            }
            // a journey along a path of the flow (continued from the scenario when it is the start of that path)
            if (pathname === '/__api/scenarios/path' && post) {
              const r = sc.throughPath(b.scenario || null, b.pages, factsOf, who(), optsOf);
              if (!r.ok) return jsonA(200, r);
              const j = r.scenario.journey || [];
              const last = factsOf(j.length ? j[j.length - 1].page : r.scenario.page);
              log(`API Scenarios: journey along ${(b.pages || []).length} page(s) -> "${r.scenario.name}" (${r.added.length} linked, ${r.skipped.length} passed through)`);
              return jsonA(200, Object.assign(r, { next: last ? nextOf(last) : [] }));
            }
            // one step tried on its own (▶ beside it): its answer, not kept as a run
            if (pathname === '/__api/scenarios/try' && post) {
              const r = await sc.tryStep(b.scenario, String(b.step || ''), env, { vars: b.vars, search: b.search, allowWrites: !!b.allowWrites, by: who() });
              log(`API scenario step tried: ${b.step} -> ${r.ok ? r.result.state + (r.result.status ? ' (' + r.result.status + ', ' + r.result.ms + ' ms)' : '') : r.error}`);
              return jsonA(200, r);
            }
            // a run's test results report (resources/js/scenarioReport.js html) printed to an A4 PDF by the desktop app's
            // hidden window (no script runs in it); the page saves the bytes
            if (pathname === '/__api/scenarios/pdf' && post) {
              if (typeof o.htmlToPdf !== 'function') return jsonA(200, { ok: false, noPdf: true, error: 'Saving a PDF needs the desktop app: use Print and choose Save as PDF.' });
              const html = String(b.html || '');
              if (!/^<!doctype html>/i.test(html) || html.length > 20 * 1024 * 1024) return jsonA(200, { ok: false, error: 'No report to print.' });
              try {
                const pdf = await o.htmlToPdf(html);
                log(`API scenario report printed to PDF: ${String(b.name || '').slice(0, 80)} (${Math.round(pdf.length / 1024)} KB)`);
                return jsonA(200, { ok: true, base64: Buffer.from(pdf).toString('base64'), size: pdf.length });
              } catch (e) { return jsonA(200, { ok: false, error: 'The PDF could not be made: ' + String((e && e.message) || e) }); }
            }
            if (pathname === '/__api/scenarios/run' && post) {
              const r = await sc.run(String(b.id || ''), env, { allowWrites: !!b.allowWrites, by: who(), scope: b.scope === 'main' ? 'main' : 'all' });
              log(`API scenario ${b.id} -> ${r.ok ? (r.run.ok ? 'passed' : 'failed') + ' (' + r.run.passed + ' ok, ' + r.run.failed + ' failed, ' + r.run.skipped + ' skipped, ' + r.run.ms + ' ms)' : r.error}`);
              return jsonA(200, r);
            }
          }
          if (pathname === '/__api/reports' && !post) {
            const ps = o.pagesStore;
            const c = codeTexts(ps, q('page'));
            if (!c.ok) return jsonA(200, c);
            return jsonA(200, api.reports(c.files, q('names').split(',').filter(Boolean), q('page').split('/')[0]));
          }
          return jsonA(404, { ok: false, error: 'Not found' });
        })().catch((e) => jsonA(200, { ok: false, error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__issues/')) {
        // Issues (lib/issues.js), Build.Rite's Issues screen: log an issue against a page, the AI writes it up and analyzes
        // it, approval (in the app, and an email), the agent applies it on a branch and makes the pull request, Jira kept up
        // to date. This PC only, by its own name, and only the app's own page (X-Build-Rite-Issues).
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const jsonI = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        if (!o.issuesStore) return jsonI(200, { ok: false, error: 'Issues are not set up in this app (they need the desktop app).' });
        const origin = req.headers.origin;
        // an issue's screenshot shown in the page (<img>, which sends no header of ours): only to the app's own page —
        // the browser says so (Sec-Fetch-Site: same-origin); every other call needs the header
        const ownImage = req.method === 'GET' && pathname === '/__issues/img' && req.headers['sec-fetch-site'] === 'same-origin';
        if (!ownImage && (req.headers['x-build-rite-issues'] !== '1' || (origin && origin !== `http://${req.headers.host}`))) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from Build.Rite on this PC.' }));
        }
        const is = o.issuesStore;
        const post = req.method === 'POST';
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 48 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 48 * 1024 * 1024 ? reject(new Error('Too large (the screenshots together must be under 40 MB)')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        const who = () => { try { const id = o.getIdentity && o.getIdentity(); return (id && (id.displayName || id.username)) || ''; } catch (e) { return ''; } };
        (async () => {
          const b = post ? JSON.parse((await bodyOf()) || '{}') : {};
          const q = (k) => u.searchParams.get(k) || '';
          const by = who();
          if (pathname === '/__issues/info' && !post) return jsonI(200, await is.info());
          if (pathname === '/__issues/list' && !post) return jsonI(200, is.list({ q: q('q'), status: q('status') }));
          if (pathname === '/__issues/get' && !post) return jsonI(200, is.get(q('id')));
          if (pathname === '/__issues/img' && !post) {
            const s = is.img(q('id'), q('n'));
            if (!s.ok) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
            return send(res, 200, s.mime, fs.readFileSync(s.file), { 'Cache-Control': 'no-store' });
          }
          if (pathname === '/__issues/settings' && !post) return jsonI(200, is.settings ? is.settings() : { ok: false, error: 'Not here.' });
          if (pathname === '/__issues/progress' && !post) return jsonI(200, is.progress ? is.progress(q('id'), q('kind')) : { ok: false, error: 'Not here.' });
          if (!post) return jsonI(404, { error: 'Not found' });
          const act = pathname.slice('/__issues/'.length);
          let r;
          if (act === 'create') r = await is.create(Object.assign({}, b, { by: by }));
          else if (act === 'format') r = await is.format(b.id, { by: by });
          else if (act === 'update') r = is.update(b.id, b.fields || {}, { by: by });
          else if (act === 'jira') r = await is.toJira(b.id, { by: by });
          else if (act === 'analyze') r = await is.analyze(b.id, { refine: b.refine, by: by });
          else if (act === 'ask') r = await is.ask(b.id, { email: b.email !== false, to: b.to, by: by });
          else if (act === 'approve') r = await is.approve(b.id, { by: by, via: 'app' });
          else if (act === 'reject') r = await is.reject(b.id, { by: by, reason: b.reason });
          else if (act === 'apply') r = await is.apply(b.id, { by: by, anyway: !!b.anyway, reason: b.reason });
          else if (act === 'verify') r = await is.verify(b.id, { by: by, passed: b.passed, env: b.env, build: b.build, notes: b.notes });
          else if (act === 'close') r = await is.close(b.id, { by: by, note: b.note, resolution: b.resolution, rootCause: b.rootCause, rootNotes: b.rootNotes, fixedIn: b.fixedIn });
          else if (act === 'details') r = is.details(b.id, b.fields || {}, { by: by });
          else if (act === 'comment') r = await is.comment(b.id, { text: b.text, kind: b.kind, email: !!b.email, to: b.to, by: by });
          else if (act === 'settings') r = is.setSettings(b);
          else if (act === 'email') r = await is.email(b.id, { to: b.to, cc: b.cc, subject: b.subject, body: b.body, by: by });
          else if (act === 'draft') { r = await is.draft(b.id, { purpose: b.purpose, by: by }); log(`Issues: draft ${b.id} -> ${r.ok ? 'drafted' : r.error}`); return jsonI(200, r); }
          else if (act === 'reopen') r = is.reopen(b.id, { by: by });
          // the sandbox: the fix tried first, in a copy of the code on this PC (make, status, run, shots, tests, remove)
          else if (act === 'sandbox') { r = is.sandbox ? await is.sandbox(b.id, { act: b.act, which: b.which, diff: !!b.diff, open: b.open, by: by }) : { ok: false, error: 'Not here.' }; if (b.act !== 'status') log(`Issues: sandbox ${b.act} ${b.id} -> ${r.ok ? 'done' : r.error}`); return jsonI(200, r); }
          else return jsonI(404, { error: 'Not found' });
          log(`Issues: ${act} ${b.id || ''} -> ${r.ok ? (r.issue ? r.issue.key + ' ' + r.issue.status : 'ok') : r.error}`);
          return jsonI(200, r);
        })().catch((e) => jsonI(200, { ok: false, error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__bip/')) {
        // BIP Reporting (lib/bipReports.js), for Build.Rite's BIP Reporting screen: the BI Publisher catalog of a Fusion pod,
        // a report's parameters, runs (in buckets), this PC's runs, favourites and the dashboard. This PC only, by its own
        // name, and only the app's own page (it sends X-Build-Rite-BIP). It signs in with Fusion SQL's pods; no password
        // ever comes back.
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const jsonB = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        if (!o.bipStore) return jsonB(200, { ok: false, unavailable: true, error: 'BIP Reporting runs in the Build.Rite desktop app.' });
        const origin = req.headers.origin;
        const bs = o.bipStore;
        const get = (k) => u.searchParams.get(k) || '';
        // the output of a run, downloaded (a link the page opens: no custom header, so only by its id, this PC only)
        if (pathname === '/__bip/run/file' && req.method === 'GET') {
          const f = bs.runFile(get('id'));
          if (!f.ok) return send(res, 404, 'text/plain; charset=utf-8', f.error);
          const type = { csv: 'text/csv', xml: 'application/xml', pdf: 'application/pdf', html: 'text/html', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }[f.file.split('.').pop()] || 'application/octet-stream';
          return send(res, 200, type, fs.readFileSync(f.file), { 'Content-Disposition': 'attachment; filename="' + f.name.replace(/[^\w. -]+/g, '_') + '"', 'Cache-Control': 'no-store' });
        }
        if (req.headers['x-build-rite-bip'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from Build.Rite on this PC.' }));
        }
        const post = req.method === 'POST';
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 4 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 4 * 1024 * 1024 ? reject(new Error('Too large.')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        (async () => {
          const b = post ? JSON.parse((await bodyOf()) || '{}') : {};
          const r = (() => {
            if (pathname === '/__bip/settings' && !post) return bs.settings();
            if (pathname === '/__bip/prefs' && post) return bs.savePrefs(b);
            if (pathname === '/__bip/progress' && !post) return bs.progress(get('id'));
            if (pathname === '/__bip/cancel' && post) return bs.cancel(b.id);
            if (pathname === '/__bip/search' && !post) return bs.search(get('pod'), get('q'));
            if (pathname === '/__bip/runs' && !post) return bs.runs();
            if (pathname === '/__bip/run' && !post) return bs.runRows(get('id'), get('offset'), get('limit'));
            if (pathname === '/__bip/run/remove' && post) return bs.removeRun(b.id);
            if (pathname === '/__bip/favorites' && !post) return bs.favorites();
            if (pathname === '/__bip/favorite' && post) return bs.toggleFavorite(b);
            if (pathname === '/__bip/cards' && !post) return bs.cards();
            if (pathname === '/__bip/card/save' && post) return bs.saveCard(b.card);
            if (pathname === '/__bip/card/remove' && post) return bs.removeCard(b.id);
            return null;
          })();
          if (r) return jsonB(200, r);
          if (pathname === '/__bip/folder' && !post) return jsonB(200, await bs.folder(get('pod'), get('path'), get('refresh') === '1'));
          if (pathname === '/__bip/definition' && !post) return jsonB(200, await bs.definition(get('pod'), get('path'), get('refresh') === '1'));
          if (pathname === '/__bip/datamodel' && !post) return jsonB(200, await bs.dataModel(get('pod'), get('path')));
          if (pathname === '/__bip/index' && post) {
            const out = await bs.index(b.pod, b);
            log(`BIP index ${b.root || '/'} -> ${out.ok ? out.folders + ' folders, ' + out.items + ' items' : out.error}`);
            return jsonB(200, out);
          }
          if (pathname === '/__bip/run' && post) {
            const out = await bs.run(b.pod, b);
            log(`BIP run ${b.path || ''} -> ${out.run ? out.run.status + (out.run.rows != null ? ' ' + out.run.rows + ' rows' : '') : out.error}`);
            return jsonB(200, out);
          }
          if (pathname === '/__bip/run/open' && post) {
            const f = bs.runFile(b.id);
            if (!f.ok) return jsonB(200, f);
            if (typeof o.vbsOpenPath !== 'function') return jsonB(200, { ok: false, error: 'Opening a file needs the desktop app: download it instead.' });
            const err = await o.vbsOpenPath(b.folder ? f.folder : f.file);
            return jsonB(200, err ? { ok: false, error: String(err) } : { ok: true });
          }
          if (pathname === '/__bip/card/run' && post) return jsonB(200, await bs.runCard(b.pod, b.id));
          return jsonB(404, { error: 'Not found' });
        })().catch((e) => jsonB(200, { ok: false, error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__fsql/')) {
        // Fusion SQL (lib/fusionSql.js), for Build.Rite's Fusion SQL screen: read-only SQL on a Fusion pod through its
        // BI Publisher query runner, the schema browser, saved queries, Ask AI. This PC only, by its own name, and only
        // the app's own page (it sends X-Build-Rite-FSQL, which another site's page cannot send without a preflight).
        // Passwords never come back: the page sees { username, hasPassword }.
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const jsonQ = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        if (!o.fusionSqlStore) return jsonQ(200, { ok: false, unavailable: true, error: 'Fusion SQL runs in the Build.Rite desktop app.' });
        const origin = req.headers.origin;
        if (req.headers['x-build-rite-fsql'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from Build.Rite on this PC.' }));
        }
        const fq = o.fusionSqlStore;
        const post = req.method === 'POST';
        const get = (k) => u.searchParams.get(k) || '';
        const who = () => { try { const id = o.getIdentity && o.getIdentity(); return (id && (id.displayName || id.username)) || ''; } catch (e) { return ''; } };
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 8 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 8 * 1024 * 1024 ? reject(new Error('Too large.')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        (async () => {
          const b = post ? JSON.parse((await bodyOf()) || '{}') : {};
          const r = (() => {
            if (pathname === '/__fsql/settings' && !post) return fq.settings();
            if (pathname === '/__fsql/pod/save' && post) return fq.savePod(b);
            if (pathname === '/__fsql/pod/remove' && post) return fq.removePod(b.id);
            if (pathname === '/__fsql/pod/active' && post) return fq.setActive(b.id);
            if (pathname === '/__fsql/calls' && !post) return fq.calls(false);
            if (pathname === '/__fsql/calls/clear' && post) return fq.calls(true);
            if (pathname === '/__fsql/schema/clear' && post) return fq.clearCache(b.pod);
            if (pathname === '/__fsql/schema/cache' && !post) return fq.cacheInfo(get('pod'));
            if (pathname === '/__fsql/queries' && !post) return fq.queries();
            if (pathname === '/__fsql/queries/save' && post) return fq.saveQuery(Object.assign({}, b, { by: who() }));
            if (pathname === '/__fsql/queries/remove' && post) return fq.removeQuery(b.id);
            if (pathname === '/__fsql/queries/import' && post) return fq.importQueries(b.queries);
            if (pathname === '/__fsql/queries/ran' && post) return fq.ranQuery(b.id);
            if (pathname === '/__fsql/ask/progress' && !post) return fq.progress(get('id'));
            // Fusion Setups: the checklist (with the pod's results), a task added / changed / removed, the starter tasks again
            const fs2 = o.fusionSetupsStore;
            if (pathname.startsWith('/__fsql/setups') && !fs2) return { ok: false, error: 'Fusion Setups runs in the Build.Rite desktop app.' };
            const podId = () => get('pod') || b.pod || (fq.settings() || {}).active || '';
            if (pathname === '/__fsql/setups' && !post) return fs2.list(podId());
            if (pathname === '/__fsql/setups/save' && post) return fs2.save(b.task, who());
            if (pathname === '/__fsql/setups/remove' && post) return fs2.remove(b.code);
            if (pathname === '/__fsql/setups/starter' && post) return fs2.starter();
            return null;
          })();
          if (r) return jsonQ(200, r);
          if (pathname === '/__fsql/run' && post) {
            const out = await fq.execute({ sql: b.sql, rowLimit: b.rowLimit, pod: b.pod });
            log(`Fusion SQL ${out.pod || ''} -> ${out.ok ? out.rowCount + ' rows' : String(out.error || '').split('\n')[0].slice(0, 120)} (${out.ms || 0} ms)`);
            return jsonQ(200, out);
          }
          if (pathname === '/__fsql/test' && post) return jsonQ(200, await fq.test(b.pod));
          if (pathname === '/__fsql/setups/check' && post) {
            const pod = b.pod || (fq.settings() || {}).active || '';
            const out = await o.fusionSetupsStore.check(pod, b.code);
            const res = out.task && out.task.result;
            log(`Fusion Setups ${b.code} -> ${out.ok ? res.status + (res.count != null ? ' (' + res.count + ')' : '') : out.error}`);
            return jsonQ(200, out);
          }
          if (pathname === '/__fsql/deploy' && post) {
            const out = await fq.deploy(b.pod);
            log(`Fusion SQL deploy -> ${out.ok ? 'done' : out.error}`);
            return jsonQ(200, out);
          }
          if (pathname === '/__fsql/schema/owners' && !post) return jsonQ(200, await fq.owners(get('pod'), get('refresh') === '1'));
          if (pathname === '/__fsql/schema/objects' && !post) return jsonQ(200, await fq.objects(get('pod'), get('owner'), get('kind'), get('refresh') === '1'));
          if (pathname === '/__fsql/schema/search' && !post) return jsonQ(200, await fq.search(get('pod'), get('owner'), get('kind'), get('q')));
          if (pathname === '/__fsql/schema/detail' && !post) return jsonQ(200, await fq.detail(get('pod'), get('owner'), get('kind'), get('name'), get('refresh') === '1'));
          if (pathname === '/__fsql/ask' && post) {
            const ai = o.aiStore;
            const chat = ai ? (system, user) => ai.chat({ feature: 'sql', system, user, maxTokens: 6000 }) : null;
            const out = await fq.ask(b, chat);
            log(`Fusion SQL Ask AI -> ${out.ok ? (out.sql ? (out.checked ? 'SQL, checked on the pod' : 'SQL, not accepted by the pod') : 'an answer') : out.error}`);
            return jsonQ(200, out);
          }
          return jsonQ(404, { error: 'Not found' });
        })().catch((e) => jsonQ(200, { ok: false, error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__fdd/')) {
        // The FDD library (lib/fdd.js), for Build.Rite's FDD library page: upload an FDD into the project, make one the
        // latest, remove one, and commit + push those files to git. This PC only, by its own name, and only the app's own
        // page (it sends X-Build-Rite-FDD, which a page of another site cannot send without a preflight this server never
        // allows). Reading the library needs none of this: it ships with the app (resources/fdd).
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const jsonD = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        if (!o.fddStore) return jsonD(200, { ok: false, error: 'The FDD library is not set up in this app.' });
        const origin = req.headers.origin;
        if (req.headers['x-build-rite-fdd'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from Build.Rite on this PC.' }));
        }
        const fd = o.fddStore;
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 90 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 90 * 1024 * 1024 ? reject(new Error('The file is too large to upload.')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        const post = req.method === 'POST';
        const who = () => { try { const id = o.getIdentity && o.getIdentity(); return (id && (id.displayName || id.username)) || ''; } catch (e) { return ''; } };
        // b: { story: { key, summary, sprint, epic, assignee, due, status, url }, storyText, fdd: { id, name, text }, mapped: [page id] }
        const designFor = async (b) => {
          const D = require('./designDoc');
          const st = b.story || {};
          const key = String(st.key || '').trim();
          if (!key) return { ok: false, error: 'Which story?' };
          if (!o.aiStore) return { ok: false, error: 'Set up AI first (Tools → AI settings).' };
          if (!fd.saveDesign) return { ok: false, error: 'Design documents are not set up in this app.' };
          // its analysis, as saved (Analyze with AI): the design builds on it
          let analysis = '';
          try { const a = o.analysisStore && o.analysisStore.get(key); analysis = (a && a.ok && a.item && a.item.text) || ''; } catch (e) { analysis = ''; }
          // the pages it touches: those mapped to it, then those whose words it shares — read from the code as it is now
          const ps = o.pagesStore;
          let all = [], pages = [], backends = [];
          if (ps) {
            try { all = (ps.catalog().pages || []).filter((p) => !p.deleted && !p.missing); } catch (e) { all = []; }
            const mapped = (b.mapped || []).concat(all.filter((p) => (p.stories || []).some((k) => String(k).toUpperCase() === key.toUpperCase())).map((p) => p.id));
            const story = { summary: st.summary, description: b.storyText };
            const near = D.relevantPages(all.map((p) => ({ id: p.id, label: p.label, appName: p.appName })), story, [], 12, 1);
            const factsOf = (id) => { try { return ps.facts(id); } catch (e) { return null; } };
            const cand = near.map((id) => ({ id, f: factsOf(id) })).filter((x) => x.f);
            const scored = D.relevantPages(cand.map((x) => ({ id: x.id, label: x.f.label, description: x.f.description, fields: (x.f.features || {}).fields,
              sections: (x.f.features || {}).sections, actions: ((x.f.features || {}).actions || []).map((a) => a.label) })), story, mapped.filter((id, i) => mapped.indexOf(id) === i), 4, 1);
            pages = scored.map((id) => (cand.filter((x) => x.id === id)[0] || {}).f || factsOf(id)).filter(Boolean);
            pages.forEach((f) => ((f.integrations || {}).backends || []).forEach((x) => { const n = (x && (x.label || x.id)) || String(x || ''); if (n && backends.indexOf(n) === -1) backends.push(n); }));
          }
          const appName = (pages[0] && pages[0].appName) || (all[0] && all[0].appName) || '';
          const p = D.prompt({ story: st, storyText: b.storyText, analysis, fdd: b.fdd && b.fdd.text ? b.fdd : null, pages, backends,
            allPages: all.map((x) => ({ id: x.id, label: x.label })), appName });
          const ai = await o.aiStore.chat({ feature: 'analysis', system: p.system, user: p.user, maxTokens: 16000 });
          if (!ai || !ai.ok || !ai.text) return { ok: false, error: (ai && ai.error) || 'AI did not write the design.', needsSetup: !!(ai && ai.needsSetup) };
          const date = new Date().toISOString().slice(0, 10);
          const version = 1 + fd.designs(key).reduce((m, d) => Math.max(m, Number(d.version) || 0), 0);
          const meta = { key, title: st.summary, sprint: st.sprint, epic: st.epic, assignee: st.assignee, due: st.due, status: st.status, version, date, author: who(),
            fdd: b.fdd && b.fdd.text ? b.fdd.name : '', app: appName, pages: pages.map((f) => f.id), provider: ai.provider || '' };
          const html = D.renderDocument({ meta, markdown: ai.text });
          let pdf = null, pdfError = '';
          if (o.htmlToPdf) { try { pdf = await o.htmlToPdf(html); } catch (e) { pdfError = String((e && e.message) || e); } } else pdfError = 'PDF printing is only in the desktop app: the HTML is saved; print it to PDF from a browser.';
          const r = fd.saveDesign({ story: st, markdown: ai.text, html, pdf, fdd: b.fdd ? { id: b.fdd.id, name: b.fdd.name } : null, pages: meta.pages, provider: ai.provider || '', model: ai.model || '', by: who() });
          if (r.ok && pdfError) r.pdfError = pdfError;
          if (r.ok) r.analysisUsed = !!analysis;
          return r;
        };
        (async () => {
          const b = post ? JSON.parse((await bodyOf()) || '{}') : {};
          if (pathname === '/__fdd/info' && req.method === 'GET') return jsonD(200, Object.assign(fd.info(), { data: fd.dataInfo ? fd.dataInfo() : null }));
          if (pathname === '/__fdd/git/pull' && post) return jsonD(200, fd.gitPull ? await fd.gitPull() : { ok: true, merged: false });
          if (pathname === '/__fdd/outline' && req.method === 'GET') return jsonD(200, fd.outline(u.searchParams.get('id') || ''));
          if (pathname === '/__fdd/git/status' && req.method === 'GET') return jsonD(200, Object.assign({ ok: true }, await fd.gitStatus()));
          if (pathname === '/__fdd/original' && req.method === 'GET') {
            const f = fd.original(u.searchParams.get('id') || '');
            if (!f.ok) return jsonD(404, f);
            return send(res, 200, f.mime, fs.readFileSync(f.file), { 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${encodeURIComponent(f.name)}"` });
          }
          if (pathname === '/__fdd/upload' && post) {
            const r = await fd.upload(Object.assign({}, b, { by: b.by || who() }));
            log(`FDD upload ${b.fileName || ''} -> ${r.ok ? r.doc.id + ', ' + r.doc.sections + ' sections' : r.error}`);
            if (r.ok && b.commit) {
              r.git = await fd.gitSave({ message: `FDD library: add ${r.doc.name}${r.doc.version ? ' v' + r.doc.version : ''}${r.latest === r.doc.id ? ' (latest)' : ''}`, push: b.push !== false });
              log(`FDD git -> ${r.git.ok ? (r.git.committed || 'nothing to commit') + (r.git.pushed ? ', pushed to ' + r.git.upstream : '') : r.git.error}`);
            }
            return jsonD(200, r);
          }
          if (pathname === '/__fdd/latest' && post) {
            const r = fd.setLatest(b.id);
            if (r.ok && b.commit) r.git = await fd.gitSave({ message: `FDD library: ${b.id} is the latest`, push: b.push !== false });
            return jsonD(200, r);
          }
          if (pathname === '/__fdd/remove' && post) {
            const r = fd.remove(b.id);
            if (r.ok && b.commit) r.git = await fd.gitSave({ message: `FDD library: remove ${b.id}`, push: b.push !== false });
            return jsonD(200, r);
          }
          // ── The functional design of a story (Analyze with AI → Create the functional design): its saved analysis, the
          // FDD sections the page picked, the pages it touches as their code is now (the working folder), the AI, the PDF
          if (pathname === '/__fdd/designs' && req.method === 'GET') return jsonD(200, { ok: true, docs: fd.designs ? fd.designs(u.searchParams.get('story') || '') : [] });
          if (pathname === '/__fdd/design-file' && req.method === 'GET') {
            const f = fd.designFile(u.searchParams.get('id') || '', u.searchParams.get('kind') || 'pdf');
            if (!f.ok) return jsonD(404, f);
            const disp = u.searchParams.get('download') ? 'attachment' : 'inline';
            return send(res, 200, f.mime, fs.readFileSync(f.file), { 'Cache-Control': 'no-store', 'Content-Disposition': `${disp}; filename="${encodeURIComponent(f.name)}"`,
              // a design's HTML is shown in a frame: nothing in it runs
              'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'", 'X-Content-Type-Options': 'nosniff' });
          }
          if (pathname === '/__fdd/design-open' && post) {
            const f = fd.designFile(b.id, b.kind || 'pdf');
            if (!f.ok) return jsonD(200, f);
            if (typeof o.vbsOpenPath !== 'function') return jsonD(200, { ok: false, error: 'Opening a file needs the desktop app: download it instead.' });
            const err = await o.vbsOpenPath(b.folder ? path.dirname(f.file) : f.file);
            return jsonD(200, err ? { ok: false, error: String(err) } : { ok: true, path: f.file });
          }
          if (pathname === '/__fdd/design-remove' && post) {
            const r = fd.removeDesign(b.id);
            if (r.ok && b.commit) r.git = await fd.gitSave({ message: `Design: remove ${b.id}`, push: b.push !== false });
            return jsonD(200, r);
          }
          if (pathname === '/__fdd/design' && post) {
            const r = await designFor(b);
            log(`Design ${(b.story && b.story.key) || ''} -> ${r.ok ? r.doc.id + (r.doc.files.pdf ? ' (PDF)' : ' (no PDF)') : r.error}`);
            if (r.ok && b.commit) {
              r.git = await fd.gitSave({ message: `Design: ${r.doc.key} v${r.doc.version}${r.doc.title ? ' — ' + r.doc.title.slice(0, 60) : ''}`, push: b.push !== false });
              log(`Design git -> ${r.git.ok ? (r.git.committed || 'nothing to commit') + (r.git.pushed ? ', pushed to ' + r.git.upstream : '') : r.git.error}`);
            }
            return jsonD(200, r);
          }
          if (pathname === '/__fdd/git/save' && post) {
            const r = await fd.gitSave({ message: b.message, push: b.push !== false });
            log(`FDD git -> ${r.ok ? (r.committed || 'nothing to commit') + (r.pushed ? ', pushed to ' + r.upstream : '') : r.error}`);
            return jsonD(200, r);
          }
          return jsonD(404, { error: 'Not found' });
        })().catch((e) => jsonD(200, { ok: false, error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__sql/') && (o.sqlStore || o.aiStore)) {
        // Build.Rite's SQL worksheet (lib/oracleSql.js). This PC only, by its own name; and only the app's own page:
        // it sends X-Build-Rite-SQL, which a page of another site cannot send without a preflight this server never allows.
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const origin = req.headers.origin;
        if (req.headers['x-build-rite-sql'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from Build.Rite on this PC.' }));
        }
        const sq = o.sqlStore;
        const json = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 2 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 2 * 1024 * 1024 ? reject(new Error('Too large')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        const post = req.method === 'POST';
        const conn = /^\/__sql\/connections\/([A-Za-z0-9]+)$/.exec(pathname);
        const started = Date.now();
        (async () => {
          const b = post ? JSON.parse((await bodyOf()) || '{}') : {};
          if (pathname === '/__sql/info') return json(200, sq.info());
          if (pathname === '/__sql/connections' && req.method === 'GET') return json(200, sq.list());
          if (pathname === '/__sql/connections' && post) return json(200, sq.save(b));
          if (conn && req.method === 'DELETE') return json(200, sq.remove(conn[1]));
          if (pathname === '/__sql/tns') return json(200, sq.tnsAliases(u.searchParams.get('dir') || ''));
          if (pathname === '/__sql/sessions') return json(200, sq.sessions());
          if (pathname === '/__sql/test' && post) {
            const r = await sq.test(b);
            log(`SQL test ${b.name || ''} -> ${r.ok ? 'ok' : 'failed'} (${r.ms} ms)`);
            return json(200, r);
          }
          if (pathname === '/__sql/connect' && post) {
            const r = await sq.connect(b);
            log(`SQL connect ${r.name} as ${r.user} -> ok (${Date.now() - started} ms)`);
            return json(200, r);
          }
          if (pathname === '/__sql/run' && post) {
            try {
              const r = await sq.run(b.session, b.sql, { fetch: b.fetch });
              log(`SQL ${r.kind} -> ok (${r.ms} ms)`);
              return json(200, r);
            } catch (e) {
              log(`SQL run -> ${String(e.message).split('\n')[0].slice(0, 120)}`);
              // A statement the database refused is an answer, not a failed call: its words go back as data.
              return json(200, { error: e.message, ms: e.ms || Date.now() - started });
            }
          }
          // Ask AI (lib/aiSql.js): the LLM the person chose, with their key, called from here; the page never holds a key.
          const ai = o.aiStore;
          if (pathname.startsWith('/__sql/ai/') && !ai) return json(200, { error: 'Ask AI is not set up in this app.' });
          if (pathname === '/__sql/ai/settings' && req.method === 'GET') return json(200, ai.settings());
          if (pathname === '/__sql/ai/settings' && post) return json(200, ai.save(b));
          if (pathname === '/__sql/ai/forget' && post) return json(200, ai.forget(b.provider));
          // the default AI, and one feature's own (AI settings)
          // Claude Code on this PC: found? install it, sign in (a window of its own), test it
          if (pathname === '/__sql/ai/claude' && req.method === 'GET') return json(200, ai.claudeStatus ? await ai.claudeStatus() : { ok: false, error: 'Not here.' });
          if (pathname === '/__sql/ai/claude/install' && post) { log('Claude Code: installing with npm'); const r = await ai.claudeInstall(); log('Claude Code install -> ' + (r.ok ? 'done' : r.error)); return json(200, r); }
          if (pathname === '/__sql/ai/claude/signin' && post) return json(200, ai.claudeSignIn());
          if (pathname === '/__sql/ai/claude/check' && post) { const r = await ai.claudeCheck(); log('Claude Code test -> ' + (r.ok ? 'answered' : r.error)); return json(200, r); }
          if (pathname === '/__sql/ai/default' && post) { try { return json(200, ai.setDefault(b.provider)); } catch (e) { return json(200, { error: e.message }); } }
          if (pathname === '/__sql/ai/use' && post) { try { return json(200, ai.setUse({ feature: b.feature, provider: b.provider })); } catch (e) { return json(200, { error: e.message }); } }
          if (pathname === '/__sql/ai/models' && post) {
            const r = await ai.models(b.provider);
            log(`AI models ${b.provider} -> ${r.ok ? r.models.length + ' models' : 'failed'} (${r.ms} ms)`);
            return json(200, r);
          }
          if (pathname === '/__sql/ai/ask' && post) {
            try {
              const sc = b.session ? await sq.schema(b.session) : { owner: '', banner: '', tables: [] };
              const r = await ai.ask({ question: b.question, sql: b.sql, schema: sc, banner: sc.banner, provider: b.provider });
              log(`AI ask ${r.provider} ${r.model} -> ${r.sql ? 'SQL' : 'no SQL'} (${r.ms} ms, ${r.sent.tables} tables named)`);
              return json(200, r);
            } catch (e) {
              log(`AI ask -> ${String(e.message).slice(0, 160)}`);
              return json(200, { error: e.message });
            }
          }
          // A plain chat turn (no schema, no SQL parsing): Build.Rite's Minutes page "Format by AI" posts { system, user }.
          if (pathname === '/__sql/ai/chat' && post) {
            try {
              const r = await ai.chat(b);
              log(`AI chat ${r.provider || ''} ${r.model || ''} -> ${r.ok ? (r.text || '').length + ' chars' : 'failed'} (${r.ms || 0} ms)`);
              return json(200, r);
            } catch (e) {
              log(`AI chat -> ${String(e.message).slice(0, 160)}`);
              return json(200, { ok: false, error: e.message });
            }
          }
          if (pathname === '/__sql/more' && post) return json(200, await sq.more(b.session, b.count));
          if (pathname === '/__sql/commit' && post) return json(200, await sq.commit(b.session));
          if (pathname === '/__sql/rollback' && post) return json(200, await sq.rollback(b.session));
          if (pathname === '/__sql/cancel' && post) return json(200, await sq.cancel(b.session));
          if (pathname === '/__sql/disconnect' && post) return json(200, await sq.disconnect(b.session));
          // ── the SQL library (saved queries, infolets, dashboards) — shared on the data branch (o.savedSqlStore) ──
          {
            const sv = o.savedSqlStore;
            const who = () => { try { const id = o.getIdentity && o.getIdentity(); return (id && (id.displayName || id.username)) || ''; } catch (e) { return ''; } };
            if (pathname === '/__sql/saved' && req.method === 'GET') return json(200, sv ? { ok: true, queries: sv.listQueries(u.searchParams.get('conn')), git: sv.info() } : { ok: false, error: 'The SQL library needs the desktop app.' });
            if (pathname === '/__sql/saved/get' && post) return json(200, sv ? { ok: true, query: sv.getQuery(b.id) } : { ok: false, error: 'The SQL library needs the desktop app.' });
            if (pathname === '/__sql/saved/save' && post) {
              if (!sv) return json(200, { ok: false, error: 'The SQL library needs the desktop app.' });
              const r = sv.saveQuery(b, who());
              if (r.ok && b.commit) { r.git = await sv.gitSave({ message: 'SQL query: ' + (r.query.name || ''), push: b.push !== false }); }
              log(`SQL save "${b.name || ''}" -> ${r.ok ? 'saved' + (r.git ? (r.git.pushed ? ', pushed' : (r.git.committed ? ', committed' : '')) : '') : r.error}`);
              return json(200, r);
            }
            if (pathname === '/__sql/saved/remove' && post) {
              if (!sv) return json(200, { ok: false, error: 'The SQL library needs the desktop app.' });
              const r = sv.removeQuery(b.id);
              if (r.ok && b.commit) { r.git = await sv.gitSave({ message: 'SQL query removed', push: b.push !== false }); }
              return json(200, r);
            }
            if (pathname === '/__sql/saved/ran' && post) return json(200, sv ? sv.ranQuery(b.id) : { ok: false });
            if (pathname === '/__sql/saved/git/save' && post) return json(200, sv ? await sv.gitSave({ message: b.message || 'SQL library: update', push: b.push !== false }) : { ok: false, error: 'The SQL library needs the desktop app.' });
          }
          return json(404, { error: 'Not found' });
        })().catch((e) => json(200, { error: e.message }));
        return undefined;
      }
      const ab = /^\/__apibackend\/([^/]+)(\/.*)?$/.exec(pathname);
      if (ab) {
        // the API tester's send to your workspace's backends (o.apiProject): this server's own request, never a page's
        const alt = apiProject();
        if (!alt || !isLoopback(req.socket.remoteAddress) || req.headers.origin) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        return proxy(req, res, decodeURIComponent(ab[1]), ab[2] || '', u.search, alt);
      }
      const b = /^\/__backend\/([^/]+)(\/.*)?$/.exec(pathname);
      if (b) {
        return proxy(req, res, decodeURIComponent(b[1]), b[2] || '', u.search);
      }
      if (/^\/(version_[^/]+\/)?services\/catalog\.json$/.test(pathname)) {
        return send(res, 200, 'application/json', JSON.stringify(loadCatalog(`http://${req.headers.host}`)));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed');
      }
      return serveFile(req, res, pathname);
    }).catch((e) => {
      log(`${req.method} ${pathname} -> ERROR ${e.message}`);
      if (!res.headersSent) {
        send(res, 500, 'application/json', JSON.stringify({ error: e.message }));
      } else {
        res.destroy();
      }
    });
  });

  return new Promise((resolve, reject) => {
    if (!fs.existsSync(path.join(webRoot, 'index.html'))) {
      reject(new Error(`No build in ${webRoot}. Run "npm run desktop:fresh" (or "npm run build") first.`));
      return;
    }
    server.once('error', (e) => reject(e.code === 'EADDRINUSE'
      ? new Error(`Port ${o.port} is already in use. Close the other Build.Rite window, or set BUILDRITE_PORT to another port.`)
      : e));
    server.listen(o.port, o.host || '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, url: `http://localhost:${port}/`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

/** True when `npm run build` has produced this web app (build/processed/webApps/<webApp>/index.html). */
function isBuilt(buildDir, webApp) {
  return fs.existsSync(path.join(buildDir, 'processed', 'webApps', webApp, 'index.html'));
}

/** Identity for `npm run serve`: BUILDRITE_USER, then BUILDRITE_ROLES (comma-separated) or BUILDRITE_FUSION_PASSWORD (+ BUILDRITE_FUSION_USER). */
function identityFromEnv(env) {
  const roles = String(env.BUILDRITE_ROLES || '').split(',').map((r) => r.trim().toUpperCase()).filter(Boolean);
  const password = env.BUILDRITE_FUSION_PASSWORD || '';
  return {
    username: env.BUILDRITE_USER || '',
    roles: roles.length ? roles : null,
    fusion: password ? { user: env.BUILDRITE_FUSION_USER || env.BUILDRITE_USER || '', password } : null,
  };
}

module.exports = {
  createDevServer,
  isBuilt,
  rewriteCatalog,
  fusionCredential,
  fillAppFlow,
  currentUser,
  rolesReportResponse,
  isRolesReport,
  loginFor,
  reportName,
  backendOverridesFromEnv,
  identityFromEnv,
  safeFile,
};

if (require.main === module) {
  // `npm run serve`: Build.Rite in your browser (no desktop app: no VB Studio window, no screenshots, no Run).
  // BUILDRITE_WEBAPP=<app> serves another built app; BUILDRITE_USER / BUILDRITE_ROLES / BUILDRITE_FUSION_* who it runs as.
  const identity = identityFromEnv(process.env);
  const port = Number(process.env.BUILDRITE_PORT) || 8888;
  const webApp = process.env.BUILDRITE_WEBAPP || 'buildrite';
  const projectRoot = path.resolve(__dirname, '..', '..');
  const home = path.join(require('os').homedir(), '.buildrite');
  const own = webApp === 'buildrite';
  // the app's data (FDD library, Application pages) on its own git branch, as in the desktop app (lib/dataBranch.js)
  (own ? require('./dataBranch').open({ root: projectRoot, log: (l) => console.log(l) }).ensure() : Promise.resolve(null)).then((data) => createDevServer({
    buildDir: path.resolve(__dirname, '..', '..', 'build'),
    webApp,
    port,
    getIdentity: () => identity,
    backendOverrides: backendOverridesFromEnv(process.env),
    // the FDD library page uploads into git (the data branch) when served this way too
    fddStore: own ? require('./fdd').open({ root: projectRoot, data: data }) : undefined,
    // the Application pages catalog (no screenshots captured this way: upload them, or use the desktop app)
    pagesStore: own ? require('./pages').open({ root: projectRoot, data: data }) : undefined,
    // saved AI analyses and the API tester's runs, in your home folder (~/.buildrite) when served this way
    analysisStore: own ? require('./analyses').open({ file: path.join(home, 'ai-analyses.json') }) : undefined,
    apiStore: own ? require('./apiTest').open({ root: projectRoot, file: path.join(home, 'api-tests.json') }) : undefined,
    onLog: (line) => console.log(line),
  })).then(({ url }) => {
    console.log(`
${own ? 'Build.Rite' : webApp} is running at ${url}  (Ctrl+C stops it)`);
    if (!own) console.log(identity.username ? `It runs as ${identity.username}; roles ${identity.roles ? identity.roles.join(', ') : 'from its backend'}` : 'It runs as nobody (anonymous): set BUILDRITE_USER and BUILDRITE_ROLES to run it as someone.');
  }).catch((e) => {
    console.error(`
serve: ${e.message}
`);
    process.exit(1);
  });
}
