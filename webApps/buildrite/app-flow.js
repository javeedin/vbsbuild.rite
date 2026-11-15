define([
  'resources/js/nav',
  'resources/js/fmt',
], (nav, fmt) => {
  'use strict';

  // Build.Rite's app module: what bindings call ($application.functions.x). None uses `this`: a binding may call a
  // function detached from the module.
  if (typeof document !== 'undefined') {
    try { document.title = 'Build.Rite'; document.documentElement.setAttribute('data-nx-product', 'buildrite'); } catch (e) { /* no DOM */ }
  }

  // Who you are, as the desktop app says (/_currentuser: your git name and email on this PC)
  const NAME_FIELDS = ['fullName', 'displayName', 'name', 'login', 'userName', 'username', 'preferred_username', 'email', 'userId'];
  function userDisplayName(user) {
    if (!user) return '';
    for (let i = 0; i < NAME_FIELDS.length; i++) {
      const v = user[NAME_FIELDS[i]];
      if (v && typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  class AppModule {
    isBuild() { return true; }
    productName() { return nav.product.name; }

    // ── who ──
    userDisplayName(user) { return userDisplayName(user); }
    userInitials(user) {
      const name = userDisplayName(user);
      if (!name) return '';
      const parts = name.split('@')[0].split(/[\s._-]+/).filter((p) => p && /[a-z]/i.test(p));
      if (!parts.length) return '';
      if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
      return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }
    /** The line under your name: your email when the name is shown, else where Build.Rite runs. */
    userRole(user) {
      const email = user && typeof user.email === 'string' ? user.email : '';
      return email && email !== userDisplayName(user) ? email : 'Build.Rite on this PC';
    }

    // ── menu ──
    visibleGroups() { return nav.visibleGroups(); }
    navItem(id) { return nav.item(id); }
    canOpen(id) { return nav.itemVisible(nav.item(id)); }

    // ── formatting ──
    date(v, year) { return fmt.date(v, year); }
    range(a, b) { return fmt.range(a, b); }
    money(v, currency) { return fmt.money(v, currency); }
  }

  return AppModule;
});
