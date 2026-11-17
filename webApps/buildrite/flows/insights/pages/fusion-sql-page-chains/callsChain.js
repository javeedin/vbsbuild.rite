define([
  'vb/action/actionChain',
  'resources/js/fusionSqlClient',
], (ActionChain, C) => {
  'use strict';

  // API calls: the last 30 SOAP calls to the pod (passwords as ***), one opened, Clear.
  class callsChain extends ActionChain {
    async run(context, { op, index }) {
      const v = context.$page.variables;
      if (op === 'load') { v.tab = 'calls'; const r = await C.calls(false); v.calls = (r.body && r.body.calls) || []; v.callOpen = -1; return; }
      if (op === 'clear') { await C.calls(true); v.calls = []; v.callOpen = -1; return; }
      if (op === 'open') { const i = Number(index); v.callOpen = v.callOpen === i ? -1 : i; }
    }
  }
  return callsChain;
});
