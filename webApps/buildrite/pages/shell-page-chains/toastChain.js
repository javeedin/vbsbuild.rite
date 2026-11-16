define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // A toast at the bottom right: shown for six seconds, or until dismissed; a newer one replaces it.
  const SHOW_MS = 6000;

  class toastChain extends ActionChain {
    async run(context, { message, tone, act }) {
      const { $page } = context;
      const seq = (($page.variables.toast && $page.variables.toast.seq) || 0) + 1;
      // act: { label, navId } — a button that opens that screen (an AI error: Open AI settings); shown a little longer
      const a = act && act.label && act.navId ? { label: String(act.label), navId: String(act.navId) } : null;
      $page.variables.toast = { message: message || '', tone: tone || 'info', seq, act: a };
      if (!message) return;
      await new Promise((r) => setTimeout(r, a ? SHOW_MS * 2 : SHOW_MS));
      if ($page.variables.toast && $page.variables.toast.seq === seq) $page.variables.toast = { message: '', tone: 'info', seq };
    }
  }

  return toastChain;
});
