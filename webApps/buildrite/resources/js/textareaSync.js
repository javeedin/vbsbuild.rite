define([], function () {
  'use strict';

  // VB's :value on a <textarea> drawn inside a list (oj-bind-for-each — a sticky note, a step's body to send) sets only
  // its value attribute, and a textarea shows its own text, not that attribute: a box drawn again (after a change, its
  // list redrawn) showed empty though its value was kept. So here a textarea's value follows its value attribute — when
  // it is drawn and whenever the attribute changes — unless you are typing in it. Started once by the shell.
  var started = false;
  function sync(el) {
    if (!el || el.tagName !== 'TEXTAREA' || !el.hasAttribute('value')) return;
    if (typeof document !== 'undefined' && el === document.activeElement) return;
    var a = el.getAttribute('value');
    if (el.value !== a) el.value = a;
  }
  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === 'TEXTAREA') sync(node);
    else if (node.querySelectorAll) Array.prototype.forEach.call(node.querySelectorAll('textarea[value]'), sync);
  }
  function start(root) {
    if (started || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    var r = root || document.body || document.documentElement;
    if (!r) return;
    started = true;
    new MutationObserver(function (list) {
      list.forEach(function (m) { if (m.type === 'attributes') sync(m.target); else Array.prototype.forEach.call(m.addedNodes, scan); });
    }).observe(r, { subtree: true, childList: true, attributes: true, attributeFilter: ['value'] });
    scan(r);
  }
  return { start: start, sync: sync };
});
