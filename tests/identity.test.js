#!/usr/bin/env node
'use strict';
/**
 * Sign in for your app (desktop/lib/identity.js) + the proxy's loginFor (desktop/lib/devserver.js): the Fusion login and
 * the extra per-backend logins (e.g. OIC/ics — a backend that signs in with its OWN VBCS credential, not the Fusion one).
 * Checks the extra logins are validated, stored encrypted, read back into the logins map, kept when left blank, and that
 * loginFor picks a backend's own login (by name or credential id) before falling back to the Fusion login.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const ID = require('../desktop/lib/identity');
const DS = require('../desktop/lib/devserver');

const T = H.makeAsserter();

// A reversible stand-in for Electron safeStorage, so this runs under plain node.
const encrypt = (s) => Buffer.from('E|' + s, 'utf8');
const decrypt = (b) => { const s = b.toString('utf8'); return s.startsWith('E|') ? s.slice(2) : s; };
const file = path.join(os.tmpdir(), `br-identity-${process.pid}-${Date.now()}.json`);

// --- validate ---
const base = { username: 'jane.doe', rolesFrom: 'pick', roles: ['X'], fusionUser: 'jane.doe', fusionPassword: 'fp' };

const vNone = ID.validate(base, null);
T.check('fusion-only sign-in still valid, no extra logins', !vNone.error && Array.isArray(vNone.logins) && vNone.logins.length === 0 && Array.isArray(vNone.saved.backendLogins) && vNone.saved.backendLogins.length === 0);

const vOic = ID.validate(Object.assign({}, base, { logins: [{ key: 'ics', user: 'OIC_USER', password: 'secret' }] }), null);
T.check('an OIC login is accepted: saved carries key+user (never the password)', !vOic.error
  && vOic.saved.backendLogins.length === 1 && vOic.saved.backendLogins[0].key === 'ics' && vOic.saved.backendLogins[0].user === 'OIC_USER'
  && vOic.saved.backendLogins[0].password === undefined
  && vOic.logins[0].password === 'secret' && vOic.logins[0].keep === false);

T.check('a login row with no backend name is refused', !!ID.validate(Object.assign({}, base, { logins: [{ key: '', user: 'u', password: 'p' }] }), null).error);
T.check('a login row with no username is refused', !!ID.validate(Object.assign({}, base, { logins: [{ key: 'ics', user: '', password: 'p' }] }), null).error);
T.check('two logins for the same backend are refused', !!ID.validate(Object.assign({}, base, { logins: [{ key: 'ics', user: 'a', password: 'p' }, { key: 'ics', user: 'b', password: 'q' }] }), null).error);
T.check('a brand-new login with no password is refused', !!ID.validate(Object.assign({}, base, { logins: [{ key: 'ics', user: 'u', password: '' }] }), null).error);
T.check('a wholly empty login row is ignored', ID.validate(Object.assign({}, base, { logins: [{ key: '', user: '', password: '' }] }), null).logins.length === 0);

// --- save + toServerIdentity round trip ---
const saved1 = ID.save(file, vOic.saved, vOic.password, encrypt, null, vOic.logins);
T.check('the OIC password is written only encrypted (base64), never in the clear', /./.test(saved1.backendLogins[0].password)
  && saved1.backendLogins[0].password !== 'secret' && fs.readFileSync(file, 'utf8').indexOf('secret') === -1);

const id1 = ID.toServerIdentity(saved1, null, decrypt);
T.check('toServerIdentity decrypts the OIC login into the logins map', id1.logins && id1.logins.ics && id1.logins.ics.user === 'OIC_USER' && id1.logins.ics.password === 'secret');

// --- keep the password when the field is left blank on a re-save ---
const prev = ID.load(file);
const vKeep = ID.validate(Object.assign({}, base, { fusionPassword: '', logins: [{ key: 'ics', user: 'OIC_USER', password: '' }] }), prev);
T.check('re-saving with the password blank keeps it (same backend + user)', !vKeep.error && vKeep.logins[0].keep === true);
const saved2 = ID.save(file, vKeep.saved, vKeep.password, encrypt, prev, vKeep.logins);
const id2 = ID.toServerIdentity(saved2, null, decrypt);
T.check('…and it still decrypts after the blank re-save', id2.logins.ics && id2.logins.ics.password === 'secret');

// --- upsertBackendLogin (the "sign in to this backend" dialog's Save) ---
const ufile = path.join(os.tmpdir(), `br-identity-up-${process.pid}-${Date.now()}.json`);
ID.save(ufile, ID.validate(base, null).saved, 'fp', encrypt, null, []); // an app sign-in must exist first
T.check('upsert needs an app sign-in first', !!ID.upsertBackendLogin(path.join(os.tmpdir(), `br-none-${process.pid}.json`), { key: 'ics', user: 'u', password: 'p' }, encrypt).error);
T.check('upsert needs a backend name', !!ID.upsertBackendLogin(ufile, { key: '', user: 'u', password: 'p' }, encrypt).error);
T.check('upsert needs a password for a new backend', !!ID.upsertBackendLogin(ufile, { key: 'ics', user: 'u', password: '' }, encrypt).error);
const up1 = ID.upsertBackendLogin(ufile, { key: 'ics', user: 'OIC_USER', password: 'oicpw' }, encrypt);
T.check('upsert saves the OIC login, encrypted', !up1.error && up1.persisted
  && ID.toServerIdentity(up1.saved, null, decrypt).logins.ics.password === 'oicpw'
  && fs.readFileSync(ufile, 'utf8').indexOf('oicpw') === -1);
const up2 = ID.upsertBackendLogin(ufile, { key: 'ics', user: 'OIC_USER', password: '' }, encrypt);
T.check('upsert keeps the password when blank (same user)', !up2.error && ID.toServerIdentity(up2.saved, null, decrypt).logins.ics.password === 'oicpw');
const up3 = ID.upsertBackendLogin(ufile, { key: 'ics', user: 'OTHER', password: 'pw2' }, encrypt);
T.check('upsert replaces the login for the same backend (no duplicate)', !up3.error
  && up3.saved.backendLogins.filter((b) => b.key === 'ics').length === 1
  && ID.toServerIdentity(up3.saved, null, decrypt).logins.ics.user === 'OTHER');
T.check('upsert leaves the Fusion sign-in untouched', up3.saved.username === 'jane.doe' && !!up3.saved.fusionPassword);
try { fs.rmSync(ufile, { force: true }); } catch (e) { /* ignore */ }

// --- forRunAs (Run as must keep the OIC login) ---
const signedIn = { username: 'javeed.shaik', roles: null, fusion: { user: 'fu', password: 'fp' }, logins: { ics: { user: 'oicu', password: 'oicp' } } };
T.check('no Run-as user -> the signed-in identity as-is (logins kept)', ID.forRunAs({ user: '' }, signedIn) === signedIn);
const ra = ID.forRunAs({ user: 'tech.user', roles: ['RT_EQP_ADMINISTRATOR'] }, signedIn);
T.check('Run as keeps the OIC login (so ics does not 401)', ra.username === 'tech.user' && ra.roles[0] === 'RT_EQP_ADMINISTRATOR'
  && ra.fusion.user === 'fu' && ra.logins.ics && ra.logins.ics.user === 'oicu' && ra.logins.ics.password === 'oicp');
const raNoBase = ID.forRunAs({ user: 'x', roles: [] }, null);
T.check('Run as with no sign-in yet: empty logins, no fusion (not a crash)', raNoBase.username === 'x' && raNoBase.roles === null && raNoBase.fusion === null && JSON.stringify(raNoBase.logins) === '{}');
// loginFor over a Run-as identity still finds the OIC login by backend name
T.eq('…and loginFor over that Run-as identity still signs ics', DS.loginFor({ basic: true, credentials: 'vb_ics' }, ra, 'ics').user, 'oicu');

// --- loginFor precedence (the proxy) ---
const identity = { fusion: { user: 'fu', password: 'fp' }, logins: { ics: { user: 'oicu', password: 'oicp' }, 'vb_x': { user: 'cu', password: 'cp' } } };
T.eq('own login by backend name beats the Fusion login', DS.loginFor({ basic: true, credentials: 'vb_y' }, identity, 'ics').user, 'oicu');
T.eq('own login by credential id beats the Fusion login', DS.loginFor({ basic: true, credentials: 'vb_x' }, identity, 'other').user, 'cu');
T.eq('no own login -> the Fusion login', DS.loginFor({ basic: true, credentials: 'vb_z' }, identity, 'nomatch').user, 'fu');
T.check('a backend that does not sign in -> no login', DS.loginFor({ basic: false }, identity, 'ics') === null);
T.check('no identity at all -> no login', DS.loginFor({ basic: true, credentials: 'vb_x' }, {}, 'ics') === null);

try { fs.rmSync(file, { force: true }); } catch (e) { /* ignore */ }
T.report();
