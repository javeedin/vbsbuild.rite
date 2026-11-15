#!/usr/bin/env node
'use strict';
/**
 * AI settings: Claude Code on your subscription or an API key, for everything or per feature (desktop/lib/aiSql.js):
 *   - the first AI set up becomes the default for everything; another set up later does not take it over unless asked
 *   - a feature may have its own (Code fix on Claude Code, Issues on an API key…); '' = the default again
 *   - each ask goes to its feature's AI: Claude Code runs the CLI (no key), an API key calls the API with that key
 *   - only an AI set up may be chosen; forgetting one clears the features that used it; settings never carry a key
 * The CLI and the API are stand-ins here (o.run, o.fetch).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const A = require('../desktop/lib/aiSql');

const T = H.makeAsserter();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'br-ai-'));
(async () => {
  try {
    const cli = [], api = [];
    const store = await A.open({
      file: path.join(tmp, 'ai-settings.json'),
      encrypt: (t) => Buffer.from('enc:' + t), decrypt: (b) => String(b).replace(/^enc:/, ''),
      run: async (args) => { cli.push(args.join(' ')); return { code: 0, stdout: 'Claude Code answered', stderr: '' }; },
      fetch: async (url, init) => { api.push({ url, key: (init.headers || {})['x-api-key'] || '' }); return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: 'the API answered' }] }), json: async () => ({ content: [{ type: 'text', text: 'the API answered' }] }) }; },
    });

    T.section('set up: Claude Code (subscription) and an API key');
    store.save({ provider: 'claudecode', model: '' });
    let s = store.settings();
    T.check('the first AI set up: the default for everything; ready (no key needed)', s.active === 'claudecode' && s.providers.claudecode.ready, JSON.stringify([s.active, s.providers.claudecode]));
    store.save({ provider: 'anthropic', key: 'sk-test-123', model: 'claude-test-model', makeDefault: false });
    s = store.settings();
    T.check('…an API key set up later: ready, the default kept (makeDefault: false)', s.active === 'claudecode' && s.providers.anthropic.ready && s.providers.anthropic.model === 'claude-test-model');
    T.check('…the features listed, each on the default', s.features.map((f) => f.id).join() === 'codefix,issues,analysis,pages,minutes,sql' && Object.values(s.uses).every((u) => u === ''));
    T.check('…no key ever in the settings', JSON.stringify(s).indexOf('sk-test-123') === -1);

    T.section('each feature asks its own AI');
    let r = await store.chat({ feature: 'codefix', system: 's', user: 'u' });
    T.check('Code fix on the default (Claude Code): the CLI, no API call', r.ok && r.provider === 'Claude Code (your subscription)' && cli.length === 1 && api.length === 0, JSON.stringify(r));
    store.setUse({ feature: 'issues', provider: 'anthropic' });
    r = await store.chat({ feature: 'issues', system: 's', user: 'u' });
    T.check('Issues on the API key: the API, with that key', r.ok && /Anthropic/.test(r.provider) && api.length === 1 && api[0].key === 'sk-test-123' && /api\.anthropic\.com/.test(api[0].url), JSON.stringify([r, api]));
    r = await store.chat({ feature: 'codefix', system: 's', user: 'u' });
    T.check('…Code fix still on Claude Code', r.provider === 'Claude Code (your subscription)' && cli.length === 2);
    store.setDefault('anthropic');
    store.setUse({ feature: 'codefix', provider: 'claudecode' });
    T.check('the default changed to the API key; Code fix kept on Claude Code by its own choice', store.providerFor('codefix') === 'claudecode' && store.providerFor('minutes') === 'anthropic' && store.providerFor('issues') === 'anthropic');
    store.setUse({ feature: 'codefix', provider: '' });
    T.check('…back to the default ("")', store.providerFor('codefix') === 'anthropic' && store.settings().uses.codefix === '');

    T.section('what is refused, what is cleared');
    let err = '';
    try { store.setUse({ feature: 'codefix', provider: 'openai' }); } catch (e) { err = e.message; }
    T.check('an AI not set up: refused', /Set up ChatGPT/.test(err), err);
    err = '';
    try { store.setUse({ feature: 'nothing', provider: '' }); } catch (e) { err = e.message; }
    T.check('…a feature not here: refused', /Not a feature/.test(err));
    store.setUse({ feature: 'sql', provider: 'claudecode' });
    store.forget('claudecode');
    s = store.settings();
    T.check('forgetting an AI: the features that used it go back to the default', s.uses.sql === '' && !s.providers.claudecode.ready && store.providerFor('sql') === 'anthropic');
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  T.report();
})();
