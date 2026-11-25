'use strict';

/* Sign in to a backend: the focused dialog that opens when a backend (e.g. OIC/ics) answers 401. Shows the full call,
   takes the username/password that backend wants, tests it, and saves it. Talks to the main process only through
   window.backendLogin (backend-login-preload.js). */
(async function () {
  const $ = (id) => document.getElementById(id);
  const init = (await window.backendLogin.initial()) || {};

  const call = `${init.method ? init.method + ' ' : ''}${init.url || init.path || ''}`.trim();
  $('call').value = call;
  $('backend').value = init.backend || '';
  $('user').value = init.user || '';
  if (init.hasPassword) $('pass').placeholder = 'saved, leave empty to keep';
  if (init.backend) $('title').textContent = `Sign in to “${init.backend}”`;
  (init.user ? $('pass') : $('user')).focus();

  const show = (cls, msg) => { const el = $('result'); el.className = 'result ' + cls; el.textContent = msg; };

  // What the HTTP status of a test means. Test uses a GET, so it never runs the integration; an auth failure (401) comes
  // back before anything else, while any other code means the login was accepted.
  const verdict = (r) => {
    if (!r) return show('err', 'No response.');
    if (r.error) return show('err', 'Could not reach it: ' + r.error);
    const s = r.status;
    if (s === 401) return show('err', 'HTTP 401 — login refused. Wrong username/password, or this user has no access.');
    if (s === 403) return show('warn', 'HTTP 403 — login accepted, but this user is not authorized for this call (in OIC it needs the ServiceInvoker role / the integration granted).');
    if (s >= 200 && s < 300) return show('ok', 'HTTP ' + s + ' — login accepted. ✓');
    return show('ok', 'HTTP ' + s + ' — login accepted (the call answered ' + s + ', not an auth error). ✓');
  };

  $('copy').addEventListener('click', async () => {
    await window.backendLogin.copy(call);
    const b = $('copy'); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1200);
  });

  const payload = () => ({ backend: $('backend').value, user: $('user').value, password: $('pass').value });

  $('test').addEventListener('click', async () => {
    if (!$('user').value.trim()) { show('err', 'Enter the username to test.'); return; }
    show('muted', 'Testing…');
    $('test').disabled = true;
    try { verdict(await window.backendLogin.test(payload())); }
    finally { $('test').disabled = false; }
  });

  $('cancel').addEventListener('click', () => window.backendLogin.cancel());
  $('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('save').disabled = true;
    try {
      const r = await window.backendLogin.save(payload());
      if (r && r.error) { show('err', r.error); }
      // on success the main process closes this window and reloads the app
    } finally {
      $('save').disabled = false;
    }
  });
})();
