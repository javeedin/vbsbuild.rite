'use strict';
/**
 * Oracle's VB build tool for each app, in the version the app asks for. Each VB application is on its own Visual Builder
 * version (visual-application.json "source.version") and names its build tool in its own package.json
 * (@oracle/grunt-vb-build, a tarball on Oracle's CDN). Build.Rite builds an app with that version: its own copy when it
 * is the same, else one installed once into a shared cache (one folder per version), used by every app on that version.
 *
 *   open({ own, cache, npm?, run?, log? }) → {
 *     choose(profile)  → { ok, dir, version, ready, why, install?: { version, url, dir } }
 *                        dir: the folder to run grunt in (its node_modules hold grunt and the build tool)
 *     ensure(profile)  → choose(), then install what is missing → { ok, dir, version, installed?, error? }
 *     versionIn(dir)   → the build tool version installed in a folder, '' if none
 *   }
 *   own:   Build.Rite's own folder (its node_modules has a build tool); cache: where other versions go
 *   run:   (cmd, args, { cwd }) → Promise<{ code, stdout, stderr }> — how npm is run (the desktop app's runCommand)
 *
 * Which one: the version the app's package.json names; else, with none named, Build.Rite's own when it is not older than
 * the app's Visual Builder version (a newer build tool builds an older app; an older one refuses a newer app).
 */
const fs = require('fs');
const path = require('path');

const TOOL = '@oracle/grunt-vb-build';
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
const major = (v) => { const m = /^(\d{4})/.exec(String(v || '')); return m ? Number(m[1]) : 0; };
const safeVersion = (v) => /^\d+\.\d+\.\d+$/.test(String(v || ''));
const urlFor = (v) => 'https://static.oracle.com/cdn/vb/tools/npm/grunt-vb-build/grunt-vb-build-' + v + '.tar.gz';

function versionIn(dir) {
  const j = readJson(path.join(dir, 'node_modules', '@oracle', 'grunt-vb-build', 'package.json'));
  return j && j.version ? String(j.version) : '';
}
const hasGrunt = (dir) => isFile(path.join(dir, 'node_modules', 'grunt', 'bin', 'grunt'));

function open(o) {
  const opt = o || {};
  const own = path.resolve(opt.own || path.join(__dirname, '..', '..'));
  const cache = path.resolve(opt.cache || path.join(require('os').homedir(), '.buildrite', 'build-tools'));
  const log = typeof opt.log === 'function' ? opt.log : () => {};
  const pending = {};

  function choose(profile) {
    const p = profile || {};
    const want = (p.buildTool && p.buildTool.version) || '';
    const source = (p.vb && p.vb.source) || (p.buildTool && p.buildTool.source) || '';
    const ownV = versionIn(own);
    if (want) {
      if (!safeVersion(want)) return { ok: false, why: 'Not a build tool version: ' + want };
      if (ownV === want && hasGrunt(own)) return { ok: true, dir: own, version: want, ready: true, why: 'the app\'s build tool ' + want + ' (Build.Rite\'s own)' };
      const dir = path.join(cache, 'grunt-vb-build-' + want);
      const ready = versionIn(dir) === want && hasGrunt(dir);
      return { ok: true, dir, version: want, ready, why: 'the app\'s build tool ' + want + (ready ? '' : ' — not installed yet'),
        install: ready ? undefined : { version: want, url: (p.buildTool && p.buildTool.url) || urlFor(want), dir } };
    }
    if (!ownV || !hasGrunt(own)) return { ok: false, why: 'Build.Rite\'s build tool is not installed: run npm install in ' + own + '.' };
    if (source && major(ownV) < major(source)) {
      return { ok: false, why: 'This app is Visual Builder ' + source + ' and names no build tool in its package.json; Build.Rite\'s is ' + ownV + ', which is older. Add ' + TOOL + ' (' + major(source) + '.x) to the app\'s package.json, as VB Studio does.' };
    }
    return { ok: true, dir: own, version: ownV, ready: true, why: 'Build.Rite\'s build tool ' + ownV + (source ? ' (the app is Visual Builder ' + source + ')' : '') };
  }

  /** Installs one version into its cache folder: a package.json naming it (and grunt), a Gruntfile, then npm install. */
  async function install(x) {
    if (typeof opt.run !== 'function') return { ok: false, error: 'Build.Rite cannot run npm here to install build tool ' + x.version + '.' };
    fs.mkdirSync(x.dir, { recursive: true });
    const ownPkg = readJson(path.join(own, 'package.json')) || {};
    const dev = Object.assign({}, ownPkg.devDependencies);
    const pkg = { name: 'buildrite-build-tool-' + x.version.replace(/\./g, '-'), private: true, description: 'Oracle\'s VB build tool ' + x.version + ', for the apps on it (Build.Rite)',
      devDependencies: { [TOOL]: x.url, grunt: dev.grunt || '^1.0.3', 'grunt-cli': dev['grunt-cli'] || '^1.3.2', 'load-grunt-tasks': dev['load-grunt-tasks'] || '^4.0.0' } };
    fs.writeFileSync(path.join(x.dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    fs.writeFileSync(path.join(x.dir, 'Gruntfile.js'), "'use strict';\n// Oracle's VB build tool's tasks (Build.Rite runs vb-clean vb-process-local here for the apps on this version)\nmodule.exports = (grunt) => { require('load-grunt-tasks')(grunt); };\n");
    log('installing Oracle\'s VB build tool ' + x.version + ' (once, for every app on it): ' + x.dir);
    const r = await opt.run(opt.npm || 'npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: x.dir });
    if (!r || r.code !== 0 || versionIn(x.dir) !== x.version) {
      const why = String((r && (r.stderr || r.stdout)) || '').trim().split('\n').slice(-4).join(' ').slice(0, 400);
      return { ok: false, error: 'Build tool ' + x.version + ' could not be installed' + (why ? ': ' + why : '') + ' (from ' + x.url + ')' };
    }
    log('Oracle\'s VB build tool ' + x.version + ' installed');
    return { ok: true };
  }

  async function ensure(profile) {
    const c = choose(profile);
    if (!c.ok || c.ready) return Object.assign({}, c);
    const k = c.install.dir;
    if (!pending[k]) pending[k] = install(c.install).finally(() => { delete pending[k]; });
    const r = await pending[k];
    return r.ok ? { ok: true, dir: c.dir, version: c.version, ready: true, installed: true, why: c.why.replace(' — not installed yet', '') } : { ok: false, dir: c.dir, version: c.version, error: r.error, why: c.why };
  }

  return { choose, ensure, versionIn, cache, own };
}

module.exports = { open, versionIn, urlFor, major };
