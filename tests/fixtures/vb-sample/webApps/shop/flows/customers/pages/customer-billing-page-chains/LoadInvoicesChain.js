define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  // The customer's invoices, read when the page opens.
  class LoadInvoicesChain extends ActionChain {
    async run(context) {
      const res = await Actions.callRest(context, { endpoint: 'shopApi/getInvoices', uriParams: { customer: 'C-100' } });
      context.$page.variables.invoices = res.ok ? res.body.items || [] : [];
    }
  }

  return LoadInvoicesChain;
});
