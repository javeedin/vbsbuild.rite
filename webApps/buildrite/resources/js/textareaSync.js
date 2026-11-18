define([], function () {
  'use strict';

  // Two of VB's bindings, inside a list (oj-bind-for-each), set an attribute instead of the property they mean:
  //   :value on a <textarea> (a sticky note, a step's body to send) — a textarea shows its own text, not that attribute,
  //     so a box drawn again (after a change, its list redrawn) showed empty though its value was kept;
  //   :inner-h-t-m-l on an element (an AI answer formatted, a line of code coloured) — the HTML stayed in an attribute
  //     named inner-h-t-m-l and the element showed nothing.
  // So here a textarea's value follows its value attribute (unless you are typing in it), and an element's content
  // follows its inner-h-t-m-l attribute — when it is drawn and whenever the attribute changes. That HTML is made by the
  // page's own code (resources/js/mdRender.js escapes every text it is given). Started once by the shell.
  var started = false;
  var HTML = 'inner-h-t-m-l';
  function sync(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.hasAttribute(HTML)) {
      var h = el.getAttribute(HTML);
      if (el.__nxHtml !== h) { el.__nxHtml = h; el.innerHTML = h; }
      return;
    }
    if (el.tagName !== 'TEXTAREA' || !el.hasAttribute('value')) return;
    if (typeof document !== 'undefined' && el === document.activeElement) return;
    var a = el.getAttribute('value');
    if (el.value !== a) el.value = a;
  }
  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    sync(node);
    if (node.querySelectorAll) Array.prototype.forEach.call(node.querySelectorAll('textarea[value], [' + HTML + ']'), sync);
  }
  function start(root) {
    if (started || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    var r = root || document.body || document.documentElement;
    if (!r) return;
    started = true;
    new MutationObserver(function (list) {
      list.forEach(function (m) { if (m.type === 'attributes') sync(m.target); else Array.prototype.forEach.call(m.addedNodes, scan); });
    }).observe(r, { subtree: true, childList: true, attributes: true, attributeFilter: ['value', HTML] });
    scan(r);
  }
  return { start: start, sync: sync };
});
