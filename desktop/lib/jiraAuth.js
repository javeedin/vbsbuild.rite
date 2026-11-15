'use strict';
/**
 * Connect Jira, for Build.Rite's Jira pages and Issues: the Jira site, your Jira project's key, a Jira user's email and
 * an Atlassian API token, kept in this app's data folder (the token encrypted by the OS keychain; when the keychain
 * cannot encrypt, only for this run). The desktop app adds them to the calls the page makes to the `jira` backend
 * (services/jira through /__backend/jira): the page never holds the token, and it is never sent back to it.
 *
 *   open({ file, encrypt, decrypt }) → store
 *   settings()                 { site, project, email, hasToken, connected }, never the token
 *   save({ site, project, email, token })  an empty token keeps the saved one; project: the Jira project's key (ABC),
 *                              upper-cased, '' allowed (left out: the saved one is kept)
 *   forget()                   the email and token removed (the site and project kept)
 *   auth()                     { site, project, header: 'Basic …' } for the proxy, or null when not connected
 */
const fs = require('fs');
const path = require('path');

// No site until you connect: Build.Rite works with any Jira Cloud site.
const DEFAULT_SITE = '';

/** "your-site", "your-site.atlassian.net" or a URL → "https://your-site.atlassian.net"; '' when it is not a Jira Cloud site. */
function normaliseSite(v) {
  let s = String(v || '').trim();
  if (!s) return '';
  if (/^[a-z0-9-]+$/i.test(s)) s = `${s}.atlassian.net`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || !/\.(atlassian\.net|jira\.com)$/i.test(u.hostname)) return '';
    return `https://${u.hostname.toLowerCase()}`;
  } catch {
    return '';
  }
}

/** A Jira project's key: a letter, then letters, digits or _ (2 to 20 in all). */
const validProject = (k) => /^[A-Z][A-Z0-9_]{1,19}$/.test(String(k || ''));

function open(o) {
  const file = o.file;
  const encrypt = o.encrypt || null;
  const decrypt = o.decrypt || null;
  let memToken = null; // when the keychain cannot encrypt
  let saved = { site: DEFAULT_SITE, project: '', email: '', token: '' };
  try {
    saved = Object.assign(saved, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch { /* first run */ }

  const write = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
  };
  const token = () => {
    if (memToken) return memToken;
    if (!saved.token || !decrypt) return '';
    try { return decrypt(Buffer.from(saved.token, 'base64')); } catch { return ''; }
  };
  const settings = () => {
    const has = !!token();
    return { site: saved.site || DEFAULT_SITE, project: saved.project || '', email: saved.email || '', hasToken: has, connected: has && !!saved.email && !!saved.site, keychain: !!encrypt };
  };

  return {
    settings,
    save(b) {
      const site = normaliseSite(b && b.site);
      if (!site) throw new Error(String((b && b.site) || '').trim() ? 'That is not a Jira Cloud address (https://<your-site>.atlassian.net).' : 'Enter your Jira site (https://<your-site>.atlassian.net).');
      const project = b && b.project !== undefined && b.project !== null ? String(b.project).trim().toUpperCase() : null;
      if (project && !validProject(project)) throw new Error('A Jira project key is letters and digits, like ABC.');
      const email = String((b && b.email) || '').trim();
      if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('Enter the email you sign in to Jira with.');
      saved.site = site;
      if (project !== null) saved.project = project;
      saved.email = email;
      const t = String((b && b.token) || '').trim();
      if (t) {
        if (encrypt) { saved.token = encrypt(t).toString('base64'); memToken = null; } else { saved.token = ''; memToken = t; }
      }
      write();
      return settings();
    },
    forget() {
      saved = { site: saved.site || DEFAULT_SITE, project: saved.project || '', email: '', token: '' };
      memToken = null;
      write();
      return settings();
    },
    auth() {
      const t = token();
      if (!t || !saved.email || !saved.site) return null;
      return { site: saved.site, project: saved.project || '', header: `Basic ${Buffer.from(`${saved.email}:${t}`).toString('base64')}` };
    },
  };
}

module.exports = { open, normaliseSite, validProject, DEFAULT_SITE };
