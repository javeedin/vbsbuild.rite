define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  // Back to the customer's dashboard.
  class BackChain extends ActionChain {
    async run(context) {
      await Actions.navigateToPage(context, { page: 'customer-dashboard' });
    }
  }

  return BackChain;
});
