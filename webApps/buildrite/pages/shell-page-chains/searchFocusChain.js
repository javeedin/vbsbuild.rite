define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The search box focused: what was typed before is shown again.
  class searchFocusChain extends ActionChain {
    async run(context) {
      const pv = context.$page.variables;
      if ((pv.query || '').trim() && !pv.showResults) await Actions.callChain(context, { chain: 'searchChain', params: { keep: true } });
    }
  }

  return searchFocusChain;
});
