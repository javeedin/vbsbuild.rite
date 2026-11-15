define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // Opens or closes the menu under your name (who you are, your look); the tab menu closes.
  class profileChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      v.profileOpen = !v.profileOpen;
      v.bellOpen = false;
      v.cartOpen = false;
      v.phoneOpen = false;
      v.qaOpen = false;
      v.tabMenuOpen = false;
      v.showResults = false;
    }
  }

  return profileChain;
});
