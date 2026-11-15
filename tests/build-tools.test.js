#!/usr/bin/env node
'use strict';
/**
 * Oracle's VB build tool in the version each app asks for (desktop/lib/buildTools.js):
 *   - the app names Build.Rite's own version: Build.Rite's copy; another version: one installed once into the cache
 *     (a package.json naming it, a Gruntfile, npm install) and then used by every app on that version
 *   - two asks at once: one install; a failed install said, with npm's words; tried again next time
 *   - an app naming no build tool: Build.Rite's own when it is not older than the app's Visual Builder version, else
 *     refused with what to do
 * npm is a stand-in here (it writes what npm would); the real install is checked by hand against Oracle's CDN.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const B = require('../desktop/lib/buildTools');

const T = H.makeAsserter();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'br-tools-'));
// a folder holding a build tool of a version (what npm install leaves): grunt and @oracle/grunt-vb-build
const plant = (dir, version) => {
  fs.mkdirSync(path.join(dir, 'node_modules', 'grunt', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'grunt', 'bin', 'grunt'), '// grunt\n');
  fs.mkdirSync(path.join(dir, 'node_modules', '@oracle', 'grunt-vb-build'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', '@oracle', 'grunt-vb-build', 'package.json'), JSON.stringify({ name: '@oracle/grunt-vb-build', version }));
};

(async () => {
  try {
    const own = path.join(tmp, 'buildrite');
    plant(own, '2701.0.3');
    fs.writeFileSync(path.join(own, 'package.json'), JSON.stringify({ devDependencies: { grunt: '^1.0.3', 'load-grunt-tasks': '^4.0.0' } }));
    const cache = path.join(tmp, 'cache');
    const runs = [];
    let fail = false;
    const run = async (cmd, args, o) => {
      runs.push({ cmd, args, cwd: o.cwd, pkg: JSON.parse(fs.readFileSync(path.join(o.cwd, 'package.json'), 'utf8')) });
      await new Promise((r) => setTimeout(r, 30));
      if (fail) return { code: 1, stdout: '', stderr: 'npm error 404 Not Found - GET https://static.oracle.com/…/grunt-vb-build-9999.0.0.tar.gz' };
      plant(o.cwd, /grunt-vb-build-(\d+\.\d+\.\d+)/.exec(runs[runs.length - 1].pkg.devDependencies['@oracle/grunt-vb-build'])[1]);
      return { code: 0, stdout: 'added 300 packages', stderr: '' };
    };
    const t = B.open({ own, cache, run, npm: 'npm' });

    T.section('the version the app names');
    const same = t.choose({ buildTool: { version: '2701.0.3' }, vb: { source: '2701' } });
    T.check('Build.Rite\'s own version: its own copy, ready', same.ok && same.ready && same.dir === own && same.version === '2701.0.3', JSON.stringify(same));
    const other = t.choose({ buildTool: { version: '2510.0.2', url: '' }, vb: { source: '2510' } });
    T.check('another version: a folder of its own in the cache, to install from Oracle\'s CDN', other.ok && !other.ready && other.dir === path.join(cache, 'grunt-vb-build-2510.0.2')
      && /grunt-vb-build-2510\.0\.2\.tar\.gz$/.test(other.install.url), JSON.stringify(other));
    const both = await Promise.all([t.ensure({ buildTool: { version: '2510.0.2' } }), t.ensure({ buildTool: { version: '2510.0.2' } })]);
    T.check('…installed once for two asks at once (npm install in its folder, naming that version)', both[0].ok && both[1].ok && runs.length === 1 && runs[0].cwd === other.dir
      && runs[0].args[0] === 'install' && /2510\.0\.2/.test(runs[0].pkg.devDependencies['@oracle/grunt-vb-build']) && !!runs[0].pkg.devDependencies['load-grunt-tasks'], JSON.stringify(runs));
    T.check('…with a Gruntfile that loads the build tool\'s tasks', /load-grunt-tasks/.test(fs.readFileSync(path.join(other.dir, 'Gruntfile.js'), 'utf8')));
    const again = await t.ensure({ buildTool: { version: '2510.0.2' } });
    T.check('…then used as it is (no second install)', again.ok && again.ready && !again.installed && runs.length === 1 && t.versionIn(other.dir) === '2510.0.2');
    const url = 'https://static.oracle.com/cdn/vb/tools/npm/grunt-vb-build/grunt-vb-build-2601.0.3.tar.gz';
    await t.ensure({ buildTool: { version: '2601.0.3', url } });
    T.check('the address the app\'s package.json names is the one installed', runs.length === 2 && runs[1].pkg.devDependencies['@oracle/grunt-vb-build'] === url);

    T.section('a failed install');
    fail = true;
    const bad = await t.ensure({ buildTool: { version: '9999.0.0' } });
    T.check('said, with npm\'s words and the address', !bad.ok && /could not be installed: npm error 404/.test(bad.error) && /9999\.0\.0\.tar\.gz/.test(bad.error), bad.error);
    fail = false;
    const retry = await t.ensure({ buildTool: { version: '9999.0.0' } });
    T.check('…tried again next time', retry.ok && retry.installed);
    T.check('not a version: refused, nothing run', !t.choose({ buildTool: { version: '1.2' } }).ok || t.choose({ buildTool: { version: '1.2' } }).ok === false);

    T.section('an app naming no build tool');
    const older = t.choose({ buildTool: { version: '' }, vb: { source: '2510' } });
    T.check('an older Visual Builder version: Build.Rite\'s own (a newer build tool builds it)', older.ok && older.dir === own, JSON.stringify(older));
    const newer = t.choose({ buildTool: { version: '' }, vb: { source: '2801' } });
    T.check('a newer one: refused, saying to name the build tool in its package.json', !newer.ok && /2801/.test(newer.why) && /package\.json/.test(newer.why), newer.why);
    const none = B.open({ own: path.join(tmp, 'empty'), cache, run }).choose({ buildTool: {}, vb: {} });
    T.check('Build.Rite\'s own not installed: said', !none.ok && /npm install/.test(none.why));
    T.check('urlFor: Oracle\'s CDN address of a version', B.urlFor('2701.0.3') === 'https://static.oracle.com/cdn/vb/tools/npm/grunt-vb-build/grunt-vb-build-2701.0.3.tar.gz');
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  T.report();
})();
