define(['resources/js/fddClient', 'resources/js/shellBus'], function (FC, bus) {
  'use strict';

  // Design documents (Analyze with AI → Create the functional design), the steps the Analyze with AI page and the FDD
  // library share: one document's line, and what its buttons do. Works on the page's variables (v): v.designView is the
  // preview { id, title, html, loading, error, hasPdf }.
  //
  //   meta(doc)                    "16 Nov 2026 · Sprint 2026-11 A · by Priya Raman · PDF 182 KB · against Project FDD v1.7"
  //   act(v, act, doc, kind)       preview | download (kind: pdf, md, html) | open (in this PC's reader) | folder | push
  //                                → the git answer for push, else nothing
  //   list(base, story)            the design documents (all, or one story's): from the local server, else those listed
  //                                with the app (resources/fdd/designs.json: listed only, their files are in git)

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function day(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? '' : d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); }

  function meta(d) {
    var x = d || {};
    var size = x.sizes && x.sizes.pdf ? 'PDF ' + kb(x.sizes.pdf) : 'no PDF (HTML and Markdown)';
    return [day(x.createdAt), x.sprint ? 'Sprint ' + x.sprint : '', x.by ? 'by ' + x.by : '', size, x.fddName ? 'against ' + x.fddName : ''].filter(Boolean).join(' · ');
  }

  function list(base, story) {
    return FC.designs(story || '').then(function (r) {
      if (r.ok && r.body && Array.isArray(r.body.docs)) return { docs: r.body.docs, local: true };
      // no local server (VBCS, a plain browser): the list the app shipped with
      var url = (base || '') + (base && base.charAt(base.length - 1) !== '/' ? '/' : '') + 'resources/fdd/designs.json?t=' + Date.now();
      return window.fetch(url, { cache: 'no-store', credentials: 'same-origin' }).then(function (x) { return x.ok ? x.json() : { docs: [] }; }, function () { return { docs: [] }; })
        .then(function (j) { var docs = (j && Array.isArray(j.docs)) ? j.docs : []; return { docs: story ? docs.filter(function (d) { return d.key === story; }) : docs, local: false }; }, function () { return { docs: [], local: false }; });
    });
  }

  function act(v, what, doc, kind) {
    if (!doc) return Promise.resolve(null);
    if (what === 'preview') {
      v.designView = { id: doc.id, title: doc.key + ' · v' + doc.version + (doc.title ? ' — ' + doc.title : ''), html: '', loading: true, error: '', hasPdf: !!(doc.files && doc.files.pdf) };
      return FC.designText(doc.id, 'html').then(function (r) {
        if (!v.designView || v.designView.id !== doc.id) return null;
        v.designView = Object.assign({}, v.designView, { loading: false, html: r.ok ? r.text : '', error: r.ok ? '' : r.error });
        return null;
      });
    }
    if (what === 'download') {
      return FC.designDownload(doc.id, kind || 'pdf').then(function (r) {
        if (!r.ok) bus.toast(r.error, 'error'); else bus.toast('Saved ' + r.name + ' to your Downloads.', 'success');
        return null;
      });
    }
    if (what === 'open' || what === 'folder') {
      return FC.designOpen(doc.id, kind || 'pdf', what === 'folder').then(function (r) {
        if (!r.ok) bus.toast((r.body && r.body.error) || 'Could not open it.', 'error');
        return null;
      });
    }
    if (what === 'push') {
      return FC.gitSave({ message: 'Design: ' + doc.key + ' v' + doc.version, push: true }).then(function (r) {
        var b = r.body || {};
        bus.toast(r.ok ? (b.nothing ? 'Already in git: nothing new to push.' : 'Pushed to git' + (b.upstream ? ' (' + b.upstream + ')' : '') + '.') : 'git: ' + (b.error || 'not saved') + (b.hint ? ' ' + b.hint : ''), r.ok ? 'success' : 'error');
        return r.ok ? Object.assign({ ok: true }, b) : { ok: false, error: b.error || '' };
      });
    }
    return Promise.resolve(null);
  }

  return { meta: meta, act: act, list: list, day: day };
});
