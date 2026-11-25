'use strict';

/**
 * Who your workspace's app runs as (Sign in as…): the Fusion user, their roles (read from Fusion or picked by hand) and
 * the Fusion login its backend calls go out with — and how that is kept between starts.
 *
 * Saved as local-identity.json in Electron's userData folder (%APPDATA%\Build.Rite on Windows): outside the
 * project, so it is never committed and never copied into build/processed by Oracle's build. The Fusion password
 * is stored only encrypted with Electron safeStorage (DPAPI on Windows, Keychain on macOS); where that is not
 * available it is kept for this run only.
 *
 * Plain Node; encrypt/decrypt are passed in, so npm test can check it without Electron.
 */
const fs = require('fs');

/** Kept for the saved file's shape: Build.Rite has one app, so the version is always 'build'. */
const VERSIONS = ['build'];
const versionOf = () => 'build';

/**
 * Checks the sign-in form. Returns { error } or { saved, password } where saved is what goes to disk (no password).
 * form: { version: 'old'|'new', username, rolesFrom: 'fusion'|'pick', roles: string[], otherRoles, fusionUser,
 *         fusionPassword }
 */
function validate(form, previous) {
  const f = form || {};
  const username = String(f.username || '').trim();
  if (!username) {
    return { error: 'Enter the Fusion username to sign in as.' };
  }
  const roles = [...(Array.isArray(f.roles) ? f.roles : []), ...String(f.otherRoles || '').split(/[,\s]+/)]
    .map((r) => String(r).trim().toUpperCase())
    .filter((r, i, all) => r && all.indexOf(r) === i);
  const rolesFrom = f.rolesFrom === 'pick' ? 'pick' : 'fusion';
  const fusionUser = String(f.fusionUser || '').trim() || username;
  const password = String(f.fusionPassword || '');
  const keepsPassword = !password && previous && previous.fusionUser === fusionUser && !!previous.fusionPassword;
  if (rolesFrom === 'pick' && !roles.length) {
    return { error: 'Tick at least one role, or read roles from Fusion.' };
  }
  if (rolesFrom === 'fusion' && !password && !keepsPassword) {
    return { error: 'Enter the Fusion password: roles are read from Fusion (the app\'s roles report).' };
  }
  // Extra backend logins (e.g. OIC/ics): a backend that signs in with its OWN VBCS credential, not the Fusion one.
  // Each is { key, user, password } where key is the backend's name in services/catalog.json (e.g. "ics") or its
  // credential id; the proxy's loginFor() uses it for that backend instead of falling back to the Fusion login.
  const prevLogins = (previous && Array.isArray(previous.backendLogins)) ? previous.backendLogins : [];
  const logins = []; // { key, user, password|null, keep } — plaintext (or keep the previous encrypted one), for save()
  const seen = new Set();
  for (const row of (Array.isArray(f.logins) ? f.logins : [])) {
    const key = String((row && row.key) || '').trim();
    const user = String((row && row.user) || '').trim();
    const pw = String((row && row.password) || '');
    if (!key && !user && !pw) continue; // an empty row: ignored
    if (!key) return { error: 'Give each extra backend login a backend name (e.g. ics for OIC).' };
    if (seen.has(key)) return { error: `There are two logins for backend "${key}" — keep one.` };
    seen.add(key);
    if (!user) return { error: `Enter the username for backend "${key}".` };
    const prev = prevLogins.find((p) => p.key === key);
    const keep = !pw && !!prev && prev.user === user && !!prev.password;
    if (!pw && !keep) return { error: `Enter the password for backend "${key}" (or clear the row).` };
    logins.push({ key, user, password: pw || null, keep });
  }
  return {
    saved: {
      username, rolesFrom, roles: rolesFrom === 'pick' ? roles : [], fusionUser, version: versionOf(f.version),
      backendLogins: logins.map(({ key, user }) => ({ key, user })),
    },
    password: password || null,
    keepsPassword,
    logins,
  };
}

/**
 * Adds or updates ONE backend login (e.g. OIC/ics) without touching the rest of the sign-in — used by the focused
 * "sign in to this backend" dialog that opens when a backend answers 401. The password is encrypted like the Fusion
 * one, or kept from the previous save when left blank. Needs an app sign-in already (a user it runs as).
 */
function upsertBackendLogin(file, entry, encrypt) {
  const key = String((entry && entry.key) || '').trim();
  const user = String((entry && entry.user) || '').trim();
  const password = String((entry && entry.password) || '');
  if (!key) return { error: 'Give the backend a name (e.g. ics for OIC).' };
  if (!user) return { error: 'Enter the username.' };
  const saved = load(file);
  if (!saved || !saved.username) {
    return { error: 'Sign in for your app first (the user it runs as), then add this backend login.' };
  }
  const list = Array.isArray(saved.backendLogins) ? saved.backendLogins : [];
  const prev = list.find((b) => b.key === key);
  let enc;
  if (password && encrypt) enc = encrypt(password).toString('base64');
  else if (!password && prev && prev.user === user && prev.password) enc = prev.password; // keep the saved one
  else if (!password) return { error: 'Enter the password.' };
  else enc = null; // no encryptor on this PC: cannot persist the password (as for the Fusion one)
  const row = { key, user };
  if (enc) row.password = enc;
  const out = Object.assign({}, saved, { backendLogins: list.filter((b) => b.key !== key).concat([row]) });
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
  return { saved: out, persisted: !!enc };
}

/** Reads the saved sign-in, or null. */
function load(file) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return saved && saved.username ? saved : null;
  } catch {
    return null;
  }
}

/** Writes the sign-in; the password only as encrypt(password) in base64, or not at all when encrypt is null. */
function save(file, saved, password, encrypt, previous, logins) {
  const out = Object.assign({}, saved);
  if (password && encrypt) {
    out.fusionPassword = encrypt(password).toString('base64');
  } else if (!password && previous && previous.fusionUser === saved.fusionUser && previous.fusionPassword) {
    out.fusionPassword = previous.fusionPassword;
  }
  // Extra backend logins: each password encrypted like the Fusion one (safeStorage), or kept from the previous save
  // when left blank. With no encryptor available the password is not written (as for the Fusion one).
  if (Array.isArray(saved.backendLogins)) {
    const prevLogins = (previous && Array.isArray(previous.backendLogins)) ? previous.backendLogins : [];
    out.backendLogins = saved.backendLogins.map((bl) => {
      const entry = { key: bl.key, user: bl.user };
      const spec = (logins || []).find((l) => l.key === bl.key);
      if (spec && spec.password && encrypt) {
        entry.password = encrypt(spec.password).toString('base64');
      } else {
        const prev = prevLogins.find((p) => p.key === bl.key && p.user === bl.user);
        if (prev && prev.password) entry.password = prev.password;
      }
      return entry;
    });
  }
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
  return out;
}

/** The identity the local server uses: username, roles (only when picked), Fusion login (when there is a password). */
function toServerIdentity(saved, password, decrypt) {
  if (!saved || !saved.username) {
    return null;
  }
  let pw = password || null;
  if (!pw && saved.fusionPassword && decrypt) {
    try {
      pw = decrypt(Buffer.from(saved.fusionPassword, 'base64'));
    } catch {
      pw = null;
    }
  }
  // Per-backend logins, decrypted, keyed by backend name / credential id — what the proxy's loginFor() looks up before
  // falling back to the Fusion login, so a backend with its own VBCS credential (e.g. OIC/ics) signs in as itself.
  const logins = {};
  if (Array.isArray(saved.backendLogins) && decrypt) {
    saved.backendLogins.forEach((bl) => {
      if (!bl || !bl.key || !bl.user || !bl.password) return;
      try {
        const p = decrypt(Buffer.from(bl.password, 'base64'));
        if (p) logins[bl.key] = { user: bl.user, password: p };
      } catch {
        /* a login we cannot decrypt (another PC / reset keychain): left out */
      }
    });
  }
  return {
    username: saved.username,
    roles: saved.rolesFrom === 'pick' && saved.roles && saved.roles.length ? saved.roles : null,
    fusion: pw ? { user: saved.fusionUser || saved.username, password: pw } : null,
    logins,
  };
}

/**
 * The identity a workspace app runs with under "Run as": the Run-as user and roles, but KEEPING the signed-in identity's
 * backend logins — the Fusion login AND the per-backend `logins` map (OIC/ics …) — so a backend with its own credential
 * still authenticates instead of borrowing the Fusion login and getting 401. With no Run-as user, the signed-in identity
 * is used as it is.
 */
function forRunAs(runAs, base) {
  const r = runAs || {};
  if (!r.user) return base || null;
  const roles = Array.isArray(r.roles) ? r.roles : [];
  return {
    username: r.user,
    roles: roles.length ? roles : null,
    fusion: base && base.fusion ? base.fusion : null,
    logins: (base && base.logins) ? base.logins : {},
  };
}

/** True when the saved sign-in can be used as-is (reading roles from Fusion needs a password we can decrypt). */
function usable(identity, saved) {
  return !!identity && (saved.rolesFrom === 'pick' || !!identity.fusion);
}

/** Forgets the saved sign-in (File → Sign out). */
function remove(file) {
  fs.rmSync(file, { force: true });
}

/** Remembers the version in the saved sign-in without touching the rest (always 'build' now; kept for older files). */
function saveVersion(file, version) {
  const saved = load(file);
  if (saved) {
    fs.writeFileSync(file, JSON.stringify(Object.assign({}, saved, { version: versionOf(version) }), null, 2), 'utf8');
  }
}

module.exports = { validate, load, save, remove, saveVersion, versionOf, toServerIdentity, usable, upsertBackendLogin, forRunAs };
