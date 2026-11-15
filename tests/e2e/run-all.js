/*
 * Runs every tests/e2e/*.e2e.js in sequence and reports one summary. They drive Build.Rite's built screens in Chromium
 * (Playwright), so build first: npm run build.
 *
 * Run:  node tests/e2e/run-all.js        (or: npm run test:e2e)
 * Exit: 0 = every suite passed, 1 = at least one failed
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const suites = fs.readdirSync(__dirname).filter((f) => f.endsWith('.e2e.js')).sort();
if (!fs.existsSync(path.join(__dirname, '..', '..', 'build', 'processed', 'webApps', 'buildrite'))) {
  console.log('Build.Rite is not built: npm run build, then run this again.');
  process.exitCode = 1;
  return;
}
const results = [];
for (const s of suites) {
  process.stdout.write('\n' + '#'.repeat(62) + '\n# ' + s + '\n' + '#'.repeat(62) + '\n');
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit', timeout: 15 * 60 * 1000 });
  results.push({ suite: s, code: r.status });
}
console.log('\n' + '='.repeat(62));
console.log('E2E SUITE SUMMARY');
console.log('='.repeat(62));
let bad = 0;
for (const r of results) {
  const ok = r.code === 0;
  if (!ok) bad++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + r.suite);
}
console.log('\n' + (bad ? bad + ' of ' + results.length + ' suite(s) failing' : 'all ' + results.length + ' suites passed'));
process.exitCode = bad ? 1 : 0;
