'use strict';

/**
 * Build.Rite desktop app (Electron).
 *
 * Build.Rite is the team's tools for an Oracle Visual Builder Studio project, on your PC: your VB Studio workspace cloned
 * into a folder (main and working), its app built and run from its working folder (▶ Run, the Run console), issues
 * written up and analysed by the AI and fixed on a branch, Code fix on a page with each change marked in the code, the
 * app's pages with their technical sheets, Jira stories, standup minutes, follow-ups, the FDD library and SQL.
 *
 * Build.Rite is itself a Visual Builder app (webApps/buildrite), built with Oracle's VB build tool (npm run build) and
 * served by a local server in this process (lib/devserver.js); this window shows it. Your workspace's app gets a local
 * server of its own when it runs (lib/workPreview.js builds it beside the working folder, never inside it).
 *
 * Who you are: your git name and email on this PC (git config user.name / user.email) — what your commits carry too.
 * Who your workspace's app runs as: Run as (the Run console), and its backend login from File → Sign in for your app…,
 * kept encrypted on this PC (lib/identity.js). Keys and passwords are encrypted with the OS keychain (safeStorage);
 * nothing is ever written into a project.
 *
 * Nothing native is compiled and no shell is started for the app itself: the dependencies are Electron (a prebuilt
 * binary) and, for SQL and the minutes, prebuilt node-oracledb and DuckDB.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, Menu, shell, ipcMain, safeStorage, dialog, clipboard, desktopCapturer, globalShortcut, session } = require('electron');
const { createDevServer, isBuilt, backendOverridesFromEnv } = require('./lib/devserver');
const identityStore = require('./lib/identity');
const { navAllowed } = require('./lib/hosts');

const APP_NAME = 'Build.Rite';
// Build.Rite's own local server (the window shows it); your workspace's app gets a free port of its own when it runs
const PORT = Number(process.env.BUILDRITE_PORT) || 18893;
const REPO_ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(REPO_ROOT, 'build');
const WEB_APP = 'buildrite';
// An error nobody caught (a promise that failed with no .catch): said with where it came from — in the terminal, the
// Run console and View → Backend calls… — instead of Node's bare "unhandled rejection" warning.
process.on('unhandledRejection', (reason) => {
  const text = String((reason && reason.stack) || reason || 'unknown').split('\n').slice(0, 6).join('\n');
  console.error('[Build.Rite] an error nobody caught:\n' + text);
  try { pushLog(`${new Date().toTimeString().slice(0, 8)} an error nobody caught: ${text.replace(/\n\s*/g, ' | ')}`); } catch (e) { /* the log is not there yet */ }
  try { cpush('error', 'Build.Rite: an error nobody caught: ' + text.split('\n')[0]); } catch (e) { /* the console is not there yet */ }
});
// The SQL worksheet: Oracle connections kept in this app's data folder, passwords in the OS keychain.
let sqlConnStore = null;
async function sqlStore() {
  if (!sqlConnStore) {
    sqlConnStore = await require('./lib/oracleSql').open({
      file: path.join(app.getPath('userData'), 'sql-connections.json'),
      encrypt: canEncrypt() ? (t) => safeStorage.encryptString(t) : null,
      decrypt: canEncrypt() ? (b) => safeStorage.decryptString(b) : null,
    });
  }
  return sqlConnStore;
}
// Ask AI in the SQL worksheet: the LLM chosen and its key, kept in this app's data folder (the key in the OS keychain).
// Calls go through Chromium's network stack (net.fetch), so the PC's proxy settings apply.
let aiConnStore = null;
async function aiStore() {
  if (!aiConnStore) {
    const { net } = require('electron');
    aiConnStore = await require('./lib/aiSql').open({
      file: path.join(app.getPath('userData'), 'ai-settings.json'),
      encrypt: canEncrypt() ? (t) => safeStorage.encryptString(t) : null,
      decrypt: canEncrypt() ? (b) => safeStorage.decryptString(b) : null,
      fetch: net && typeof net.fetch === 'function' ? (url, init) => net.fetch(url, init) : undefined,
    });
  }
  return aiConnStore;
}
// Connect Jira, for the Jira stories page: the site, email, API token and project key (the token in the OS keychain).
let jiraAuthStore = null;
function jiraStore() {
  if (!jiraAuthStore) {
    jiraAuthStore = require('./lib/jiraAuth').open({
      file: path.join(app.getPath('userData'), 'jira-connection.json'),
      encrypt: canEncrypt() ? (t) => safeStorage.encryptString(t) : null,
      decrypt: canEncrypt() ? (b) => safeStorage.decryptString(b) : null,
    });
  }
  return jiraAuthStore;
}
// Record, on a Jira story's panel: recordings and screenshots kept in Documents/Build.Rite Test Evidence, a
// folder per story (lib/testEvidence.js); the page records the screen or window chosen (getDisplayMedia, answered below).
let evidenceStoreInst = null;
function evidenceStore() {
  if (!evidenceStoreInst) {
    evidenceStoreInst = require('./lib/testEvidence').open({
      dir: path.join(app.getPath('documents'), 'Build.Rite Test Evidence'),
      reveal: (folder) => shell.openPath(folder),
    });
  }
  return evidenceStoreInst;
}
// Transcribe a recording's voice (lib/transcribe.js): local Whisper (whisper.cpp) on this PC, or OpenAI's Whisper with
// the key the person set for Ask AI. Models for local Whisper live in Documents/Build.Rite Test Evidence/.whisper.
let transcriberInst = null;
async function transcriber() {
  if (!transcriberInst) {
    const ai = await aiStore();
    transcriberInst = require('./lib/transcribe').open({
      modelsDir: path.join(app.getPath('documents'), 'Build.Rite Test Evidence', '.whisper'),
      tmpDir: app.getPath('temp'),
      which: (cmd) => commandPath(cmd),
      run: runCommand,
      fetch: (url, init) => { const { net } = require('electron'); return net.fetch(url, init); },
      openaiKey: () => ai.secretFor('openai', 'key'),
      reveal: (folder) => shell.openPath(folder),
    });
  }
  return transcriberInst;
}
// Standup minutes, for the Minutes page: the daily standup on the Jira backlog, kept in this app's data
// folder (the Teams webhook in the OS keychain). Voice→text reuses the Whisper engine; "Format by AI" the Ask AI key.
// Interactive Microsoft 365 sign-in in a popup window (auth-code + PKCE): open the Microsoft page in a child
// BrowserWindow and capture the ?code= from the redirect to the native-client URL — far more reliable than device code.
function interactiveAuth(authUrl, redirectUri) {
  return new Promise((resolve) => {
    let done = false;
    const auth = new BrowserWindow({ width: 520, height: 700, parent: win || undefined, modal: !!win, show: true, autoHideMenuBar: true,
      title: 'Sign in to Microsoft 365', webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:buildrite-msauth' } });
    const finish = (r) => { if (done) return; done = true; try { auth.destroy(); } catch (e) { /* already gone */ } resolve(r); };
    const check = (url) => {
      if (!url || url.indexOf(redirectUri) !== 0) return false;
      try { const u = new URL(url); const code = u.searchParams.get('code'); const err = u.searchParams.get('error_description') || u.searchParams.get('error');
        if (code) { finish({ code: code }); return true; } if (err) { finish({ error: err }); return true; } } catch (e) { /* keep waiting */ }
      return false;
    };
    auth.webContents.on('will-redirect', (e, url) => { if (check(url)) e.preventDefault(); });
    auth.webContents.on('will-navigate', (e, url) => { if (check(url)) e.preventDefault(); });
    auth.webContents.on('did-navigate', (e, url) => check(url));
    auth.on('closed', () => { if (!done) { done = true; resolve({ error: 'Sign-in window was closed before it finished.' }); } });
    auth.loadURL(authUrl).catch((e) => finish({ error: String((e && e.message) || e) }));
  });
}

// Microsoft 365 (lib/graph.js): one sign-in for the app — Standup minutes sends the minutes, Issues the approval emails.
let graphStoreInst = null;
function graphStore() {
  if (!graphStoreInst) graphStoreInst = require('./lib/graph').open({
        file: path.join(app.getPath('userData'), 'graph.json'),
        encrypt: canEncrypt() ? (t) => safeStorage.encryptString(t) : null,
        decrypt: canEncrypt() ? (b) => safeStorage.decryptString(b) : null,
        fetch: (url, init) => { const { net } = require('electron'); return net.fetch(url, init); },
        // The device-code verification page opens inside Build.Rite (a child window), so sign-in stays in the app.
        openExternal: (u) => {
          try {
            const dcWin = new BrowserWindow({ width: 520, height: 720, parent: win || undefined, show: true, autoHideMenuBar: true,
              title: 'Sign in to Microsoft 365', webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:buildrite-msauth' } });
            dcWin.loadURL(u);
            return dcWin;
          } catch (e) { const { shell } = require('electron'); return shell.openExternal(u); }
        },
        interactiveAuth: interactiveAuth,
      });
  return graphStoreInst;
}

let minutesStoreInst = null;
async function minutesStore() {
  if (!minutesStoreInst) {
    minutesStoreInst = await require('./lib/minutes').open({
      file: path.join(app.getPath('userData'), 'minutes.duckdb'),
      encrypt: canEncrypt() ? (t) => safeStorage.encryptString(t) : null,
      decrypt: canEncrypt() ? (b) => safeStorage.decryptString(b) : null,
      transcribe: await transcriber(),
      fetch: (url, init) => { const { net } = require('electron'); return net.fetch(url, init); },
      contacts: require('./lib/outlookContacts').read,
      outlookSend: require('./lib/outlookContacts').compose,
      graph: graphStore(),
    });
  }
  return minutesStoreInst;
}
// Saved follow-ups, for the Follow-ups page: follow-ups drafted on the Jira pages, kept in this app's data
// folder (followups.duckdb) with a header and detail lines.
let followupsStoreInst = null;
async function followupsStore() {
  if (!followupsStoreInst) {
    followupsStoreInst = await require('./lib/followups').open({
      file: path.join(app.getPath('userData'), 'followups.duckdb'),
    });
  }
  return followupsStoreInst;
}
// The app's data — the FDD library and the Application pages catalog — on its own git branch, apart from the code
// (lib/dataBranch.js: a worktree in <Build.Rite>/.buildrite-data): the app commits and pushes there, never to the code
// branch, so code pushes and the app's pushes do not collide. If git cannot set it up, the data stays in the project.
let dataBranchInst = null;
function dataBranch() {
  if (!dataBranchInst) dataBranchInst = require('./lib/dataBranch').open({ root: path.join(__dirname, '..'), gitPath: commandPath('git') || 'git', log: (l) => { try { pushLog(l); } catch (e) { console.log(l); } } }).ensure();
  return dataBranchInst;
}
// The FDD library, for the FDD library page and "Analyze with AI": documents shared through git (docs/fdd and
// webApps/buildrite/resources/fdd on the data branch), so every user has the same ones.
let fddStoreInst = null;
async function fddStore() {
  if (!fddStoreInst) fddStoreInst = require('./lib/fdd').open({ root: path.join(__dirname, '..'), data: await dataBranch(), gitPath: commandPath('git') || 'git' });
  return fddStoreInst;
}
// What Build.Rite read from an app's own files (lib/appProfile.js): its layout, Visual Builder version and build tool, its
// service connections and how they sign in, its roles, its components. Every VB app is different: nothing is assumed.
const appProfile = require('./lib/appProfile');
const profileOf = (folder, fresh) => appProfile.profileOf(folder, fresh ? { fresh: true } : undefined);
/** The VB project in your workspace's working folder (the folder itself, or a subfolder of the repo). */
const projectOf = (c) => { try { return appProfile.findRoot(c.working) || c.working; } catch (e) { return c.working; } };
// Oracle's VB build tool in the version each app asks for (lib/buildTools.js): Build.Rite's own, else installed once
let buildToolsInst = null;
function buildTools() {
  if (!buildToolsInst) {
    buildToolsInst = require('./lib/buildTools').open({ own: REPO_ROOT, cache: path.join(app.getPath('userData'), 'build-tools'), npm: commandPath('npm') || 'npm',
      run: (cmd, args, o) => new Promise((resolve) => {
        require('child_process').execFile(cmd, args, { cwd: o.cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true, shell: process.platform === 'win32' },
          (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || (err && err.message) || '') }));
      }),
      log: (l) => { pushLog(`${new Date().toTimeString().slice(0, 8)} ${l}`); cpush('build', l); } });
  }
  return buildToolsInst;
}
// Your workspace set up on this PC (the top bar: a VB Studio project ▸ workspace, cloned into main and working), or null
function currentWorkspace() {
  try { const c = vbsStoreInst && vbsStoreInst.work().current; return c && c.exists ? c : null; } catch (e) { return null; }
}
const NO_WORKSPACE = 'No workspace is set up: set one up first (Workspace, in the top bar).';
// The Application pages catalog (lib/pages.js), shared through git (the data branch). Its screenshots: your workspace's
// app built from its working folder and served (lib/workPreview.js), the page opened in a hidden window and captured
// once it has settled.
let pagesStoreInst = null;
async function pagesStore() {
  if (!pagesStoreInst) {
    const current = currentWorkspace;
    pagesStoreInst = require('./lib/pages').open({ root: REPO_ROOT, data: await dataBranch(), gitPath: commandPath('git') || 'git',
      capture: async (app, url) => {
        const c = current();
        if (!c) return { ok: false, error: NO_WORKSPACE };
        const p = await buildWorkspace(c, app, 'Capture screenshot');
        if (!p.ok) return { ok: false, error: p.error };
        return Object.assign(await capturePage(app, url, p.url), { from: 'workspace', built: p.built });
      },
      // Run it: the page in a window of its own — your workspace's app, built from its working folder
      run: async (app, url) => {
        const c = current();
        if (!c) return { ok: false, error: NO_WORKSPACE };
        const p = await buildWorkspace(c, app, 'Run it');
        if (!p.ok) return { ok: false, error: p.error };
        progStep({ key: 'open', state: 'done', text: 'opened ' + p.url + url });
        openRunWindow(p.url + url, 'Your workspace — ' + c.projectName + ' ▸ ' + c.workspace + ' (' + app + ')');
        return { ok: true, url: p.url + url, from: 'workspace', built: p.built, builtAt: p.builtAt };
      },
      rootFn: () => { const c = current(); return c ? projectOf(c) : ''; },
      // a workspace chosen whose folders are not on this PC as Build.Rite left them: said, not "no workspace"
      whyNot: () => {
        const x = vbsStoreInst && vbsStoreInst.work().current;
        if (!x || x.exists) return '';
        const miss = [x.main, x.working].filter((d) => !fs.existsSync(path.join(String(d || ''), '.git')));
        return 'Your workspace ' + x.projectName + ' ▸ ' + x.workspace + ' is chosen, but its folders are not on this PC as Build.Rite made them: ' + miss.join(' and ') + ' (no git there). Set it up again: the wizard copies it from VB Studio again, or uses those folders when they are there.';
      },
      rootLabel: () => { const c = current(); return c ? c.projectName + ' ▸ ' + c.workspace + ' (' + c.branch + ')' : ''; },
      // its sheets, screenshots and stories: that VB Studio project's own (all its workspaces share them), in a folder
      // named by a hash of the organization and project — never their names or VB Studio's host, which git would carry
      spaceFn: () => { const c = current(); return c ? spaceOf(c) : ''; },
      // Page code marks what changed against what VB Studio has: the workspace's branch, as last fetched from VB Studio
      baseFn: () => { const c = current(); return c && c.branch ? { ref: 'origin/' + c.branch, label: 'VB Studio (' + c.branch + ')' } : null; } });
  }
  return pagesStoreInst;
}
/** The folder a VB Studio project's shared data goes in (the data branch): 'p-' + 12 hex of a hash of its organization
 *  and project, so no host, organization or project name is ever written into git. */
function spaceOf(c) {
  return 'p-' + require('crypto').createHash('sha256').update(String(c.orgKey || '') + '/' + String(c.project || '')).digest('hex').slice(0, 12);
}
// Who you are in Build.Rite: your git name and email on this PC (what your commits carry), else your PC's user name.
let meCache = null;
function me() {
  if (meCache) return meCache;
  const g = (k) => { try { return require('child_process').execFileSync(commandPath('git') || 'git', ['config', '--get', k], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000, windowsHide: true }).trim(); } catch (e) { return ''; } };
  let user = '';
  try { user = os.userInfo().username; } catch (e) { user = ''; }
  const name = g('user.name'), email = g('user.email');
  meCache = { username: email || user || 'me', fullName: name || user || 'me', displayName: name || user || 'me', email: email };
  return meCache;
}
// Fusion SQL (lib/fusionSql.js): read-only SQL on a Fusion pod through its BI Publisher query runner. Pods and saved
// queries in this app's data folder, passwords in the OS keychain; a pod may use your app's login (Sign in for your app)
let fusionSqlInst = null;
function fusionSqlStore() {
  if (!fusionSqlInst) {
    fusionSqlInst = require('./lib/fusionSql').open({
      file: path.join(app.getPath('userData'), 'fusion-sql.json'),
      cacheDir: path.join(app.getPath('userData'), 'fusion-sql-cache'),
      encrypt: canEncrypt() ? (t) => safeStorage.encryptString(t) : null,
      decrypt: canEncrypt() ? (b) => safeStorage.decryptString(b) : null,
      fetch: (url, init) => require('electron').net.fetch(url, init),
      appLogin: () => { const id = workspaceIdentity() || identity; return id && id.fusion ? id.fusion : null; },
      appPod: () => fusionPodOfWorkspace(),
    });
  }
  return fusionSqlInst;
}
// Fusion Setups (lib/fusionSetups.js): the module-by-module setup checklist of Fusion SQL; each check runs as COUNT(*)
// through the runner above; the checklist and its results per pod in this app's data folder
let fusionSetupsInst = null;
function fusionSetupsStore() {
  if (!fusionSetupsInst) {
    fusionSetupsInst = require('./lib/fusionSetups').open({
      file: path.join(app.getPath('userData'), 'fusion-setups.json'),
      run: (x) => fusionSqlStore().execute(x),
    });
  }
  return fusionSetupsInst;
}
// The Oracle Cloud pod your workspace's app calls (a backend of its services catalog on *.oraclecloud.com), suggested
// as the address of a new Fusion SQL pod
function fusionPodOfWorkspace() {
  try {
    const c = currentWorkspace();
    if (!c) return '';
    const p = profileOf(c.working);
    for (const cf of ((p.services && p.services.catalogs) || [])) {
      const j = JSON.parse(fs.readFileSync(cf.file, 'utf8'));
      const urls = [];
      const walk = (x) => { if (!x || typeof x !== 'object') return; Object.keys(x).forEach((k) => { const v = x[k]; if (typeof v === 'string' && /^https:\/\/[^/]+\.oraclecloud\.com/i.test(v)) urls.push(v); else walk(v); }); };
      walk(j);
      const fa = urls.filter((x) => /\.fa\.[^/]*oraclecloud\.com/i.test(x))[0] || urls[0];
      if (fa) return new URL(fa).origin;
    }
  } catch (e) { /* no catalog */ }
  return '';
}
/** What Build.Rite's own local server is given: who you are and every store its screens use. */
async function buildRiteOptions() {
  return {
    getIdentity: me,
    // SQL: the desktop app connects to Oracle for it (node-oracledb, Thin mode); Ask AI: the LLM chosen and its key
    sqlStore: await sqlStore(),
    aiStore: await aiStore(),
    // Jira stories: Connect Jira keeps the site, email, token and project key on this PC; the proxy adds the token
    jiraStore: jiraStore(),
    // Record on a Jira story: its recordings and screenshots, kept on this PC
    recStore: evidenceStore(),
    // Transcribe a recording's voice with Whisper (local on this PC, or OpenAI with the Ask AI key)
    transcribe: await transcriber(),
    // Standup minutes and saved follow-ups, kept on this PC
    minutesStore: await minutesStore(),
    followupsStore: await followupsStore(),
    // The FDD library: FDDs uploaded into the project's data and pushed, so every user has them
    fddStore: await fddStore(),
    // Saved AI analyses: each run kept on this PC, so an analysis opens without asking the AI again
    analysisStore: analysisStore(),
    // The Application pages catalog: technical sheets of your workspace's VB pages and the Jira stories mapped to them
    pagesStore: await pagesStore(),
    // Code fix: AI-proposed changes to a page, written into your working folder only when approved
    fixStore: await fixStore(),
    // Issues: issue → AI write-up and analysis → approval → the agent's branch and pull request
    issuesStore: await issuesStore(),
    // The API tester: a page's REST calls and reports, tried against the real backend
    apiStore: apiStore(),
    scenarioStore: scenarioStore(),
    crStore: crStore(), // Change requests: a change asked of a page, made with Code Fix
    flowStore: flowStore(), // Saved flows: integration flows saved under a name, edited, commented on, checked against the app
    assistantStore: await assistantStore(), // AI Assistant: questions about the app answered from the workspace; conversations on this PC
    htmlToPdf: htmlToPdf, // Create the functional design: the document printed to PDF
    fusionSqlStore: fusionSqlStore(), // Fusion SQL: read-only SQL on a Fusion pod through its BI Publisher runner
    fusionSetupsStore: fusionSetupsStore(), // Fusion SQL → Fusion Setups: the setup checklist, checked on the pod
    appWindow: () => (runWin && !runWin.isDestroyed() ? { url: runWin.webContents.getURL(), title: runWin.getTitle() } : null), // the page your app's window shows (API Scenarios follows it)
    // …sent to your workspace's backends (its services/catalog.json), with who its app runs as (Run as, Sign in for your app)
    apiProject: () => { const c = currentWorkspace(); if (!c) return null; const p = profileOf(c.working); return { catalogFiles: ((p.services && p.services.catalogs) || []).map((x) => x.file), getIdentity: () => workspaceIdentity() }; },
    // What Build.Rite read from your workspace's app (Run console → Your app); scan: read it again
    vbsProfile: async (scan) => {
      const c = currentWorkspace();
      if (!c) return { ok: false, error: NO_WORKSPACE };
      const p = profileOf(c.working, scan);
      return { ok: true, profile: p, tool: p.kind === 'app' ? buildTools().choose(p) : null, login: { has: !!(identity && identity.fusion && identity.fusion.password), user: identity && identity.fusion ? identity.fusion.user : '' } };
    },
    // Organizations & projects: VB Studio organizations, projects and your workspace
    vbsStore: vbsStore(),
    vbsFind: openVbsFinder,
    vbsOpenPath: (p) => shell.openPath(p),
    vbsRun: runWorkspaceApp, // ▶ Run: your workspace's app, in a window of its own
    // the Run console: its lines, its commands, who the app runs as
    vbsConsole: { lines: (after) => runConsoleInst.lines(after), command: (t) => runConsoleInst.command(t, consoleDoes), status: () => consoleStatus(false), clear: () => runConsoleInst.clear(),
      progress: () => Object.assign({ ok: true }, runProg),
      runAs: async (b) => { const r = await consoleDoes.runAs(b && b.user != null ? String(b.user) : '', Array.isArray(b && b.roles) ? b.roles : []); cpush(r.ok ? 'info' : 'error', r.text); return Object.assign(consoleStatus(false), { ok: r.ok, text: r.text }); } },
    vbsPickFolder: async (start) => {
      const w = BrowserWindow.getFocusedWindow();
      const r = await dialog.showOpenDialog(w && !w.isDestroyed() ? w : undefined, { title: 'Where your workspace goes (Build.Rite makes its folder inside)', defaultPath: start || undefined, properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? '' : (r.filePaths[0] || '');
    },
    onLog: pushLog,
  };
}
/** What a VB app run by Build.Rite is given (your workspace's app, a sandbox's copy): who it runs as, its backends. */
function appOptions(s) {
  const working = s.dir;
  return {
    buildDir: s.buildDir, repoRoot: s.dir, webApp: s.webApp, port: 0,
    getIdentity: () => workspaceIdentity(), // Run as, with the login from Sign in for your app
    // the app reads its user's roles from a BI Publisher report: that report is answered with the Run-as roles
    rolesReport: () => rolesReportOf(working, s.webApp),
    // a recorded test's technical trace (Record, on a Jira story) sees the calls of the app it tests
    recStore: evidenceStore(),
    backendOverrides: backendOverridesFromEnv(process.env),
    onProblem: backendProblem,
  };
}
// A sandbox's app (Issues → Try it in a sandbox): its own build of the code (the issue's fix in it), served like your
// workspace's app on a free port of this PC, so the fix can be run and the page checked before anyone approves it.
async function serveSandbox(s) {
  const srv = await createDevServer(Object.assign(appOptions(s), { onLog: pushLog }));
  pushLog(`${new Date().toTimeString().slice(0, 8)} sandbox ${path.basename(s.dir)}: ${s.webApp} served at ${srv.url}`);
  return srv;
}
// The roles your workspace's app knows, found in its own code (lib/appRoles.js): offered by Run as and the sign-in
function knownRoles() {
  const c = currentWorkspace();
  if (!c) return [];
  try { return require('./lib/appRoles').rolesIn(projectOf(c), runAppOf(c)).roles || []; } catch (e) { return []; }
}
function rolesReportOf(folder, webApp) {
  try { return require('./lib/appRoles').rolesReportIn(folder, webApp) || ''; } catch (e) { return ''; }
}
// The Run console (lib/runConsole.js; Build.Rite → Run console): the build tool's output, the requests the workspace's app
// makes of its local server, the app window's own console, where it went — and commands (run, build, reload, devtools,
// git status…), each done here: nothing typed is run as a program
const runConsoleInst = require('./lib/runConsole').open();
const cpush = (kind, text) => { try { runConsoleInst.push(kind, text); } catch (e) { /* no console */ } };
// Building your workspace's app, step by step, for the screens to show (GET /__vbs/run/progress): what it is doing — check
// for changes, copy the working folder, prepare the copy, build with Oracle's VB build tool, start the app's server, open
// its window — each step's state and what it did, the build tool's last lines, how long
const STEP_LABEL = { check: 'Check for changes', copy: 'Copy the working folder', prepare: 'Prepare the copy', build: 'Build — Oracle\'s VB build tool', serve: 'Start the app\'s server', open: 'Open the app\'s window' };
let runProg = { running: false, steps: [], tail: [] };
function progStart(title, withOpen) {
  runProg = { running: true, title: String(title || 'Build'), at: new Date().toISOString(), end: '', ok: null, text: '', tail: [],
    steps: ['check', 'copy', 'prepare', 'build', 'serve'].concat(withOpen ? ['open'] : []).map((k) => ({ key: k, label: STEP_LABEL[k], state: 'todo', text: '' })) };
}
function progStep(s) {
  let x = runProg.steps.filter((p) => p.key === s.key)[0];
  if (!x) { x = { key: s.key, label: STEP_LABEL[s.key] || s.key }; runProg.steps.push(x); }
  x.state = s.state; x.text = s.text || '';
  if (s.state === 'running') x.at = new Date().toISOString(); else x.end = new Date().toISOString();
  if (s.state !== 'running') cpush(s.state === 'failed' ? 'error' : 'info', (STEP_LABEL[s.key] || s.key) + ': ' + (s.text || s.state));
  if (s.key === 'open' && s.state !== 'running') runProg.running = false; // its window open: the run is over
}
function progEnd(ok, text) { runProg.running = false; runProg.ok = !!ok; runProg.end = new Date().toISOString(); runProg.text = String(text || ''); }
/** Your workspace built (when its code changed) and its app served, its steps shown as they go. */
async function buildWorkspace(c, app, title) {
  progStart(title, /Run|run /.test(String(title)));
  const p = await workPreview().ensure({ folder: projectOf(c), out: require('./lib/workPreview').outOf(c.working), app: app });
  progEnd(p.ok, p.ok ? (p.built ? 'built in ' + (Math.round((p.ms || 0) / 100) / 10) + ' s' : 'no change since its last build') : p.error);
  if (p.ok && runProg.steps.some((x) => x.key === 'open')) runProg.running = true; // until its window opens
  setTimeout(() => { runProg.running = false; }, 4000);
  return p;
}
// Your workspace running in Build.Rite (lib/workPreview.js): its working folder built beside it (never inside it) with
// this project's build tool, and served like the app — what Capture screenshot and Run it open in your workspace
let workPreviewInst = null;
function workPreview() {
  if (!workPreviewInst) workPreviewInst = require('./lib/workPreview').open({ buildTool: (folder) => buildTools().ensure(profileOf(folder)), serve: serveWorkspace,
    log: (l) => { try { pushLog(`${new Date().toTimeString().slice(0, 8)} ${l}`); } catch (e) { console.log(l); } cpush('info', l); },
    onLine: (l) => { cpush('build', l); if (String(l).trim()) { runProg.tail.push(String(l).slice(0, 300)); if (runProg.tail.length > 10) runProg.tail.shift(); } },
    onStep: progStep });
  return workPreviewInst;
}
// Run as (the Run console): who your workspace's app runs as when Build.Rite runs it (▶ Run, Run it, Capture) — a user
// and roles answered on this PC (no password: run-as.json in this app's data folder), the roles offered being the ones
// found in the app's own code (lib/appRoles.js). None chosen: the user from Sign in for your app, else anonymous. Read on
// each request, so a change shows on the next reload.
let runAsMem = null;
const runAsFile = () => path.join(app.getPath('userData'), 'run-as.json');
function runAsNow() {
  if (!runAsMem) { try { const j = JSON.parse(fs.readFileSync(runAsFile(), 'utf8')); runAsMem = { user: String(j.user || ''), roles: Array.isArray(j.roles) ? j.roles.map(String) : [] }; } catch (e) { runAsMem = { user: '', roles: [] }; } }
  return runAsMem;
}
function setRunAs(user, roles) {
  const known = knownRoles();
  const u = String(user || '').trim().slice(0, 120);
  const rs = (roles || []).map((r) => String(r).trim().toUpperCase()).filter((r, i, a) => r && a.indexOf(r) === i);
  const bad = rs.filter((r) => !/^[A-Z][A-Z0-9_.-]{1,79}$/.test(r));
  if (bad.length) return { ok: false, text: 'Not a role code: ' + bad.join(', ') + (known.length ? ' — the roles in your app\'s code: ' + known.join(', ') : '') };
  if (u && !rs.length) return { ok: false, text: 'Give ' + u + ' at least one role (an app shows little to a user without one)' + (known.length ? ': ' + known.join(', ') : '') };
  if (!/^[\w.@\-]*$/.test(u)) return { ok: false, text: 'Not a user name: ' + u };
  runAsMem = { user: u, roles: u ? rs : [] };
  try { fs.mkdirSync(path.dirname(runAsFile()), { recursive: true }); fs.writeFileSync(runAsFile(), JSON.stringify(runAsMem, null, 1)); } catch (e) { /* this run only */ }
  noAccessSeen = null;
  return { ok: true, runAs: runAsMem };
}
/** Who the workspace's app runs as: Run as (with the backend login from Sign in for your app, so its data still
 *  loads), else the user from Sign in for your app, else nobody (anonymous). */
function workspaceIdentity() {
  const r = runAsNow();
  if (r.user) return { username: r.user, roles: r.roles.length ? r.roles : null, fusion: identity ? identity.fusion || null : null };
  return identity;
}
/** "as <user> <ROLE>", with a role from the app's own code when one was found. */
const asHint = () => 'as <user> ' + (knownRoles()[0] || '<ROLE>');
const whoIsIt = () => { const id = workspaceIdentity(); return !id || !id.username ? 'anonymous' : id.username + (id.roles ? ' (' + id.roles.join(', ') + ')' : ' (roles from its backend)'); };
// the app's window landed on its "You don't have access" page: noticed, said (console, its head, a notification)
let noAccessSeen = null;
function noticeNoAccess(url) {
  if (!/\/no-access(?:[/?#]|$)/.test(String(url))) return;
  noAccessSeen = { at: new Date().toISOString(), url: String(url), as: whoIsIt() };
  cpush('error', 'The app says "You don\'t have access" — it runs as ' + noAccessSeen.as + '. Choose who it runs as: Run as, in the Run console (or type: ' + asHint() + '); the app\'s window reloads.');
  try {
    const { Notification } = require('electron');
    if (Notification.isSupported()) {
      const n = new Notification({ title: 'The app says you don\'t have access', body: 'It runs as ' + noAccessSeen.as + '. Choose a user and a role in Build.Rite → Run console → Run as.' });
      n.on('click', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); } });
      n.show();
    }
  } catch (e) { /* no notifications here */ }
}
// The workspace's app served like the app itself (as a sandbox is), its requests shown in the Run console too
async function serveWorkspace(s) {
  const srv = await createDevServer(Object.assign(appOptions(s), {
    onLog: (l) => { pushLog(l); cpush(/FAILED|-> (4|5)\d\d/.test(String(l)) ? 'warn' : 'server', String(l).replace(/^\d\d:\d\d:\d\d /, '')); } }));
  cpush('info', 'the app\'s local server: ' + srv.url + ' (' + s.webApp + ')');
  return srv;
}
// ▶ Run (Build.Rite's top bar): your workspace's whole app, built from its working folder when its code changed, in a
// window of its own; Run again (after more changes) builds again and reloads that same window
let runWin = null;
function openRunWindow(url, title) {
  if (runWin && !runWin.isDestroyed()) {
    runWin.setTitle(String(title || 'Your app'));
    runWin.loadURL(url).catch(() => {});
    if (runWin.isMinimized()) runWin.restore();
    runWin.focus();
    return runWin;
  }
  runWin = openAppWindow(url, title);
  watchRunWindow(runWin);
  return runWin;
}
/** The Run window, into the Run console: the app's own console messages, where it went, a page that did not load. */
function watchRunWindow(w) {
  if (!w || w.isDestroyed() || w.__buildRiteWatched) return;
  w.__buildRiteWatched = true;
  const wc = w.webContents;
  wc.on('console-message', (e, level, message, line, sourceId) => {
    // (Electron: level 0–3 and the rest as arguments; newer: on the event, the level as a word)
    const lv = e && e.level != null ? e.level : level;
    const msg = e && typeof e.message === 'string' ? e.message : message;
    const src = String((e && e.sourceId) || sourceId || ''), ln = (e && e.lineNumber) || line || 0;
    cpush(lv === 3 || lv === 'error' ? 'error' : (lv === 2 || lv === 'warning' ? 'warn' : 'app'), String(msg) + (src ? '   (' + src.split('/').slice(-2).join('/') + (ln ? ':' + ln : '') + ')' : ''));
  });
  wc.on('did-navigate', (e, url) => { cpush('nav', 'opened ' + url); noticeNoAccess(url); });
  wc.on('did-navigate-in-page', (e, url) => { cpush('nav', '→ ' + String(url).replace(/^https?:\/\/[^/]+/, '')); noticeNoAccess(url); });
  wc.on('did-fail-load', (e, code, desc, url) => { if (code !== -3) cpush('error', 'could not load ' + url + ': ' + desc + ' (' + code + ')'); });
  wc.on('render-process-gone', (e, d) => cpush('error', 'the app\'s window stopped: ' + ((d && d.reason) || 'gone')));
  w.on('closed', () => { cpush('info', 'the app\'s window was closed'); if (runWin === w) runWin = null; });
}
function currentWork() { try { const x = vbsStoreInst && vbsStoreInst.work().current; return x && x.exists ? x : null; } catch (e) { return null; } }
let lastApp = '';
function runAppOf(c) { const apps = appsIn(projectOf(c)); return apps.indexOf(lastApp) !== -1 ? lastApp : apps[0]; }
const runTitle = (c, app) => 'Working copy — ' + c.projectName + ' ▸ ' + c.workspace + ' (' + app + ')';
/** Who the app runs as, the workspace, its build, its window: the Run console's head. */
function consoleStatus(full) {
  const c = currentWork();
  const st = c ? workPreview().status(projectOf(c), !full) : null;
  const id = workspaceIdentity(), ra = runAsNow();
  return { ok: true, signedInAs: id ? String(id.username || '') : '', roles: id && id.roles ? id.roles : null, by: ra.user ? 'run-as' : (identity ? 'sign-in' : ''),
    runAs: ra, knownRoles: knownRoles(), noAccess: noAccessSeen,
    workspace: c ? c.projectName + ' ▸ ' + c.workspace : '', working: c ? c.working : '', branch: c ? c.branch : '',
    built: !!(st && st.built), builtAt: st ? st.builtAt : '', fresh: st ? st.fresh : null, building: !!(st && st.building), window: runWin && !runWin.isDestroyed() ? runWin.webContents.getURL() : '' };
}
const noWorkspace = () => ({ ok: false, text: 'No workspace is set up: set one up first (Workspace, in the top bar).' });
// what each Run console command does (lib/runConsole.js parses them; nothing typed is run as a program)
const consoleDoes = {
  run: async (route) => {
    if (!route) { const r = await runWorkspaceApp({}); return r.ok ? { ok: true, text: '▶ ' + r.app + ' running in its window at ' + r.url + (r.built ? ' (built just now, ' + (Math.round(r.ms / 100) / 10) + ' s)' : '') } : { ok: false, text: r.error }; }
    const c = currentWork();
    if (!c) return noWorkspace();
    const app = runAppOf(c);
    const p = await buildWorkspace(c, app, 'run ' + route);
    if (!p.ok) return { ok: false, text: p.error };
    progStep({ key: 'open', state: 'done', text: 'opened ' + p.url + route });
    openRunWindow(p.url + route, runTitle(c, app));
    return { ok: true, text: '▶ opened ' + p.url + route };
  },
  build: async (force) => {
    const c = currentWork();
    if (!c) return noWorkspace();
    if (force) workPreview().forget(projectOf(c));
    cpush('info', (force ? 'rebuilding from scratch: ' : 'building (when its code changed): ') + c.working);
    const p = await buildWorkspace(c, runAppOf(c), force ? 'Rebuild' : 'Build');
    return p.ok ? { ok: true, text: p.built ? 'built in ' + (Math.round(p.ms / 100) / 10) + ' s' + (runWin && !runWin.isDestroyed() ? ' — reload (or run) to see it' : '') : 'up to date: no change since its last build' } : { ok: false, text: p.error };
  },
  reload: async () => { if (!runWin || runWin.isDestroyed()) return { ok: false, text: 'No app window: type run first.' }; runWin.webContents.reloadIgnoringCache(); return { ok: true, text: 'reloaded' }; },
  devtools: async () => { if (!runWin || runWin.isDestroyed()) return { ok: false, text: 'No app window: type run first.' }; runWin.webContents.openDevTools({ mode: 'detach' }); return { ok: true, text: 'the app window\'s developer tools are open (console, network, elements)' }; },
  stop: async () => { const c = currentWork(); if (runWin && !runWin.isDestroyed()) runWin.close(); runWin = null; if (c) workPreview().stop(path.resolve(projectOf(c))); return { ok: true, text: 'stopped: the app\'s window closed, its local server stopped' }; },
  git: async (sub, args) => {
    const c = currentWork();
    if (!c) return noWorkspace();
    const a = args || ['diff', '--stat', 'origin/' + c.branch];
    let out = null;
    try { out = require('child_process').execFileSync(commandPath('git') || 'git', ['-C', c.working].concat(a), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }); } catch (e) { return { ok: false, text: 'git ' + sub + ' failed: ' + String((e && (e.stderr || e.message)) || '').trim().slice(0, 300) }; }
    const ls = String(out).replace(/\s+$/, '').split('\n');
    return { ok: true, lines: ls.length && ls[0] ? ls.slice(0, 400) : ['(nothing)'] };
  },
  changes: async () => {
    const c = currentWork();
    if (!c) return noWorkspace();
    const ch = changedSinceVbs(c);
    if (ch == null) return { ok: false, text: 'git could not tell (is VB Studio\'s branch fetched? Get latest, in the project\'s tab)' };
    return { ok: true, lines: ch.length ? [ch.length + ' file' + (ch.length === 1 ? '' : 's') + ' changed since VB Studio (' + c.branch + '), in the working copy:'].concat(ch.map((f) => '  ' + f)) : ['no change since VB Studio (' + c.branch + ')'] };
  },
  signin: async () => { openSignIn(); return { ok: true, text: 'Sign in for your app is open: the user the app runs as and its backend login — then run (or reload) again.' }; },
  runAs: async (user, roles) => {
    if (user == null) { const ra = runAsNow(); return { ok: true, text: 'the app runs as ' + whoIsIt() + (ra.user ? ' (Run as)' : identity ? ' (Sign in for your app)' : ' — nobody chosen: type ' + asHint()) }; }
    const r = setRunAs(user, roles);
    if (!r.ok) return r;
    const reloaded = !!(runWin && !runWin.isDestroyed());
    if (reloaded) runWin.webContents.reloadIgnoringCache();
    return { ok: true, text: 'the app runs as ' + whoIsIt() + (r.runAs.user ? '' : ' (back to Sign in for your app)') + (reloaded ? ' — its window reloaded' : ' — run it to see') };
  },
  roles: async () => { const k = knownRoles(); return { ok: true, lines: k.length ? ['the roles in your app\'s code (answered here with Run as):'].concat(k.map((r) => '  ' + r)) : ['no role codes found in your app\'s code — Run as takes any role code: ' + asHint()] }; },
  code: async () => { const c = currentWork(); if (!c) return noWorkspace(); await shell.openExternal('vscode://file/' + String(c.working).replace(/\\/g, '/')); return { ok: true, text: 'opening ' + c.working + ' in VS Code (if it is installed)' }; },
  folder: async () => { const c = currentWork(); if (!c) return noWorkspace(); await shell.openPath(c.working); return { ok: true, text: 'opened ' + c.working }; },
  status: async () => {
    const s = consoleStatus(true);
    return { ok: true, lines: [
      'runs as:       ' + (s.signedInAs ? s.signedInAs + (s.roles ? ' (' + s.roles.join(', ') + ')' : ' (roles from Fusion)') + (s.by === 'run-as' ? ' — Run as' : ' — Sign in for your app') : 'nobody — the app runs anonymous: pages that need access stay hidden (type ' + asHint() + ')'),
      'workspace:     ' + (s.workspace || 'none set up'),
      'working copy:  ' + (s.working || '—') + (s.branch ? '  (VB Studio branch ' + s.branch + ')' : ''),
      'build:         ' + (s.building ? 'building…' : s.built ? 'built ' + s.builtAt + (s.fresh === false ? ' — the code changed since: build or run to see it' : ' — up to date') : 'not built yet (run builds it)'),
      'app window:    ' + (s.window || 'closed (type run)'),
    ] };
  },
};
/** The apps in a working folder (webApps/<app>/app-flow.json). */
function appsIn(folder) {
  try { return fs.readdirSync(path.join(folder, 'webApps')).filter((a) => fs.existsSync(path.join(folder, 'webApps', a, 'app-flow.json'))).sort(); } catch (e) { return []; }
}
async function runWorkspaceApp(b) {
  let c = null;
  try { const x = vbsStoreInst && vbsStoreInst.work().current; c = x && x.exists ? x : null; } catch (e) { c = null; }
  if (!c) return { ok: false, error: 'No workspace is set up: set one up first (Workspace, in the top bar).' };
  const apps = appsIn(projectOf(c));
  const want = String((b && b.app) || '');
  const appName = apps.indexOf(want) !== -1 ? want : runAppOf(c);
  if (appName) lastApp = appName;
  if (!appName) return { ok: false, error: 'Your working folder has no app in it (webApps/<app>/app-flow.json): ' + c.working };
  const t0 = Date.now();
  cpush('info', '▶ Run: ' + appName + ' of ' + c.projectName + ' ▸ ' + c.workspace + ' as ' + whoIsIt() + ' — building its working copy when its code changed…');
  noAccessSeen = null;
  const p = await buildWorkspace(c, appName, '▶ Run');
  if (!p.ok) { cpush('error', p.error); return { ok: false, error: p.error, app: appName, apps: apps }; }
  const url = p.url + '/';
  progStep({ key: 'open', state: 'done', text: 'opened ' + url });
  // what is in it: the working copy's files changed since VB Studio (its branch as last fetched), saved or not, committed
  // or not — so you know what you are looking at (and what you are not)
  const changed = changedSinceVbs(c);
  openRunWindow(url, 'Working copy — ' + c.projectName + ' ▸ ' + c.workspace + ' (' + appName + ')' + (changed ? ' · ' + changed.length + ' change' + (changed.length === 1 ? '' : 's') + ' since VB Studio' : ''));
  pushLog(`${new Date().toTimeString().slice(0, 8)} ▶ Run: ${appName} of ${c.workspace} at ${url}${p.built ? ' (built ' + Math.round((Date.now() - t0) / 100) / 10 + ' s)' : ''}`);
  const wid = workspaceIdentity();
  if (!wid || !wid.username) cpush('warn', 'the app runs anonymous: pages that need access stay hidden — choose who it runs as: Run as, in the Run console (or type: ' + asHint() + ')');
  else if (!wid.roles && !wid.fusion) cpush('warn', 'the app runs as ' + wid.username + ' with no roles: it will say "You don\'t have access" — give them a role: Run as, in the Run console');
  return { ok: true, url: url, app: appName, apps: apps, built: p.built, ms: Date.now() - t0, workspace: c.workspace, builtAt: p.builtAt,
    folder: c.working, branch: c.workBranch || 'buildrite-working', base: 'VB Studio (' + c.branch + ')', changed: changed,
    signedInAs: wid ? String(wid.username || '') : '', roles: wid && wid.roles ? wid.roles : null, noRoles: !!(wid && wid.username && !wid.roles && !wid.fusion) };
}
/** The working copy's files changed since VB Studio (origin/<its branch>), new ones too; null when git cannot tell. */
function changedSinceVbs(c) {
  const g = (args) => { try { return require('child_process').execFileSync(commandPath('git') || 'git', ['-C', c.working].concat(args), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000, windowsHide: true }); } catch (e) { return null; } };
  const diff = g(['diff', '--name-only', 'origin/' + c.branch, '--']);
  if (diff == null) return null;
  const fresh = g(['ls-files', '--others', '--exclude-standard']) || '';
  return diff.split('\n').concat(fresh.split('\n')).map((x) => x.trim()).filter((x, i, a) => x && a.indexOf(x) === i);
}
// The app as it is now (this PC's own build), for comparing with a sandbox.
const appUrlOf = () => ''; // (nothing of its own to compare a sandbox with: your workspace runs from its working folder)
// A window of its own for a sandbox (or the app as it is now, beside it): links inside its own address stay in it.
function openAppWindow(url, title) {
  const origin = new URL(url).origin;
  const [x, y] = win && !win.isDestroyed() ? win.getPosition() : [undefined, undefined];
  const w = new BrowserWindow({ width: 1440, height: 900, minWidth: 1024, minHeight: 640, x: x != null ? x + 64 : undefined, y: y != null ? y + 64 : undefined, title: String(title || 'Your app'),
    backgroundColor: '#f5f4f2', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true } });
  w.on('page-title-updated', (event) => event.preventDefault());
  w.webContents.setWindowOpenHandler(({ url: next }) => {
    if (String(next).indexOf(origin) === 0 || allowedNav(next)) return { action: 'allow' };
    if (/^(https?|mailto|ms-outlook|ms-settings):/i.test(next)) shell.openExternal(next);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (event, next) => {
    if (String(next).indexOf(origin) === 0 || allowedNav(next)) return;
    event.preventDefault();
    if (/^https?:/i.test(next)) shell.openExternal(next);
  });
  w.loadURL(url).catch(() => {});
  return w; // (truthy: opened)
}
async function capturePage(webApp, url, base) {
  if (!base) return { ok: false, error: NO_WORKSPACE };
  const srv = { url: base };
  const shotWin = new BrowserWindow({ width: 1440, height: 900, show: false, paintWhenInitiallyHidden: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  try {
    await shotWin.loadURL(String(base || srv.url).replace(/\/$/, '') + url);
    // settled: nothing busy, and the text on the page the same for two seconds in a row (at most 30 s)
    const deadline = Date.now() + 30000;
    let last = '', same = 0;
    while (Date.now() < deadline && same < 2) {
      await new Promise((r) => setTimeout(r, 1000));
      const sig = await shotWin.webContents.executeJavaScript(
        "(function(){var b=document.body;if(!b)return '';var busy=document.querySelector('oj-progress-circle,.oj-progress-circle,[aria-busy=\"true\"],.nx-loading');return (busy?'busy:':'')+b.innerText.length;})()", true).catch(() => '');
      same = sig && sig === last && sig.indexOf('busy:') !== 0 && Number(sig) > 40 ? same + 1 : 0;
      last = sig;
    }
    const img = await shotWin.webContents.capturePage();
    // where the page ended up: a page can send you elsewhere (a guard: a module turned off, a role it is not for)
    let landed = '';
    try {
      const want = new URL(String(base || srv.url).replace(/\/$/, '') + url).pathname.replace(/\/$/, '');
      const got = new URL(shotWin.webContents.getURL()).pathname.replace(/\/$/, '');
      if (got && got !== want) landed = got;
    } catch (e) { /* as asked */ }
    return { ok: true, base64: img.toJPEG(75).toString('base64'), mime: 'image/jpeg', landed: landed };
  } catch (e) {
    return { ok: false, error: 'Could not capture the page: ' + String((e && e.message) || e) };
  } finally {
    try { shotWin.destroy(); } catch (e) { /* closed */ }
  }
}
// The functional design (Analyze with AI → Create the functional design): its HTML printed to an A4 PDF by a hidden
// window (no script runs in it), page numbers in the footer
async function htmlToPdf(html) {
  const tmp = path.join(app.getPath('temp'), 'buildrite-design-' + process.pid + '-' + Date.now() + '.html');
  const w = new BrowserWindow({ width: 900, height: 1200, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  try {
    fs.writeFileSync(tmp, String(html || ''));
    await w.loadFile(tmp);
    return await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#6b7886;font-family:Arial,sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
  } finally {
    try { w.destroy(); } catch (e) { /* closed */ }
    try { fs.unlinkSync(tmp); } catch (e) { /* gone */ }
  }
}
// Saved AI analyses, for Analyze with AI: each run kept in this app's data folder (ai-analyses.json).
// The API tester (Application pages → a page → Integrations → Test): a page's REST calls and BI Publisher reports sent
// to the real backend through the local server's proxy; the values last used and the runs kept on this PC (lib/apiTest.js).
let apiStoreInst = null;
function apiStore() {
  // the calls of your workspace's pages: read from its working folder's services/ (else Build.Rite's own)
  if (!apiStoreInst) apiStoreInst = require('./lib/apiTest').open({ root: REPO_ROOT, rootFn: () => { const c = currentWorkspace(); return c ? projectOf(c) : ''; },
    bipFn: () => { const c = currentWorkspace(); const p = c ? profileOf(c.working) : null; return p && p.bip ? p.bip.endpoint : ''; }, file: path.join(app.getPath('userData'), 'api-tests.json'), log: (l) => { try { pushLog(l); } catch (e) { console.log(l); } } });
  return apiStoreInst;
}
// API Scenarios (lib/apiScenarios.js): a page's calls in order, run purely through the APIs (the API tester's engine,
// the app's login), every run kept — on this PC only (answers hold live data), per VB Studio project (its hashed space)
let scenarioStoreInst = null;
function scenarioStore() {
  if (!scenarioStoreInst) scenarioStoreInst = require('./lib/apiScenarios').open({ api: apiStore(),
    dir: () => { const c = currentWorkspace(); return c ? path.join(app.getPath('userData'), 'api-scenarios', spaceOf(c)) : ''; } });
  return scenarioStoreInst;
}
// Change requests (Application → Change requests, lib/changeRequests.js): kept per VB Studio project on this PC, beside
// the API scenarios; their Code Fix attempts are Code Fix's own (code-fixes.json, the change history)
let crStoreInst = null;
function crStore() {
  if (!crStoreInst) crStoreInst = require('./lib/changeRequests').open({ dir: () => { const c = currentWorkspace(); return c ? path.join(app.getPath('userData'), 'change-requests', spaceOf(c)) : ''; } });
  return crStoreInst;
}
// Saved flows (Application → Page Flows → Saved flows, lib/savedFlows.js): kept per VB Studio project on this PC
let flowStoreInst = null;
function flowStore() {
  if (!flowStoreInst) flowStoreInst = require('./lib/savedFlows').open({ dir: () => { const c = currentWorkspace(); return c ? path.join(app.getPath('userData'), 'saved-flows', spaceOf(c)) : ''; } });
  return flowStoreInst;
}
// The AI Assistant (lib/assistant.js): a question about the app's code, integrations or processes, answered from the
// workspace (its working folder, the pages' sheets, saved flows, the FDD library) by the AI set up for it; conversations
// kept on this PC per VB Studio project.
let assistantStoreInst = null;
async function assistantStore() {
  if (!assistantStoreInst) {
    const ps = await pagesStore();
    assistantStoreInst = require('./lib/assistant').open({
      dir: () => { const c = currentWorkspace(); return c ? path.join(app.getPath('userData'), 'assistant', spaceOf(c)) : ''; },
      root: () => (ps && ps.rootNow ? ps.rootNow() : ''), pages: ps, flows: flowStore(), fdd: await fddStore(), ai: await aiStore(), scan: require('./lib/integrations').scan });
  }
  return assistantStoreInst;
}
let analysisStoreInst = null;
function analysisStore() {
  if (!analysisStoreInst) analysisStoreInst = require('./lib/analyses').open({ file: path.join(app.getPath('userData'), 'ai-analyses.json') });
  return analysisStoreInst;
}
// Issues (Build.Rite): logged against a page, written up and analyzed by the AI (with the FDD), approved (in the app, and
// an approval email from Microsoft 365), then applied by the agent on a branch of its own with a pull request; Jira kept
// up to date (lib/issues.js). Shared with everyone on the data branch.
let issuesStoreInst = null;
async function issuesStore() {
  if (!issuesStoreInst) {
    issuesStoreInst = require('./lib/issues').open({
      file: path.join(app.getPath('userData'), 'issues.json'), ai: await aiStore(), fix: await fixStore(), mail: graphStore(), data: await dataBranch(), pages: await pagesStore(),
      jira: { auth: () => jiraStore().auth(), fetch: (url, init) => { const { net } = require('electron'); return net.fetch(url, init); } },
      fdd: require('./lib/issues').fddPicker(() => fddStoreInst, REPO_ROOT), gitPath: commandPath('git') || 'git', openWindow: openAppWindow,
      log: (l) => { try { pushLog(l); } catch (e) { console.log(l); } },
    });
  }
  return issuesStoreInst;
}
// Setup → Organizations & projects (Build.Rite): VB Studio organizations and their projects, the password encrypted by the
// OS keychain in this app's data folder; git and VB Studio's API reached from this PC (electron's net: the system's proxy).
let vbsStoreInst = null;
function vbsStore() {
  if (!vbsStoreInst) {
    vbsStoreInst = require('./lib/vbs').open({
      file: path.join(app.getPath('userData'), 'vbs-connections.json'),
      encrypt: canEncrypt() ? (t) => safeStorage.encryptString(t) : null,
      decrypt: canEncrypt() ? (b) => safeStorage.decryptString(b) : null,
      fetch: (url, init) => { const { net } = require('electron'); return net.fetch(url, init); },
      // Sync from VB Studio: when VB Studio refuses the saved sign-in for a call, the VB Studio window's own session (its
      // cookies, kept between runs) — the same calls, no window
      sessionFetch: (url, init) => session.fromPartition('persist:vbstudio').fetch(url, init),
      // …and VB Studio's internal calls (api2), which take only VB Studio's own page: made from inside it (a hidden window)
      pageFetch: (url, init) => vbsPageFetch(url, init),
      onSyncStep: (text) => pushLog(`${new Date().toTimeString().slice(0, 8)} Sync from VB Studio: ${String(text).slice(0, 300)}`),
      gitPath: commandPath('git') || 'git',
    });
  }
  return vbsStoreInst;
}
// Sync from VB Studio: VB Studio's internal calls (api2) answer only VB Studio's own page, so they are made from inside it —
// a hidden window signed in with the session kept from Open VB Studio (lib/vbsPage.js)
let vbsPageInst = null;
function vbsPageFetch(url, init) {
  if (!vbsPageInst) {
    vbsPageInst = require('./lib/vbsPage').create({ BrowserWindow: BrowserWindow, partition: 'persist:vbstudio', isHost: require('./lib/vbsLearn').isVbsHost,
      log: (t) => pushLog(`${new Date().toTimeString().slice(0, 8)} Sync from VB Studio: ${t}`) });
  }
  return vbsPageInst.fetch(url, init);
}
// Find in VB Studio (Setup → Organizations & projects): VB Studio in a window of its own — signed in there as usual (its
// own session, kept between runs) — and what its pages load read as they load (the window's DevTools network events):
// its organizations, projects (their Git addresses) and workspaces (lib/vbsLearn.js). Only VB Studio's own host, never a
// sign-in call; read, never changed. VB Studio has no documented API that lists them.
let vbsFinderWin = null;
async function openVbsFinder(url) {
  const store = vbsStore();
  let target = String(url || '').trim();
  if (!target) { const o = store.state().orgs[0]; target = o ? o.url : ''; }
  if (!/^https:\/\/[^/]+\.oraclecloud\.com\/[^/]+/i.test(target)) return { ok: false, error: 'Give the VB Studio address first (https://<host>/<organization>/): add the organization, or paste it here.' };
  // its log: live on the Setup screen and in this app's log — each address without its query (never a sign-in code)
  const bare = (u) => { try { const x = new URL(u); return x.origin + x.pathname + (x.hash ? x.hash.split('?')[0].slice(0, 80) : ''); } catch (e) { return String(u || '').split('?')[0].slice(0, 160); } };
  const say = (text) => { const line = String(text).slice(0, 400); try { store.finderLog(line); } catch (e) { /* no store */ } pushLog(`${new Date().toTimeString().slice(0, 8)} VB Studio window: ${line}`); };
  if (vbsFinderWin && !vbsFinderWin.isDestroyed()) {
    say('already open: going to ' + bare(target));
    vbsFinderWin.loadURL(target).catch((e) => say('could not load: ' + e.message));
    vbsFinderWin.show(); vbsFinderWin.focus();
    store.setFinder(true, target);
    return { ok: true, url: target, again: true };
  }
  store.setFinder(true, target, true);
  say('opening ' + bare(target));
  const L = require('./lib/vbsLearn');
  const learner = L.learner();
  const w = new BrowserWindow({ width: 1320, height: 900, show: true, backgroundColor: '#ffffff', title: 'VB Studio · opening…',
    webPreferences: { partition: 'persist:vbstudio', contextIsolation: true, sandbox: true, nodeIntegration: false } });
  vbsFinderWin = w;
  const wc = w.webContents;
  // a browser's own name: VB Studio and Oracle's sign-in may turn away one they do not know (Electron's, this app's)
  try { wc.setUserAgent(wc.getUserAgent().replace(/\s(Electron|build-?rite)\/\S+/gi, '')); } catch (e) { /* kept */ }
  const title = (t) => { try { if (!w.isDestroyed()) w.setTitle('VB Studio · ' + t + ' — Build.Rite reads its organizations, projects and workspaces as you browse'); } catch (e) { /* closed */ } };
  w.on('page-title-updated', (e, t) => { e.preventDefault(); title(t || 'VB Studio'); });
  // Oracle's sign-in may open a window of its own: allowed for Oracle's hosts only (same session); anything else in the browser
  wc.setWindowOpenHandler(({ url: next }) => {
    if (/^https:\/\/[^/]+\.(oraclecloud|oracle)\.com\//i.test(next)) { say('the page opened a window: ' + bare(next)); return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { partition: 'persist:vbstudio', contextIsolation: true, sandbox: true, nodeIntegration: false } } }; }
    if (/^https?:/i.test(next)) { say('opened in your browser: ' + bare(next)); shell.openExternal(next); }
    return { action: 'deny' };
  });
  // each step of the window, said: going to, redirected (Oracle's sign-in), the page and its HTTP status, loaded, failed
  const SIGNIN_HOST = /identity\.oraclecloud\.com|\/sso\/|signin|login\.|\/oauth2\//i;
  wc.on('did-start-loading', () => title('loading…'));
  // (newer Electron gives the details on the event, older as arguments: both read)
  const nav = (e, u, inPage, isMain) => ({ url: (e && e.url) || u || '', same: e && e.isSameDocument !== undefined ? e.isSameDocument : !!inPage, main: e && e.isMainFrame !== undefined ? e.isMainFrame : isMain !== false });
  wc.on('did-start-navigation', (e, u, inPage, isMain) => { const n = nav(e, u, inPage, isMain); if (n.main && !n.same && !/^data:/.test(n.url)) say('going to ' + bare(n.url)); });
  wc.on('did-redirect-navigation', (e, u, inPage, isMain) => { const n = nav(e, u, inPage, isMain); if (n.main) say('redirected to ' + bare(n.url) + (SIGNIN_HOST.test(n.url) ? '   (Oracle\'s sign-in: sign in here)' : '')); });
  wc.on('did-navigate', (e, u, code, status) => { if (!/^data:/.test(u)) say('page ' + bare(u) + ' — HTTP ' + code + (status ? ' ' + status : '')); });
  wc.on('did-finish-load', () => { const u = wc.getURL(); if (!/^data:/.test(u)) say('loaded: "' + (wc.getTitle() || 'no title') + '" — ' + bare(u)); });
  wc.on('did-fail-load', (e, code, desc, u, isMain) => {
    if (!isMain || code === -3) return; // -3: replaced by another navigation (a redirect), not a failure
    say('could not load ' + bare(u) + ': ' + desc + ' (' + code + ')');
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const html = '<!doctype html><meta charset="utf-8"><title>VB Studio did not open</title><body style="font:15px system-ui,Segoe UI,sans-serif;margin:48px;color:#16212c">'
      + '<h2 style="margin:0 0 12px">VB Studio did not open</h2><p><b>' + esc(desc) + '</b> (' + code + ')<br><code>' + esc(bare(u)) + '</code></p>'
      + '<p>Check that this PC can open that address in a browser (the network, a VPN or a proxy). Build.Rite\'s log (Setup → Organizations &amp; projects) shows each step.</p>'
      + '<p><a href="' + esc(target) + '" style="display:inline-block;padding:8px 14px;border-radius:8px;background:#0a66c9;color:#fff;text-decoration:none">Try again</a></p></body>';
    wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {});
  });
  wc.on('certificate-error', (e, u, err) => say('its certificate was refused: ' + bare(u) + ' — ' + err));
  wc.on('render-process-gone', (e, d) => say('the page stopped: ' + ((d && d.reason) || 'crashed')));
  wc.on('unresponsive', () => say('the page stopped responding'));
  let pageErrors = 0;
  wc.on('console-message', (e, level, message) => {
    const lvl = e && e.level !== undefined ? e.level : level;
    const msg = e && e.message !== undefined ? e.message : message;
    if ((lvl === 3 || lvl === 'error') && pageErrors < 12) { pageErrors++; say('page error: ' + String(msg || '').slice(0, 200)); }
  });
  // what its pages load: VB Studio's own JSON answers read (never a sign-in call, never another site); each one said
  const keepNow = () => { try { store.learn(Object.assign(learner.found(), { calls: learner.calls() })); } catch (e) { /* closed */ } };
  let flush = null;
  const keep = () => { if (flush) return; flush = setTimeout(() => { flush = null; keepNow(); }, 800); };
  const counts = () => { const f = learner.found(); return f.orgs.length + ' org · ' + f.projects.length + ' projects · ' + f.projects.reduce((n, p) => n + p.repos.length, 0) + ' repos · ' + f.workspaces.length + ' workspaces'; };
  const pending = {};
  const authOf = {}; // each call's way in (bearer, basic, or the session's cookies): its kind only, for Sync
  let skipped = 0, read = 0;
  const dbg = wc.debugger;
  try { dbg.attach('1.3'); say('watching its network: on'); } catch (e) { say('could not watch its network (' + e.message + '): it opens, but nothing can be read from it'); }
  dbg.on('detach', (e, reason) => say('stopped watching its network: ' + reason));
  dbg.on('message', async (event, method, params) => {
    if (method === 'Network.requestWillBeSent') {
      // the sign-in VB Studio's own pages send with their calls (a bearer token): kept in memory for Sync this run only —
      // never saved, logged or shown; VB Studio's own host only, never a sign-in call
      const q = params.request || {};
      let h = '';
      Object.keys(q.headers || {}).forEach((k) => { if (/^authorization$/i.test(k)) h = String(q.headers[k] || ''); });
      authOf[params.requestId] = /^Bearer\s/i.test(h) ? 'bearer' : /^Basic\s/i.test(h) ? 'basic' : 'session';
      try { const u = new URL(q.url); if (h && L.isVbsHost(u.hostname) && !L.SIGNIN.test(u.pathname + u.search)) store.windowSignIn(u.hostname, h); } catch (e) { /* not an address */ }
      return;
    }
    if (method === 'Network.responseReceived') {
      const r = params.response || {};
      if (params.type === 'Document') { if (learner.see({ url: r.url, status: r.status })) keep(); return; }
      if (/json/i.test(r.mimeType || '') || /\/rest\//.test(r.url || '')) pending[params.requestId] = { url: r.url, status: r.status };
    } else if (method === 'Network.loadingFinished' && pending[params.requestId]) {
      const p = pending[params.requestId];
      delete pending[params.requestId];
      let u;
      try { u = new URL(p.url); } catch (e) { return; }
      if (!L.isVbsHost(u.hostname) || L.SIGNIN.test(u.pathname + u.search)) { skipped++; return; } // never a sign-in call, never another site
      try {
        const b = await dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId });
        const text = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body;
        let json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        const auth = authOf[params.requestId] || '';
        delete authOf[params.requestId];
        if (json !== null && learner.see({ url: p.url, status: p.status, json: json, auth: auth })) { read++; say('read ' + u.pathname.replace(/^\/[^/]+/, '/<org>') + ' (HTTP ' + p.status + ') — found so far: ' + counts()); keep(); }
      } catch (e) { say('could not read ' + u.pathname + ': ' + e.message); }
    } else if (method === 'Network.loadingFailed' && pending[params.requestId]) {
      const p = pending[params.requestId];
      delete pending[params.requestId];
      say('a call failed: ' + bare(p.url) + ' — ' + (params.errorText || 'failed'));
    }
  });
  // the page loads at once; its network watched as soon as it is ready (never waited for longer than a moment)
  w.loadURL(target).catch((e) => say('could not load: ' + e.message));
  const on = await Promise.race([dbg.sendCommand('Network.enable').then(() => 'on', (e) => 'not on: ' + e.message), new Promise((r) => setTimeout(() => r('slow'), 2000))]).catch((e) => 'not on: ' + e.message);
  if (on !== 'on') say('reading its pages: ' + (on === 'slow' ? 'switching on (slowly)' : on));
  w.on('closed', () => { keepNow(); say('closed — read ' + read + ' answer(s) from VB Studio, skipped ' + skipped + ' (sign-in, other sites); found ' + counts()); store.setFinder(false, target); if (vbsFinderWin === w) vbsFinderWin = null; });
  return { ok: true, url: target };
}
// Code Fix (Application pages → a page → Code fix): the AI chosen in AI settings proposes a change to a page; it is
// written into the project's code only once approved (after git pull), then tested, committed or undone. The fixes are
// kept in this app's data folder; its screenshots before/after are taken in a hidden window, like the pages' own.
let fixStoreInst = null;
async function fixStore() {
  if (!fixStoreInst) {
    fixStoreInst = require('./lib/codeFix').open({
      root: REPO_ROOT, file: path.join(app.getPath('userData'), 'code-fixes.json'), ai: await aiStore(), capture: capturePage, buildDir: BUILD_DIR,
      // your workspace set up (Build.Rite's top bar): the code to fix is its working folder — changed and committed
      // there only (never pushed from Code fix); Apply to main, then Push, in its project's tab send it to VB Studio
      workFn: () => { const c = currentWorkspace(); return c ? { folder: c.working, label: c.projectName + ' ▸ ' + c.workspace, branch: c.workBranch || 'buildrite-working', key: spaceOf(c), name: c.projectName, ws: c.workspace } : null; },
      // sandboxes (Issues → Try it in a sandbox): built with this project's own build tool, served like the app itself
      buildTool: REPO_ROOT, serveSandbox: serveSandbox, appUrl: appUrlOf,
      data: await dataBranch(), log: (l) => { try { pushLog(l); } catch (e) { console.log(l); } }, // the change history, shared on the data branch
      gitPath: commandPath('git') || 'git',
      pickFolder: async (current) => {
        const r = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, { title: 'The project folder (the code to fix)', defaultPath: current, properties: ['openDirectory'] });
        return r.canceled ? '' : (r.filePaths[0] || '');
      },
    });
  }
  return fixStoreInst;
}
// Find a command for transcription (ffmpeg, whisper-cli), looking beyond the app's start-time PATH — in winget, Scoop,
// Chocolatey and Homebrew folders — so a tool just installed is found without restarting the app (lib/findCommand.js).
function commandPath(cmd) {
  return require('./lib/findCommand').find(cmd, {});
}
// Run a command for transcription (ffmpeg, whisper, winget, brew). Never rejects: resolves { code, errno, stdout, stderr,
// cmd }. On Windows some tools are launched through a shim/alias that Node cannot spawn directly ("spawn … EFTYPE" /
// EINVAL) — so a spawn-level failure is retried once through the shell, which runs those. errno is the spawn error code
// (a string) when there was one, so the caller can explain it.
const SPAWN_ERR = /^(ENOENT|EFTYPE|EINVAL|EACCES|EPERM|UNKNOWN)$/;
function runCommand(cmd, args) {
  const { execFile } = require('child_process');
  const opts = { maxBuffer: 64 * 1024 * 1024, windowsHide: true };
  const quote = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    const pack = (err, stdout, stderr) => ({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
      errno: err && typeof err.code === 'string' ? err.code : '', stdout: String(stdout || ''), stderr: String(stderr || (err && err.message) || ''), cmd });
    const viaShell = () => {
      try {
        execFile(quote(cmd) + ' ' + (args || []).map(quote).join(' '), Object.assign({ shell: true }, opts),
          (err, stdout, stderr) => done(pack(err, stdout, stderr)));
      } catch (e) { done(pack(e, '', '')); }
    };
    try {
      execFile(cmd, args || [], opts, (err, stdout, stderr) => {
        if (err && typeof err.code === 'string' && SPAWN_ERR.test(err.code)) { viaShell(); return; }
        done(pack(err, stdout, stderr));
      });
    } catch (e) {
      if (e && typeof e.code === 'string' && SPAWN_ERR.test(e.code)) { viaShell(); return; }
      done(pack(e, '', ''));
    }
  });
}
let recSource = '';
const REC_KEYS = { shot: 'CommandOrControl+Alt+S', stop: 'CommandOrControl+Alt+X' };
ipcMain.handle('rec:sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
  return sources.map((x) => ({ id: x.id, name: x.name, kind: x.id.startsWith('screen:') ? 'screen' : 'window',
    thumb: x.thumbnail && !x.thumbnail.isEmpty() ? x.thumbnail.toDataURL() : '' }));
});
ipcMain.handle('rec:use', (event, id) => { recSource = String(id || ''); return true; });
// While recording: a screenshot and Stop from anywhere (the test usually runs in another window or app).
ipcMain.handle('rec:state', (event, on) => {
  Object.values(REC_KEYS).forEach((k) => { if (globalShortcut.isRegistered(k)) globalShortcut.unregister(k); });
  if (on) {
    const sender = event.sender;
    Object.entries(REC_KEYS).forEach(([what, k]) => {
      globalShortcut.register(k, () => { if (!sender.isDestroyed()) sender.send('rec:key', what); });
    });
  }
  const mac = process.platform === 'darwin';
  return { shot: mac ? '⌘⌥S' : 'Ctrl+Alt+S', stop: mac ? '⌘⌥X' : 'Ctrl+Alt+X' };
});
ipcMain.handle('rec:window', (event, what) => {
  const w = BrowserWindow.fromWebContents(event.sender);
  if (!w || w.isDestroyed()) return false;
  if (what === 'minimize') w.minimize();
  else if (what === 'restore') { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
  return true;
});

/* ---------------------------------------------------------------------------
 * Windows, state
 * ------------------------------------------------------------------------- */

let win = null;
let signinWin = null;
let logWin = null;
let servicesWin = null;
let server = null; // Build.Rite's own local server
let quitting = false;
let identity = null; // your app's backend login (File → Sign in for your app…), for your workspace's app
let passwordThisRun = null; // when safeStorage cannot encrypt, the password lives here only
const serverLog = [];
const appUrl = () => (server ? server.url : '');
const allowedNav = (url) => (server && String(url).indexOf(server.url) === 0) || navAllowed(url, server ? server.url : '');

// When the app's own process is held (a long piece of work: nothing it serves can answer meanwhile, so a screen opening
// waits), the log says for how long — File → Backend calls… (Ctrl+Shift+L).
(function watchBusy() {
  let last = Date.now();
  const t = setInterval(() => {
    const now = Date.now();
    const held = now - last - 250;
    last = now;
    if (held > 500) { try { pushLog(new Date(now).toLocaleTimeString() + ' busy: the app was held for ' + held + ' ms (screens waited)'); } catch (e) { /* not yet */ } }
  }, 250);
  if (t.unref) t.unref();
}());
function pushLog(line) {
  serverLog.push(String(line));
  while (serverLog.length > 400) {
    serverLog.shift();
  }
}

const identityFile = () => path.join(app.getPath('userData'), 'local-identity.json');
const canEncrypt = () => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
};

/* ---------------------------------------------------------------------------
 * In-window pages shown before / instead of the app (never a blank window)
 * ------------------------------------------------------------------------- */

const SHELL_CSS = `
  :root { color-scheme: light dark; }
  body { margin: 0; height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: "Oracle Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f5f4f2; color: #161513; }
  @media (prefers-color-scheme: dark) { body { background: #1b1a18; color: #ebe9e5; } }
  .box { max-width: 560px; padding: 32px 36px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
  p { font-size: 14px; line-height: 1.5; margin: 6px 0; opacity: .85; }
  .spin { width: 28px; height: 28px; border: 3px solid rgba(127,127,127,.3); border-top-color: #c74634;
    border-radius: 50%; animation: s 0.9s linear infinite; margin-bottom: 20px; }
  @keyframes s { to { transform: rotate(360deg); } }
  pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.45;
    background: rgba(127,127,127,.12); padding: 12px 14px; border-radius: 8px; max-height: 240px; overflow: auto; }
`;

function escapeHtml(s) {
  return String(s).replace(/[<&>]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c]));
}

function dataUrl(html) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function loadingUrl() {
  return dataUrl(`<!doctype html><html><head><meta charset="utf-8"><style>${SHELL_CSS}</style></head>
    <body><div class="box"><div class="spin"></div>
    <h1>Starting ${APP_NAME}…</h1>
    <p>Bringing up the local server and loading the app.</p>
    <p style="opacity:.6">First start can take a moment while Oracle's CDN is contacted.</p>
    </div></body></html>`);
}

function problemUrl(title, detail) {
  const log = serverLog.slice(-20).join('\n');
  return dataUrl(`<!doctype html><html><head><meta charset="utf-8"><style>${SHELL_CSS}</style></head>
    <body><div class="box">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(detail)}</p>
    ${log ? `<p style="opacity:.6;margin-top:16px">Recent backend calls</p><pre>${escapeHtml(log)}</pre>` : ''}
    <p style="opacity:.6;margin-top:16px">View → Reload app to try again.</p>
    </div></body></html>`);
}

function loadSavedIdentity() {
  const saved = identityStore.load(identityFile());
  const id = identityStore.toServerIdentity(saved, passwordThisRun, canEncrypt() ? (b) => safeStorage.decryptString(b) : null);
  return saved && identityStore.usable(id, saved) ? id : null;
}


/*
 * Backend problems your workspace's app keeps quiet about: a refused backend call just leaves a list empty. Said once
 * per cause and run, with the way out (Sign in for your app…).
 */
const warned = new Set();
function backendProblem(p) {
  const key = p.kind === 'unreachable' ? `unreachable:${p.backend}` : `login:${p.kind}`;
  if (warned.has(key) || !win || win.isDestroyed() || (signinWin && !signinWin.isDestroyed())) return;
  warned.add(key);
  const what = p.report ? `The ${p.report} report` : `A ${p.backend} call`;
  const text = {
    'no-login': ['Your app\'s backend calls have no login',
      `${what} came back ${p.status}: your workspace's app runs without a backend login, so the calls VB Studio makes with its stored credential are refused. Sign in for your app (File menu) with a login that may make them.`],
    refused: ['The backend refused the login',
      `${what} came back ${p.status} with the login you entered. Check the username and password (File → Sign in for your app…).`],
    unreachable: [`Cannot reach ${p.backend}`,
      `This PC could not connect to ${p.host} (${p.error}). Lists and data from ${p.backend} stay empty until it can; check the network or VPN. View → Backend calls… lists each call.`],
  }[p.kind];
  if (!text) return;
  cpush('warn', text[0] + ': ' + text[1]);
  const signIn = p.kind !== 'unreachable';
  dialog.showMessageBox(win, { type: 'warning', title: APP_NAME, message: text[0], detail: text[1], buttons: signIn ? ['Sign in…', 'Later'] : ['OK'], defaultId: 0, cancelId: signIn ? 1 : 0, noLink: true })
    .then(({ response }) => { if (signIn && response === 0) openSignIn(); }).catch(() => {});
}

/* ---------------------------------------------------------------------------
 * Sign in for your app: who your workspace's app runs as and its backend login
 * ------------------------------------------------------------------------- */

/** File → Forget the app's sign-in: the saved user and backend password gone. */
function signOut() {
  identityStore.remove(identityFile());
  identity = null;
  passwordThisRun = null;
  warned.clear();
  pushLog(`${new Date().toTimeString().slice(0, 8)} the app's sign-in forgotten`);
  cpush('info', 'the app\'s sign-in is forgotten: it runs as ' + whoIsIt());
}

function openSignIn() {
  if (signinWin && !signinWin.isDestroyed()) { signinWin.focus(); return; }
  signinWin = new BrowserWindow({
    parent: win || undefined, modal: !!win, width: 660, height: 860, resizable: false, minimizable: false,
    title: 'Sign in for your app', backgroundColor: '#f5f4f2', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'signin-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  signinWin.setMenu(null);
  signinWin.once('ready-to-show', () => signinWin.show());
  signinWin.on('closed', () => { signinWin = null; });
  signinWin.loadFile(path.join(__dirname, 'signin.html'));
}
const fromSignin = (event) => !!signinWin && !signinWin.isDestroyed() && event.sender === signinWin.webContents;
ipcMain.handle('signin:initial', (event) => {
  if (!fromSignin(event)) return null;
  const saved = identityStore.load(identityFile()) || {};
  return {
    username: saved.username || '', fusionUser: saved.fusionUser || '', hasPassword: !!saved.fusionPassword || !!passwordThisRun,
    rolesFrom: saved.rolesFrom || 'fusion', roles: saved.roles || [], knownRoles: knownRoles(),
  };
});
ipcMain.handle('signin:submit', (event, form) => {
  if (!fromSignin(event)) return { error: 'not allowed' };
  const previous = identityStore.load(identityFile());
  const checked = identityStore.validate(Object.assign({}, form, { version: 'build' }), previous);
  if (checked.error) return { error: checked.error };
  const encrypt = canEncrypt() ? (s) => safeStorage.encryptString(s) : null;
  if (checked.password && !encrypt) passwordThisRun = checked.password;
  else if (checked.password || !checked.keepsPassword) passwordThisRun = null;
  const saved = identityStore.save(identityFile(), checked.saved, checked.password, encrypt, previous);
  identity = identityStore.toServerIdentity(saved, passwordThisRun, encrypt ? (b) => safeStorage.decryptString(b) : null);
  warned.clear();
  pushLog(`${new Date().toTimeString().slice(0, 8)} the app runs as ${saved.username}; roles ${identity.roles ? identity.roles.join(', ') : 'from its backend'}`);
  cpush('info', 'signed in for your app: it runs as ' + whoIsIt() + ' — run (or reload) it to see');
  if (signinWin) signinWin.close();
  if (runWin && !runWin.isDestroyed()) runWin.webContents.reloadIgnoringCache();
  return { ok: true };
});
ipcMain.handle('signin:cancel', (event) => {
  if (fromSignin(event) && signinWin) signinWin.close();
  return true;
});

/* ---------------------------------------------------------------------------
 * Your settings from another folder (File → Import settings from another folder…): connections, keys (encrypted for
 * your Windows account, so they open on the same PC and user), minutes, follow-ups, issues — copied, never moved.
 * ------------------------------------------------------------------------- */

const SETTINGS_FILES = ['vbs-connections.json', 'jira-connection.json', 'ai-settings.json', 'sql-connections.json', 'graph.json',
  'minutes.duckdb', 'followups.duckdb', 'issues.json', 'code-fixes.json', 'ai-analyses.json', 'api-tests.json', 'run-as.json', 'local-identity.json'];
async function importSettings() {
  const r = await dialog.showOpenDialog(win || undefined, { title: 'The folder your settings are in (another desktop app\'s data folder)', defaultPath: app.getPath('appData'), properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return;
  const from = r.filePaths[0];
  if (path.resolve(from) === path.resolve(app.getPath('userData'))) { dialog.showMessageBox(win, { type: 'info', message: 'That is Build.Rite\'s own data folder.' }); return; }
  const there = SETTINGS_FILES.filter((f) => fs.existsSync(path.join(from, f)));
  if (!there.length) { dialog.showMessageBox(win, { type: 'info', message: 'No settings in that folder', detail: 'Build.Rite looks for: ' + SETTINGS_FILES.join(', ') }); return; }
  const ok = await dialog.showMessageBox(win, { type: 'question', buttons: ['Copy and restart', 'Cancel'], defaultId: 0, cancelId: 1, message: 'Copy ' + there.length + ' file(s) into Build.Rite?',
    detail: there.join('\n') + (process.platform === 'win32' && fs.existsSync(path.join(from, 'Local State')) ? '\nLocal State (the key the saved tokens and passwords are encrypted with)' : '')
      + '\n\nWhat Build.Rite has of the same name is replaced (a copy of it is kept as .before-import). Build.Rite restarts to read them.' });
  if (ok.response !== 0) return;
  copySettings(from, there);
}
/** Copies those files into Build.Rite's data folder (what it had of the same name kept as .before-import), then restarts.
 *  On Windows the saved keys and passwords are encrypted with a key kept in the app's own data folder (Local State,
 *  itself protected by your Windows account): it comes along, so they open in Build.Rite too. Chromium holds that file
 *  while Build.Rite runs, so a small helper copies it once Build.Rite has closed, then starts Build.Rite again. */
function copySettings(from, there) {
  const to = app.getPath('userData');
  fs.mkdirSync(to, { recursive: true });
  there.forEach((f) => {
    const dst = path.join(to, f);
    try { if (fs.existsSync(dst)) fs.copyFileSync(dst, dst + '.before-import'); fs.copyFileSync(path.join(from, f), dst); } catch (e) { pushLog('import ' + f + ': ' + e.message); }
  });
  const key = path.join(from, 'Local State');
  const withKey = process.platform === 'win32' && fs.existsSync(key);
  pushLog(`${new Date().toTimeString().slice(0, 8)} settings imported from ${from}: ${there.join(', ')}${withKey ? ', Local State (once Build.Rite has closed)' : ''}`);
  quitting = true;
  if (withKey) {
    const helper = "const fs=require('fs'),cp=require('child_process');const a=process.argv.slice(1);const src=a[0],dst=a[1],pid=+a[2],exe=a[3],args=a.slice(4);"
      + "const alive=()=>{try{process.kill(pid,0);return true}catch(e){return false}};"
      + "(function wait(n){if(alive()&&n<150)return setTimeout(()=>wait(n+1),200);"
      + "try{if(fs.existsSync(dst))fs.copyFileSync(dst,dst+'.before-import');fs.copyFileSync(src,dst)}catch(e){}"
      + "const env=Object.assign({},process.env);delete env.ELECTRON_RUN_AS_NODE;cp.spawn(exe,args,{detached:true,stdio:'ignore',env:env}).unref()})(0);";
    try {
      require('child_process').spawn(process.execPath, ['-e', helper, key, path.join(to, 'Local State'), String(process.pid), process.execPath].concat(process.argv.slice(1)),
        { env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }), detached: true, stdio: 'ignore', windowsHide: true }).unref();
      app.exit(0);
      return;
    } catch (e) { pushLog('import Local State: ' + e.message); }
  }
  app.relaunch();
  app.exit(0);
}
/** The settings files a folder holds. */
const settingsIn = (dir) => SETTINGS_FILES.filter((f) => { try { return fs.statSync(path.join(dir, f)).isFile(); } catch (e) { return false; } });
/**
 * First start, with no settings of its own yet: another desktop app's data folder on this PC holding settings Build.Rite
 * uses (at least two of its files — connections, keys, minutes…) is offered, the one holding most first. Asked once:
 * Not now is remembered; File → Import settings from another folder… does it any time.
 */
async function offerImport() {
  const mine = app.getPath('userData');
  const asked = path.join(mine, 'import-offered.json');
  if (settingsIn(mine).filter((f) => f !== 'run-as.json').length || fs.existsSync(asked)) return;
  let found = [];
  try {
    const root = app.getPath('appData');
    found = fs.readdirSync(root).map((n) => path.join(root, n)).filter((d) => path.resolve(d) !== path.resolve(mine))
      .map((d) => ({ dir: d, files: settingsIn(d) })).filter((x) => x.files.length >= 2).sort((a, b) => b.files.length - a.files.length);
  } catch (e) { found = []; }
  if (!found.length || !win || win.isDestroyed()) return;
  const f = found[0];
  const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Bring them in', 'Choose another folder…', 'Not now'], defaultId: 0, cancelId: 2, noLink: true,
    title: APP_NAME, message: 'Bring in your settings from ' + path.basename(f.dir) + '?',
    detail: 'Another desktop app on this PC keeps settings Build.Rite uses, in ' + f.dir + ':\n' + f.files.join(', ')
      + '\n\nThey are copied, never moved: that app keeps working. Keys and passwords stay encrypted for your account. Build.Rite restarts to read them.' });
  try { fs.mkdirSync(mine, { recursive: true }); fs.writeFileSync(asked, JSON.stringify({ at: new Date().toISOString(), from: f.dir, answer: ['import', 'choose', 'later'][r.response] })); } catch (e) { /* asked again next time */ }
  if (r.response === 0) copySettings(f.dir, f.files);
  else if (r.response === 1) await importSettings();
}

function showLog() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Backend calls</title><style>
    :root { color-scheme: light dark; } body { margin: 0; font: 12px/1.5 ui-monospace, Consolas, monospace; background: #f5f4f2; color: #161513; }
    @media (prefers-color-scheme: dark) { body { background: #1b1a18; color: #ebe9e5; } }
    header { padding: 12px 16px; font: 600 14px system-ui, "Segoe UI", sans-serif; }
    pre { margin: 0; padding: 0 16px 16px; white-space: pre-wrap; word-break: break-word; }
    </style></head><body><header>Backend calls through the local server (newest last; View → Backend calls… again to refresh)</header>
    <pre>${escapeHtml(serverLog.join('\n') || 'No calls yet.')}</pre></body></html>`;
  if (!logWin || logWin.isDestroyed()) {
    logWin = new BrowserWindow({ width: 980, height: 620, title: 'Backend calls', autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    logWin.setMenu(null);
    logWin.on('closed', () => {
      logWin = null;
    });
  }
  logWin.loadURL(dataUrl(html)).then(() => logWin && logWin.webContents.executeJavaScript('window.scrollTo(0, document.body.scrollHeight)')).catch(() => {});
  logWin.focus();
}


/* View → Web services…: every endpoint of your workspace's app, with a GET tester (lib/catalog.js, web-services.html),
 * served by its local server while it runs. */
function showWebServices() {
  const u = runWin && !runWin.isDestroyed() ? new URL(runWin.webContents.getURL()).origin : '';
  if (!u) { dialog.showMessageBox(win, { type: 'info', message: 'Run your workspace\'s app first', detail: 'Web services lists the service connections of the app that is running (▶ Run, in the top bar).' }); return; }
  if (!servicesWin || servicesWin.isDestroyed()) {
    servicesWin = new BrowserWindow({ width: 1180, height: 820, title: 'Web services', autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    servicesWin.setMenu(null);
    servicesWin.on('closed', () => { servicesWin = null; });
  }
  servicesWin.loadURL(u + '/__services/').catch(() => {});
  servicesWin.focus();
}

/* ---------------------------------------------------------------------------
 * The splash: the logo plays while Build.Rite starts (splash.html), then the box opens out into the app
 * ------------------------------------------------------------------------- */

let splash = null;
let splashAt = 0; // when it showed
let splashEnding = false;
let splashDone = false;
const SPLASH_MIN_MS = 7000; // Build.Rite, the flip to Write.Rite (done at 6 s), a moment to read it
const SPLASH_MAX_MS = 18000; // the app shows by then, whatever it is still doing
const SPLASH_OUT_MS = 1150; // the box opening out
function createSplash() {
  if (process.env.BUILDRITE_NO_SPLASH === '1') { splashDone = true; return; }
  splash = new BrowserWindow({ width: 680, height: 440, frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    show: false, center: true, hasShadow: false, skipTaskbar: false, title: APP_NAME, backgroundColor: '#00000000',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  splash.webContents.on('will-navigate', (event) => event.preventDefault());
  splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  splash.once('ready-to-show', () => { if (splash && !splash.isDestroyed()) { splash.show(); splashAt = Date.now(); } });
  // closed by hand (Alt+F4): the app shows at once
  splash.on('closed', () => { splash = null; if (!splashDone) { splashDone = true; showMainWindow(); } });
  splash.loadFile(path.join(__dirname, 'splash.html')).catch(() => endSplash(true));
  setTimeout(() => endSplash(true), SPLASH_MAX_MS);
}
function showMainWindow() {
  if (win && !win.isDestroyed() && !win.isVisible()) { win.show(); win.focus(); }
}
/** The app is ready (or could not start): once the logo has played, the box opens out and the main window takes over. */
function endSplash(now) {
  if (splashDone || splashEnding) return;
  if (!splash || splash.isDestroyed()) { splashDone = true; showMainWindow(); return; }
  splashEnding = true;
  const wait = now ? 0 : Math.max(0, SPLASH_MIN_MS - (Date.now() - (splashAt || Date.now())));
  setTimeout(() => {
    const s = splash;
    if (!s || s.isDestroyed()) { splashDone = true; showMainWindow(); return; }
    s.webContents.executeJavaScript("document.documentElement.classList.add('out')").catch(() => {});
    setTimeout(() => {
      splashDone = true;
      showMainWindow();
      setTimeout(() => { try { if (!s.isDestroyed()) s.destroy(); } catch (e) { /* closed */ } }, 200);
    }, SPLASH_OUT_MS);
  }, wait);
}

/* ---------------------------------------------------------------------------
 * The window
 * ------------------------------------------------------------------------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 640, title: `${APP_NAME} ${app.getVersion()}`, backgroundColor: '#f5f4f2', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  // shown now, or by the splash once the app has loaded (endSplash)
  win.once('ready-to-show', () => { if (!splash || splashDone) win.show(); });
  win.on('page-title-updated', (event) => event.preventDefault());
  // A page that never paints must not leave the app invisible (with the splash: SPLASH_MAX_MS).
  setTimeout(() => { if (win && !win.isDestroyed() && !win.isVisible() && (!splash || splashDone)) win.show(); }, 6000);
  // Links to other sites open in the default browser; Build.Rite itself and Oracle's hosts stay in the window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedNav(url)) return { action: 'allow' };
    if (/^(https?|mailto|ms-outlook|ms-settings|vscode):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (allowedNav(url)) return;
    event.preventDefault();
    if (/^(https?|mailto|ms-outlook|ms-settings|vscode):/i.test(url)) shell.openExternal(url);
  });
  win.webContents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
    // code -3 is an aborted load (e.g. the splash being replaced); ignore it.
    if (isMainFrame && code !== -3 && server && String(failedUrl).indexOf(server.url) === 0) win.loadURL(problemUrl('Build.Rite did not load', `${description} (${code})`));
  });
  win.on('closed', () => { win = null; });
  win.loadURL(loadingUrl());
}

function appMenu() {
  const isMac = process.platform === 'darwin';
  return Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Sign in for your app…', accelerator: 'CmdOrCtrl+Shift+S', click: () => openSignIn() },
        { label: 'Forget the app\'s sign-in', click: () => signOut() },
        { type: 'separator' },
        { label: 'Import settings from another folder…', click: () => importSettings().catch((e) => pushLog('import: ' + e.message)) },
        { label: 'Open Build.Rite\'s data folder', click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { label: 'Quit', accelerator: 'Ctrl+Q', click: () => { quitting = true; app.quit(); } },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reload Build.Rite', accelerator: 'CmdOrCtrl+R', click: () => { if (win && server) win.loadURL(appUrl()); } },
        { role: 'forceReload' },
        { label: 'Web services of your app…', accelerator: 'CmdOrCtrl+Shift+W', click: () => showWebServices() },
        { label: 'Backend calls…', accelerator: 'CmdOrCtrl+Shift+L', click: () => showLog() },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }, { role: 'toggleDevTools' },
      ],
    },
  ]);
}

/* ---------------------------------------------------------------------------
 * Start
 * ------------------------------------------------------------------------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(async () => {
    // Record (a Jira story's panel): the page asks for the screen (getDisplayMedia); this answers with the screen or window
    // the person picked in the page (rec:use), else the main screen. Only pages on this PC are answered (lib/localOrigin.js).
    const localOnly = require('./lib/localOrigin').isLocal;
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      const from = String((request.frame && request.frame.url) || request.securityOrigin || '');
      if (!localOnly(from)) { callback({}); return; }
      desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
        const pick = sources.find((x) => x.id === recSource) || sources.find((x) => x.id.startsWith('screen:'));
        callback(pick ? { video: pick } : {});
      }).catch(() => callback({}));
    });
    // Record (screen capture) and Record my voice (microphone) ask the session for permission: granted to pages on
    // this PC, refused to any other origin.
    session.defaultSession.setPermissionRequestHandler((wc, permission, done) => {
      done(localOnly(wc && !wc.isDestroyed() ? wc.getURL() : ''));
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => localOnly(origin || (wc && !wc.isDestroyed() ? wc.getURL() : '')));
    Menu.setApplicationMenu(appMenu());
    createSplash();
    createWindow();
    identity = loadSavedIdentity();
    if (!isBuilt(BUILD_DIR, WEB_APP)) {
      win.loadURL(problemUrl('Build.Rite is not built yet', 'Build it once with Oracle\'s VB build tool: npm run build (or start with npm run desktop:fresh, which builds first).'));
      endSplash(true);
      return;
    }
    try {
      server = await createDevServer(Object.assign(await buildRiteOptions(), { buildDir: BUILD_DIR, webApp: WEB_APP, port: PORT }));
    } catch (e) {
      if (win && !win.isDestroyed()) win.loadURL(problemUrl('Could not start Build.Rite\'s local server', String((e && e.message) || e)));
      endSplash(true);
      return;
    }
    pushLog(`${new Date().toTimeString().slice(0, 8)} Build.Rite at ${server.url}; you are ${me().displayName}`);
    // the app loaded: the splash finishes its logo, opens out, and the window shows
    win.loadURL(appUrl()).then(() => endSplash(), () => endSplash());
    // first start: settings of another desktop app on this PC offered (connections, keys, minutes…)
    setTimeout(() => { offerImport().catch((e) => pushLog('import offer: ' + e.message)); }, 2500);
  });
  app.on('activate', () => {
    if (!win) { createWindow(); if (server) win.loadURL(appUrl()).catch(() => {}); }
  });
  app.on('before-quit', () => {
    if (sqlConnStore) sqlConnStore.close().catch(() => {});
    quitting = true;
    if (server) server.close();
    try { if (workPreviewInst) workPreviewInst.stop(); } catch (e) { /* stopped */ }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || quitting) app.quit();
  });
}
// Record: shortcuts released and open recordings closed as they are (what was written stays playable).
app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch (e) { /* not registered */ }
  if (evidenceStoreInst) evidenceStoreInst.closeAll();
});

// Record, with its technical trace (lib/testTrace.js): while a traced recording runs, every Build.Rite window's console
// errors and warnings, crashes and page changes go on its timeline (the web service calls come from lib/devserver.js).
app.on('web-contents-created', (event, wc) => {
  const TT = require('./lib/testTrace');
  const tracing = () => !!(evidenceStoreInst && evidenceStoreInst.tracing());
  const add = (entry) => { try { if (entry && tracing()) evidenceStoreInst.traceAdd(entry); } catch (e) { /* the trace is best effort */ } };
  wc.on('console-message', (...args) => { if (tracing()) add(TT.consoleEntry(args, wc.isDestroyed() ? '' : wc.getURL())); });
  wc.on('did-navigate', (e, url) => { if (tracing()) add(TT.pageEntry(url)); });
  wc.on('did-navigate-in-page', (e, url, isMainFrame) => { if (isMainFrame && tracing()) add(TT.pageEntry(url)); });
  wc.on('render-process-gone', (e, details) => add({ kind: 'console', t: Date.now(), level: 'error', message: 'The page stopped: ' + ((details && details.reason) || 'crashed'), source: '', line: 0, page: '' }));
  wc.on('unresponsive', () => add({ kind: 'console', t: Date.now(), level: 'warning', message: 'The page stopped responding.', source: '', line: 0, page: '' }));
});
