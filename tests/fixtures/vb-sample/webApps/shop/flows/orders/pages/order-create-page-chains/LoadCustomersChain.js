define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/shopRules'], (ActionChain, Actions, rules) => {
  'use strict';

  // The customers to pick from: the shop's list, and the CUSTOMERS_RP report in BI Publisher for their credit status.
  class LoadCustomersChain extends ActionChain {
    async run(context) {
      const res = await Actions.callRest(context, { endpoint: 'shopApi/getCustomers' });
      const credit = await Actions.callRest(context, { endpoint: 'bipService/runBIPReport', body: { reportAbsolutePath: '/Custom/Shop/CUSTOMERS_RP.xdo', parameterNameValues: [{ name: 'P_CUSTOMER_ID', values: [''] }] } });
      context.$page.variables.customers = res.ok ? res.body.items || [] : [];
      context.$page.variables.credit = rules.decodeReportRows(credit.body, 'G_1');
    }
  }

  return LoadCustomersChain;
});
