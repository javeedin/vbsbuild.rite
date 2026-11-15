/*
 * The roles a VB app's own code names (desktop/lib/appRoles.js), so Build.Rite knows the app it runs (Run as, the Run
 * console's `roles`, the sign-in's role list, the no-access hint) instead of a list written in for one app:
 *   - the role codes on lines that speak of roles (strings and object keys), and app-flow.json's "roles" lists
 *   - not the words around them: access levels, report parameters (P_…), columns and settings (…_NAME, …_ENABLED)
 *   - the BI Publisher report the app reads its user's roles from
 *   - one app or every app of a project, or an app's own folder; kept until a file there changes
 *
 * Run:  node tests/app-roles.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const AR = require('../desktop/lib/appRoles');

const T = H.makeAsserter();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'br-approles-'));
try {
  T.section('the sample app (tests/fixtures/vb-sample)');
  const r = AR.rolesIn(H.FIXTURE, 'shop');
  T.eq('its roles: the codes its code checks the user\'s roles against', r.roles.join(), 'SHOP_ADMIN,SHOP_CLERK,SHOP_VIEWER');
  T.check('…where they were found', r.from.join() === 'webApps/shop/app-flow.js', JSON.stringify(r.from));
  T.check('…not the report\'s parameter on the roles line (P_LOGIN), nor the report itself', r.roles.indexOf('P_LOGIN') === -1 && r.roles.indexOf('USER_ROLES') === -1);
  T.eq('its roles report', r.report, '/Custom/Shop/USER_ROLES.xdo');
  T.eq('…the same from rolesReportIn', AR.rolesReportIn(H.FIXTURE, 'shop'), '/Custom/Shop/USER_ROLES.xdo');
  T.eq('every app of the project (no app named): the same here (one app)', AR.rolesIn(H.FIXTURE).roles.join(), 'SHOP_ADMIN,SHOP_CLERK,SHOP_VIEWER');
  T.eq('the app\'s own folder works too', AR.rolesIn(path.join(H.FIXTURE, 'webApps', 'shop')).roles.join(), 'SHOP_ADMIN,SHOP_CLERK,SHOP_VIEWER');
  T.check('an app that is not there, or a folder with no app: nothing (no error)', AR.rolesIn(H.FIXTURE, 'nope').roles.length === 0 && AR.rolesIn(tmp).roles.length === 0 && AR.rolesReportIn(tmp) === '');

  T.section('what counts as a role');
  const app = path.join(tmp, 'proj', 'webApps', 'ledger');
  fs.mkdirSync(path.join(app, 'flows', 'books', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(app, 'app-flow.json'), JSON.stringify({ id: 'ledger', security: { access: { requiresAuthentication: true, roles: ['LEDGER_AUDITOR'] } } }));
  fs.writeFileSync(path.join(app, 'app-flow.js'), [
    "const ACCESS = { LEDGER_ADMIN: 'FULL', LEDGER_CLERK: 'READ_ONLY' }; // the roles and what each may do",
    "if (userRoles.indexOf('LEDGER_APPROVER') !== -1) show();",
    "const ROLE_COLUMN = 'ORACLE_ROLE_NAME'; // a column of the roles report, not a role",
    "const FEATURE_ENABLED = 'BOOKS_ENABLED'; // a setting on a line with no roles",
    "",
    "",
    "",
    "",
    "",
    "",
    "const report = '/Custom/Ledger/WHO_RP.xdo'; // the user's roles are read from this report",
  ].join('\n'));
  fs.writeFileSync(path.join(app, 'flows', 'books', 'pages', 'books-page.js'), "const other = '/Custom/Ledger/BOOKS_RP.xdo'; // the books\n");
  fs.writeFileSync(path.join(app, 'flows', 'books', 'pages', 'books-page.html'), '<div :hidden="[[ !$functions.hasRole($application.user.roles, \'LEDGER_VIEWER\') ]]"></div>\n');
  const l = AR.rolesIn(path.join(tmp, 'proj'), 'ledger');
  T.eq('object keys and strings on role lines, an HTML binding, app-flow.json\'s roles list', l.roles.join(), 'LEDGER_ADMIN,LEDGER_APPROVER,LEDGER_AUDITOR,LEDGER_CLERK,LEDGER_VIEWER');
  T.check('…not access levels (FULL, READ_ONLY), columns (…_NAME) or settings (…_ENABLED)', ['FULL', 'READ_ONLY', 'ORACLE_ROLE_NAME', 'BOOKS_ENABLED', 'ROLE_COLUMN'].every((x) => l.roles.indexOf(x) === -1), l.roles.join());
  T.eq('its roles report: the .xdo near a mention of roles, not another report', l.report, '/Custom/Ledger/WHO_RP.xdo');
  T.check('validRole: a code\'s shape only', AR.validRole('LEDGER_ADMIN') && AR.validRole('XX_APP_MANAGER_JR') && !AR.validRole('ledger admin') && !AR.validRole('AB') && !AR.validRole(''));

  T.section('kept until a file changes');
  const t0 = process.hrtime.bigint();
  AR.rolesIn(path.join(tmp, 'proj'), 'ledger');
  const cached = Number(process.hrtime.bigint() - t0) / 1e6;
  T.check('asked again: the same answer, kept', AR.rolesIn(path.join(tmp, 'proj'), 'ledger').roles.join() === l.roles.join() && cached < 1000, cached + ' ms');
  const later = new Date(Date.now() + 5000);
  fs.writeFileSync(path.join(app, 'flows', 'books', 'pages', 'books-extra.js'), "const roles = ['LEDGER_TEMP'];\n");
  fs.utimesSync(path.join(app, 'flows', 'books', 'pages', 'books-extra.js'), later, later);
  T.check('a file added: read again (the new role found)', AR.rolesIn(path.join(tmp, 'proj'), 'ledger').roles.indexOf('LEDGER_TEMP') !== -1);
} catch (e) {
  T.check('no exception: ' + (e && e.stack), false);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
T.report();
