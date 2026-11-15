define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  // A new order, in the orders flow.
  class NewOrderChain extends ActionChain {
    async run(context) {
      await Actions.navigateToPage(context, { page: 'orders/order-create' });
    }
  }

  return NewOrderChain;
});
