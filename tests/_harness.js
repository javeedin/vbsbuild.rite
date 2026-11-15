/*
 * Shared test harness: assertions (check, eq, section, report — a suite exits non-zero on a failure) and the paths the
 * suites read: Build.Rite's own app (webApps/buildrite) and the sample VB app the engines are tried on
 * (tests/fixtures/vb-sample: a made-up "shop" app with its service connections).
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'webApps', 'buildrite');
const FIXTURE = path.join(__dirname, 'fixtures', 'vb-sample');
const SERVICES = path.join(FIXTURE, 'services');

// ── assertions ───────────────────────────────────────────────────────

function makeAsserter() {
  const state = { pass: 0, fail: 0, failures: [] };

  function check(name, cond, detail) {
    if (cond) { state.pass++; console.log('  ok   ' + name); }
    else {
      state.fail++;
      state.failures.push(name + (detail ? ' - ' + detail : ''));
      console.log('  FAIL ' + name + (detail ? ' - ' + detail : ''));
    }
  }
  function eq(name, actual, expected) {
    check(name, actual === expected,
      'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
  function section(t) { console.log('\n=== ' + t + ' ==='); }

  function report() {
    console.log('\n' + '='.repeat(60));
    console.log('passed: ' + state.pass + '   failed: ' + state.fail);
    if (state.failures.length) {
      console.log('\nFAILURES:');
      state.failures.forEach(f => console.log('  - ' + f));
    }
    // Set the code and let node drain stdout rather than process.exit(): a
    // hard exit while stdout is a redirected pipe tears the socket down
    // mid-flush and trips a libuv assertion on Windows (exit 127 with every
    // test passing).
    process.exitCode = state.fail ? 1 : 0;
  }

  return { check, eq, section, report, state };
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

module.exports = { ROOT, APP, FIXTURE, SERVICES, makeAsserter, readJson };
