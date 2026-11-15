define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  // The user's roles, read once from the USER_ROLES report in BI Publisher.
  class loadRolesChain extends ActionChain {
    async run(context) {
      const app = context.$application.variables;
      const res = await Actions.callRest(context, { endpoint: 'bipService/runBIPReport', body: { reportAbsolutePath: '/Custom/Shop/USER_ROLES.xdo', parameterNameValues: [{ name: 'P_LOGIN', values: [context.$application.user.userId] }] } });
      // the roles the app knows: SHOP_ADMIN, SHOP_CLERK, SHOP_VIEWER
      app.userRoles = res.ok ? (res.body.roles || []) : [];
      app.rolesLoaded = true;
    }
  }

  return loadRolesChain;
});
