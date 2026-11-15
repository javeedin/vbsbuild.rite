define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/shopRules'], (ActionChain, Actions, rules) => {
  'use strict';

  // Every order, read when the page opens; their totals from the shop's rules.
  class LoadOrdersChain extends ActionChain {
    async run(context) {
      const res = await Actions.callRest(context, { endpoint: 'shopApi/getOrders' });
      context.$page.variables.orders = res.ok ? (res.body.items || []).map((o) => Object.assign({}, o, { total: rules.total(o.lines) })) : [];
    }
  }

  return LoadOrdersChain;
});
