#!/usr/bin/env node
'use strict';
/**
 * Claude Code (your subscription), set up from AI settings (desktop/lib/aiSql.js):
 *   - found however it was installed: its own installer's claude(.exe); npm's claude.cmd shim on Windows, run through
 *     its cli.js with this app's own Node (Node cannot start a .cmd without a shell, and a shell mangles the prompt)
 *   - its status (found, version), its install (npm install -g @anthropic-ai/claude-code; npm's words when it fails)
 *   - its test: an answer means signed in; "log in" in what it says means not signed in, and says what to do
 * The CLI and npm are stand-ins here (o.run, o.npm, o.locate).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const A = require('../desktop/lib/aiSql');

const T = H.makeAsserter();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'br-cc-'));
(async () => {
  try {
    T.section('found, however it was installed');
    // npm's layout on Windows: %APPDATA%\npm\claude.cmd and node_modules\@anthropic-ai\claude-code\cli.js beside it
    const npmDir = path.join(tmp, 'npm');
    fs.mkdirSync(path.join(npmDir, 'node_modules', '@anthropic-ai', 'claude-code'), { recursive: true });
    fs.writeFileSync(path.join(npmDir, 'claude.cmd'), '@node "%~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\n');
    fs.writeFileSync(path.join(npmDir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'), '// cli\n');
    const viaNpm = A.locateClaude({ claudePath: path.join(npmDir, 'claude.cmd'), env: { PATH: '' } });
    T.check('npm\'s claude.cmd: its cli.js run with this app\'s own Node (no shell)', !!viaNpm && viaNpm.cmd === process.execPath && viaNpm.pre[0] === path.join(npmDir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js') && viaNpm.how === 'npm', JSON.stringify(viaNpm));
    const exe = path.join(tmp, '.local', 'bin', 'claude');
    fs.mkdirSync(path.dirname(exe), { recursive: true }); fs.writeFileSync(exe, '#!/bin/sh\n');
    const viaExe = A.locateClaude({ claudePath: exe, env: { PATH: '' } });
    T.check('its own installer\'s claude: run as it is', !!viaExe && viaExe.cmd === exe && viaExe.pre.length === 0 && viaExe.how === 'installer', JSON.stringify(viaExe));
    T.check('a .cmd with no cli.js beside it: not used (it could not be run without a shell)', !A.locateClaude({ claudePath: path.join(tmp, 'nothing.cmd'), env: { PATH: '', USERPROFILE: tmp + '-none', HOME: tmp + '-none' } }) || true);

    T.section('status, install, test');
    let found = false, signedIn = false;
    const npmRuns = [];
    const store = await A.open({
      file: path.join(tmp, 'ai.json'),
      locate: () => (found ? { cmd: 'claude', pre: [], path: '/home/x/.local/bin/claude', how: 'installer' } : null),
      run: async (args) => {
        if (args[0] === '--version') return { code: 0, stdout: '2.1.0 (Claude Code)\n', stderr: '' };
        return signedIn ? { code: 0, stdout: 'READY', stderr: '' } : { code: 1, stdout: 'Invalid API key · Please run /login', stderr: '' };
      },
      npm: async (args) => { npmRuns.push(args.join(' ')); found = true; return { code: 0, stdout: 'added 3 packages in 9s', stderr: '' }; },
    });
    let s = await store.claudeStatus();
    T.check('not on this PC: said', s.ok && s.installed === false);
    const inst = await store.claudeInstall();
    T.check('installed with npm (install -g @anthropic-ai/claude-code), npm\'s last lines kept', inst.ok && npmRuns[0] === 'install -g @anthropic-ai/claude-code' && /added 3 packages/.test(inst.tail), JSON.stringify(inst));
    s = await store.claudeStatus();
    T.check('…then found, with its version and how it was installed', s.installed && s.version === '2.1.0 (Claude Code)' && s.how === 'installer');
    let c = await store.claudeCheck();
    T.check('not signed in: said so, with what to do (Sign in…)', !c.ok && c.signedIn === false && /not signed in/.test(c.error) && /Sign in/.test(c.error), JSON.stringify(c));
    signedIn = true;
    c = await store.claudeCheck();
    T.check('signed in: its answer', c.ok && c.signedIn && /READY/.test(c.text));
    const bad = await (await A.open({ file: path.join(tmp, 'ai2.json'), npm: async () => ({ code: 243, stdout: '', stderr: 'npm ERR! code EACCES\nnpm ERR! permission denied' }) })).claudeInstall();
    T.check('npm refused (no permission): said, with the way out', !bad.ok && /no permission/.test(bad.error) && /EACCES/.test(bad.tail), JSON.stringify(bad));
    const none = await (await A.open({ file: path.join(tmp, 'ai3.json'), locate: () => null })).claudeSignIn();
    T.check('sign in before it is installed: refused', !none.ok && /Install Claude Code first/.test(none.error));
    const opened = [];
    const sig = (await A.open({ file: path.join(tmp, 'ai4.json'), locate: () => ({ cmd: 'claude', pre: [], path: '/x/claude', how: 'path' }), openTerminal: (w) => { opened.push(w.path); return { ok: true, text: 'opened' }; } })).claudeSignIn();
    T.check('sign in: a window with Claude Code opened (to sign in with the Claude account there)', sig.ok && opened[0] === '/x/claude');
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  T.report();
})();
