define([], function () {
  'use strict';

  // Sticky notes on a flow's diagram (the saved flow's Flow tab): dragged by their top bar, resized by their corner —
  // smoothly: while the pointer moves only the note's own box moves (once a frame), nothing else is drawn again; when it
  // is let go its place and size (in the diagram's units: the board's data-dw / data-dh) go to the page once, through the
  // note's own hidden button (data-act="placeSticky", data-value="x,y,w,h"), so the page's usual click handling keeps it.
  // A note stays inside the diagram. Installed once per document (any number of boards).
  var installed = false;
  var MIN_W = 90, MIN_H = 48; // diagram units
  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };

  function down(e) {
    if (e.button !== undefined && e.button !== 0) return;
    var t = e.target;
    var handle = t && t.closest ? t.closest('[data-drag]') : null;
    if (!handle || t.closest('button, textarea, input, select, a')) return;
    var note = handle.closest('.nx-sfp-sn');
    var board = note ? note.closest('.nx-sfp-board') : null;
    var layer = note ? note.parentElement : null;
    if (!note || !board || !layer) return;
    e.preventDefault();
    var mode = handle.getAttribute('data-drag') === 'resize' ? 'resize' : 'move';
    var L = layer.getBoundingClientRect();
    var r = note.getBoundingClientRect();
    var dw = Number(board.getAttribute('data-dw')) || L.width;
    var k = L.width / dw; // pixels per diagram unit
    var st = { x0: e.clientX, y0: e.clientY, left: r.left - L.left, top: r.top - L.top, w: r.width, h: r.height };
    var cur = { left: st.left, top: st.top, w: st.w, h: st.h };
    var moved = false;
    var raf = 0;
    note.classList.add('nx-sfp-sn--drag');
    board.classList.add('nx-sfp-board--drag');
    try { handle.setPointerCapture(e.pointerId); } catch (x) { /* an older browser: the document still gets the moves */ }
    var paint = function () {
      raf = 0;
      note.style.left = cur.left + 'px'; note.style.top = cur.top + 'px'; note.style.width = cur.w + 'px'; note.style.height = cur.h + 'px';
    };
    var move = function (ev) {
      var dx = ev.clientX - st.x0, dy = ev.clientY - st.y0;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      if (mode === 'move') {
        cur.left = clamp(st.left + dx, 0, Math.max(0, L.width - st.w));
        cur.top = clamp(st.top + dy, 0, Math.max(0, L.height - st.h));
      } else {
        cur.w = clamp(st.w + dx, MIN_W * k, Math.max(MIN_W * k, L.width - st.left));
        cur.h = clamp(st.h + dy, MIN_H * k, Math.max(MIN_H * k, L.height - st.top));
      }
      if (!raf) raf = (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(paint);
    };
    var up = function () {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      note.classList.remove('nx-sfp-sn--drag');
      board.classList.remove('nx-sfp-board--drag');
      if (!moved) return;
      if (raf) paint();
      var u = 1 / k;
      var val = [cur.left * u, cur.top * u, cur.w * u, cur.h * u].map(function (n) { return Math.round(n); }).join(',');
      var btn = note.querySelector('.nx-sfp-ncommit');
      if (btn) { btn.setAttribute('data-value', val); btn.click(); }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  function install() {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    document.addEventListener('pointerdown', down);
  }
  return { install: install };
});
