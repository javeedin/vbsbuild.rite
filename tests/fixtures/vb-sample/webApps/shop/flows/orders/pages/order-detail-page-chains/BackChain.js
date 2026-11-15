define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  // Back to the workbench.
  class BackChain extends ActionChain {
    async run(context) {
      await Actions.navigateToPage(context, { page: 'order-list' });
    }
  }

  return BackChain;
});
