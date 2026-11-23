define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // Features: from every Jira story, the product's feature list — features, their stories and a status roll-up — in a tab
  // of its own (insights/jira-features).
  class openFeaturesChain extends ActionChain {
    async run() {
      bus.open({ record: 'jira-features', params: {} });
    }
  }
  return openFeaturesChain;
});
