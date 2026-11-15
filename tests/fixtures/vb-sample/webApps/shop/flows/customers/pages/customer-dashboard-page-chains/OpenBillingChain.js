define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  // My Billing: the customer's invoices.
  class OpenBillingChain extends ActionChain {
    async run(context) {
      await Actions.navigateToPage(context, { page: 'customer-billing' });
    }
  }

  return OpenBillingChain;
});
