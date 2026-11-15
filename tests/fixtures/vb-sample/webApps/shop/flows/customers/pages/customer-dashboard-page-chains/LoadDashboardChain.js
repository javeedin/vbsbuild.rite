define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  // The customer's recent orders, read when the page opens.
  class LoadDashboardChain extends ActionChain {
    async run(context) {
      const res = await Actions.callRest(context, { endpoint: 'shopApi/getOrders' });
      context.$page.variables.orders = res.ok ? res.body.items || [] : [];
    }
  }

  return LoadDashboardChain;
});
