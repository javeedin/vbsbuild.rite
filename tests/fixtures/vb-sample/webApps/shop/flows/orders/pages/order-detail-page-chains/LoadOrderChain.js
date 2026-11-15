define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  // The order, read when the page opens.
  class LoadOrderChain extends ActionChain {
    async run(context) {
      const res = await Actions.callRest(context, { endpoint: 'shopApi/getOrderById', uriParams: { id: context.$page.variables.id } });
      context.$page.variables.order = res.ok ? res.body : {};
    }
  }

  return LoadOrderChain;
});
