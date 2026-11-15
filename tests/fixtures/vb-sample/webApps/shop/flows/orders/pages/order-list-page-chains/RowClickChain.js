define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  // An order picked in the table: its detail.
  class RowClickChain extends ActionChain {
    async run(context) {
      const id = context.$event && context.$event.detail ? context.$event.detail.context.key : '';
      await Actions.navigateToPage(context, { page: 'order-detail', params: { id: id } });
    }
  }

  return RowClickChain;
});
