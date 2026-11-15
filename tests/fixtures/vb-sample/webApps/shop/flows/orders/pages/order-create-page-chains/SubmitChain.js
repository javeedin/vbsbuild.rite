define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  // The order sent, then the workbench.
  class SubmitChain extends ActionChain {
    async run(context) {
      const res = await Actions.callRest(context, { endpoint: 'shopApi/createOrder', body: { customer: context.$page.variables.customer, note: context.$page.variables.note } });
      if (res.ok) await Actions.navigateToPage(context, { page: 'order-list' });
    }
  }

  return SubmitChain;
});
