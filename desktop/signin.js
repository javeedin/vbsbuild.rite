'use strict';

/* Sign in for your app (File → Sign in for your app…, or the Run console's Sign in): who your workspace's app runs as
   and its backend login. Talks to the main process only through window.signin (signin-preload.js). */
(async function () {
  const $ = (id) => document.getElementById(id);
  const init = (await window.signin.initial()) || {};


  $('username').value = init.username || '';
  $('fusionUser').value = init.fusionUser && init.fusionUser !== init.username ? init.fusionUser : '';
  if (init.hasPassword) {
    $('fusionPassword').placeholder = 'saved, leave empty to keep';
  }
  document.querySelector(`input[name=rolesFrom][value=${init.rolesFrom === 'pick' ? 'pick' : 'fusion'}]`).checked = true;

  const picked = new Set(init.roles || []);
  (init.knownRoles || []).forEach((code) => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = code;
    box.checked = picked.has(code);
    picked.delete(code);
    label.append(box, document.createTextNode(code));
    label.title = code;
    $('roles').append(label);
  });
  $('otherRoles').value = [...picked].join(', ');

  // Other backend logins (e.g. OIC/ics): a backend that signs in with its own credential, not the Fusion one.
  const addLoginRow = (data) => {
    const d = data || {};
    const row = document.createElement('div');
    row.className = 'login-row';
    row.innerHTML = '<div class="key"><label class="f">Backend</label>'
      + '<input type="text" class="l-key" spellcheck="false" placeholder="e.g. ics"></div>'
      + '<div><label class="f">Username</label><input type="text" class="l-user" spellcheck="false"></div>'
      + '<div><label class="f">Password</label><input type="password" class="l-pass"></div>'
      + '<button type="button" class="rm" title="Remove">✕</button>';
    row.querySelector('.l-key').value = d.key || '';
    row.querySelector('.l-user').value = d.user || '';
    if (d.hasPassword) row.querySelector('.l-pass').placeholder = 'saved, leave empty to keep';
    row.querySelector('.rm').addEventListener('click', () => {
      row.remove();
      if (!$('logins').querySelector('.login-row')) addLoginRow(); // always leave one empty row to fill
    });
    $('logins').append(row);
  };
  (init.backendLogins || []).forEach(addLoginRow);
  if (!$('logins').querySelector('.login-row')) addLoginRow(); // a blank row to add e.g. OIC
  $('addLogin').addEventListener('click', () => addLoginRow());

  const sync = () => {
    const pick = document.querySelector('input[name=rolesFrom]:checked').value === 'pick';
    $('pick').hidden = !pick; // the role list only matters when picking; hiding it keeps the window short
  };
  document.querySelectorAll('input[name=rolesFrom]').forEach((r) => r.addEventListener('change', sync));
  sync();
  ($('username').value ? $('fusionPassword') : $('username')).focus();

  $('cancel').addEventListener('click', () => window.signin.cancel());
  $('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('err').textContent = '';
    $('go').disabled = true;
    try {
      const logins = [...document.querySelectorAll('#logins .login-row')].map((row) => ({
        key: row.querySelector('.l-key').value,
        user: row.querySelector('.l-user').value,
        password: row.querySelector('.l-pass').value,
      })).filter((l) => l.key.trim() || l.user.trim() || l.password);
      const result = await window.signin.submit({
        username: $('username').value,
        fusionUser: $('fusionUser').value,
        fusionPassword: $('fusionPassword').value,
        rolesFrom: document.querySelector('input[name=rolesFrom]:checked').value,
        roles: [...document.querySelectorAll('#roles input:checked')].map((b) => b.value),
        otherRoles: $('otherRoles').value,
        logins,
      });
      if (result && result.error) {
        $('err').textContent = result.error;
      }
    } finally {
      $('go').disabled = false;
    }
  });
})();
