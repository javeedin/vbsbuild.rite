#!/usr/bin/env node
'use strict';
/**
 * What Build.Rite knows about a VB app (desktop/lib/appProfile.js): read from the app's own files, never assumed. Every
 * VB application is different, so each variant of the sample app (tests/fixtures/vb-sample) is read as it is:
 *   - as it comes: its apps, Visual Builder version, service connections and how they sign in (one login per VB
 *     credential), its BI Publisher report call, its roles and their report, its Component Exchange components
 *   - the project in a subfolder of the repo; the service connections inside the app (webApps/<app>/services)
 *   - its services named otherwise (no "fusion" or "bipService"): the same logins and report call, found by what they are
 *   - another Visual Builder version naming its build tool; an App UI extension; a folder with no VB project
 *   - kept until a file it reads changes; read again on asking (fresh)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const P = require('../desktop/lib/appProfile');

const T = H.makeAsserter();
const SAMPLE = path.join(__dirname, 'fixtures', 'vb-sample');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, j) => fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'br-profile-'));
const copy = (name) => { const d = path.join(tmp, name); fs.cpSync(SAMPLE, d, { recursive: true }); return d; };
try {
  T.section('the sample app, as it comes');
  const p = P.profileOf(SAMPLE);
  T.check('a Visual Builder application at the folder itself', p.ok && p.kind === 'app' && p.root === path.resolve(SAMPLE), JSON.stringify([p.kind, p.root]));
  T.check('…its apps and its Visual Builder version (visual-application.json)', p.apps.map((a) => a.name).join() === 'shop' && p.vb.source === readJson(path.join(SAMPLE, 'visual-application.json'))['source.version']);
  const names = p.services.backends.map((b) => b.name).sort().join();
  T.check('…its backends, each with how it signs in', names === 'bipService,fusion,shop' && p.services.backends.filter((b) => b.usesLogin).map((b) => b.name).sort().join() === 'bipService,fusion'
    && p.services.backends.find((b) => b.name === 'shop').auth === 'none', JSON.stringify(p.services.backends.map((b) => [b.name, b.auth])));
  T.check('…the logins it needs: one per VB credential (the backends sharing it together)', p.logins.length === 1 && p.logins[0].backends.slice().sort().join() === 'bipService,fusion', JSON.stringify(p.logins));
  T.check('…its BI Publisher report call, found by what it is', !!p.bip && p.bip.endpoint === 'bipService/runBIPReport', JSON.stringify(p.bip));
  T.check('…its roles and the report they are read from (its own code)', p.roles.codes.indexOf('SHOP_ADMIN') !== -1 && /\.xdo$/.test(p.roles.report), JSON.stringify(p.roles));
  T.check('…what to know, in plain words', p.notes.some((n) => /Visual Builder/.test(n.text)) && p.notes.some((n) => /login/.test(n.text)));
  T.check('…no secret in it: the VB credential is a reference, never a password', !/password/i.test(JSON.stringify(p.services)));

  T.section('a repo with the project in a subfolder');
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  fs.cpSync(SAMPLE, path.join(repo, 'vb'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'README.md'), 'a repo\n');
  const ps = P.profileOf(repo);
  T.check('the project found one level down; said so', ps.kind === 'app' && ps.root === path.join(repo, 'vb') && ps.notes.some((n) => /subfolder: vb/.test(n.text)), JSON.stringify([ps.root, ps.notes.map((n) => n.text)]));
  T.check('…findRoot: the folder itself, else the shallowest below', P.findRoot(repo) === path.join(repo, 'vb') && P.findRoot(SAMPLE) === path.resolve(SAMPLE));

  T.section('service connections inside the app');
  const inApp = copy('in-app');
  fs.mkdirSync(path.join(inApp, 'webApps', 'shop', 'services'), { recursive: true });
  fs.readdirSync(path.join(inApp, 'services')).forEach((n) => fs.renameSync(path.join(inApp, 'services', n), path.join(inApp, 'webApps', 'shop', 'services', n)));
  fs.rmdirSync(path.join(inApp, 'services'));
  const pa = P.profileOf(inApp);
  T.check('its catalog read from the app; its backends and connections found there', pa.services.catalogs.length === 1 && pa.services.catalogs[0].level === 'shop'
    && pa.services.backends.length === 3 && pa.services.backends.every((b) => b.level === 'shop') && pa.services.connections.every((c) => c.level === 'shop'), JSON.stringify(pa.services.catalogs));
  T.check('…the logins and the report call found the same', pa.logins.length === 1 && pa.bip && pa.bip.service === 'bipService');
  T.check('…said so', pa.notes.some((n) => /inside the app/.test(n.text)));

  T.section('its services named otherwise (no "fusion", no "bipService")');
  const renamed = copy('renamed');
  const catFile = path.join(renamed, 'services', 'catalog.json');
  const cat = readJson(catFile);
  cat.backends.Fusion_PWP = cat.backends.fusion; delete cat.backends.fusion;
  cat.backends.callPWPBIP = cat.backends.bipService; delete cat.backends.bipService;
  writeJson(catFile, cat);
  fs.renameSync(path.join(renamed, 'services', 'bipService'), path.join(renamed, 'services', 'reportsBip'));
  const bipFile = path.join(renamed, 'services', 'reportsBip', 'openapi3.json');
  const bj = readJson(bipFile);
  bj.servers = [{ url: 'vb-catalog://backends/callPWPBIP' }];
  writeJson(bipFile, bj);
  const pr = P.profileOf(renamed);
  T.check('the same login, by its VB credential: Fusion_PWP + callPWPBIP', pr.logins.length === 1 && pr.logins[0].backends.slice().sort().join() === 'Fusion_PWP,callPWPBIP', JSON.stringify(pr.logins));
  T.check('…the report call found by what it is (reportsBip, calling callPWPBIP)', pr.bip && pr.bip.service === 'reportsBip' && pr.services.connections.find((c) => c.name === 'reportsBip').backend === 'callPWPBIP', JSON.stringify(pr.bip));

  T.section('another Visual Builder version, an extension, no project');
  const v2510 = copy('v2510');
  const va = readJson(path.join(v2510, 'visual-application.json'));
  va['source.version'] = '2510';
  writeJson(path.join(v2510, 'visual-application.json'), va);
  writeJson(path.join(v2510, 'package.json'), { name: 'shop', private: true, devDependencies: { '@oracle/grunt-vb-build': 'https://static.oracle.com/cdn/vb/tools/npm/grunt-vb-build/grunt-vb-build-2510.0.2.tar.gz' } });
  const pv = P.profileOf(v2510);
  T.check('its version and the build tool it names (its package.json)', pv.vb.source === '2510' && pv.buildTool.version === '2510.0.2' && /2510\.0\.2\.tar\.gz$/.test(pv.buildTool.url), JSON.stringify(pv.buildTool));
  T.check('…a version written plainly is read too', P.buildToolOf(v2510).version === '2510.0.2');
  const ext = path.join(tmp, 'ext');
  fs.mkdirSync(path.join(ext, 'ui', 'self'), { recursive: true });
  fs.writeFileSync(path.join(ext, 'extension.json'), '{}');
  const pe = P.profileOf(ext);
  T.check('an App UI extension: known for what it is, said it runs inside Oracle Cloud Applications', pe.ok && pe.kind === 'extension' && pe.notes.some((n) => /inside them/.test(n.text)));
  const none = path.join(tmp, 'none');
  fs.mkdirSync(none);
  const pn = P.profileOf(none);
  T.check('no VB project: said, nothing made up', pn.ok && pn.kind === 'none' && !pn.apps.length && pn.notes.some((n) => /No Visual Builder project/.test(n.text)));
  T.check('…no folder at all: said', P.profileOf(path.join(tmp, 'nowhere')).ok === false);

  T.section('kept, and read again when a file changes or on asking');
  const kept = P.profileOf(renamed);
  T.check('the same answer while nothing changed', kept === P.profileOf(renamed));
  cat.backends.extra = { servers: [{ url: 'https://extra.example.com', 'x-vb': { anonymousAccess: true } }] };
  writeJson(catFile, cat);
  const fresh1 = P.profileOf(renamed);
  T.check('a changed catalog: read again', fresh1 !== kept && fresh1.services.backends.some((b) => b.name === 'extra'));
  T.check('…fresh on asking (Scan again)', P.profileOf(renamed, { fresh: true }) !== fresh1);
} catch (e) {
  T.check('no exception: ' + (e && e.stack), false);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
T.report();
