define([], function () {
  'use strict';

  // Markdown → HTML for answers to read on screen (the AI Assistant), safe: every text is escaped, and HTML is made only
  // from the Markdown it knows — headings, paragraphs, lists (nested, task lists), tables (aligned), fenced code (a label,
  // light colouring, a Copy button), callouts (> [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]), quotes,
  // rules, **bold**, *italic*, ~~struck~~, `code`, links (http, https, mailto only) — and two of Build.Rite's own:
  //   ```flow   one step per line, "From -> To: what happens", drawn as steps between boxes
  //   [n]       a citation of source n (opts.cites lists the numbers that exist) → a chip (data-cite)
  //   `path/file.js:42` → a file reference (data-path, data-line) the page can open
  // render(md, { cites }) → html.  install() once: Copy on a code block copies it.
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var CALLOUTS = { NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution' };
  var FILE_REF = /^([\w@./{}-]+\.(?:js|mjs|json|html|css|sql|xml|md|xsd|wsdl|yaml|yml|txt))(?::(\d+)(?:-\d+)?)?$/;

  // ── light colouring of code: strings, comments, numbers, keywords (per language) ──
  var KW = {
    js: 'async await break case catch class const continue default define delete do else export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield',
    sql: 'select from where and or not in is null as join left right inner outer full on group by order having union all distinct insert into values update set delete create table view index alter drop with case when then else end exists between like limit offset fetch first rows only desc asc count sum avg min max nvl coalesce to_char to_date sysdate',
    java: 'public private protected class interface extends implements static final void int long boolean new return if else for while try catch throw throws import package null true false this super',
    py: 'def class return if elif else for while in not and or import from as with try except finally raise none true false lambda yield pass break continue',
    sh: 'if then else fi for do done while case esac function in echo export cd ls cat grep sed awk curl'
  };
  KW.javascript = KW.js; KW.ts = KW.js; KW.typescript = KW.js; KW.json = 'true false null'; KW.plsql = KW.sql; KW.bash = KW.sh; KW.shell = KW.sh; KW.python = KW.py;
  function colour(code, lang) {
    var l = String(lang || '').toLowerCase();
    if (/^(xml|html|xsd|wsdl|svg)$/.test(l)) {
      return esc(code).replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="nx-md-c">$1</span>')
        .replace(/(&lt;\/?)([\w:.-]+)/g, '$1<span class="nx-md-k">$2</span>')
        .replace(/([\w:.-]+)=(&quot;[^&]*?&quot;)/g, '<span class="nx-md-a">$1</span>=<span class="nx-md-s">$2</span>');
    }
    if (l === 'http') {
      return esc(code).replace(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)(\s)/m, '<span class="nx-md-k">$1</span>$2').replace(/^([\w-]+)(:\s)/gm, '<span class="nx-md-a">$1</span>$2');
    }
    var words = (KW[l] || (l ? '' : KW.js)).split(' ').filter(Boolean);
    if (!words.length && l !== 'json') return esc(code);
    var kw = {};
    words.forEach(function (w) { kw[w] = true; });
    var sqlish = /sql/.test(l);
    var re = sqlish ? /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w$]*)/g
      : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*(?=\n|$))|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;
    var out = '', last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      if (m[1] && !(m[1].charAt(0) === '#' && !/^(py|python|sh|bash|shell|yaml|yml)$/.test(l))) out += '<span class="nx-md-c">' + esc(m[1]) + '</span>';
      else if (m[1]) out += esc(m[1]);
      else if (m[2]) out += (l === 'json' && /^\s*:/.test(code.slice(re.lastIndex)) ? '<span class="nx-md-a">' : '<span class="nx-md-s">') + esc(m[2]) + '</span>';
      else if (m[3]) out += '<span class="nx-md-n">' + m[3] + '</span>';
      else if (m[4]) out += kw[sqlish ? m[4].toLowerCase() : m[4]] ? '<span class="nx-md-k">' + esc(m[4]) + '</span>' : esc(m[4]);
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }

  // ── inline: code spans first (kept as they are), then the rest ──
  function inline(text, o) {
    var codes = [];
    var t = String(text == null ? '' : text).replace(/`([^`\n]+)`/g, function (m, c) { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    var links = [];
    t = t.replace(/\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/g, function (m, label, url) {
      if (!/^(https?:\/\/|mailto:)/i.test(url)) return label;
      links.push({ label: label, url: url });
      return '\u0001' + (links.length - 1) + '\u0001';
    });
    t = esc(t);
    t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])/g, function (m, pre, url) { return pre + '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>'; });
    t = t.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+?)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_\n]*?)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');
    var cites = (o && o.cites) || [];
    t = t.replace(/\[(\d{1,3})\]/g, function (m, n) { return cites.indexOf(Number(n)) !== -1 ? '<button type="button" class="nx-md-cite" data-cite="' + n + '" title="Source ' + n + '">' + n + '</button>' : m; });
    t = t.replace(/\u0001(\d+)\u0001/g, function (m, i) { var l = links[Number(i)]; return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + inline(l.label, {}) + '</a>'; });
    return t.replace(/\u0000(\d+)\u0000/g, function (m, i) {
      var c = codes[Number(i)];
      var f = FILE_REF.exec(c.trim());
      if (f && /\//.test(f[1])) return '<button type="button" class="nx-md-fileref" data-path="' + esc(f[1]) + '" data-line="' + (f[2] || '') + '" title="Open ' + esc(f[1]) + (f[2] ? ' at line ' + f[2] : '') + '"><code>' + esc(c) + '</code></button>';
      return '<code>' + esc(c) + '</code>';
    });
  }

  // ── a ```flow block: "From -> To: what happens" per line, drawn as steps between boxes ──
  function flow(body, o) {
    var rows = String(body).split('\n').map(function (l) { return l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim(); }).filter(Boolean);
    return '<div class="nx-md-flow" role="list">' + rows.map(function (l, i) {
      var m = /^(.+?)\s*(?:->|→|=>|—>)\s*(.+?)(?:\s*:\s*(.+))?$/.exec(l);
      if (!m) return '<div class="nx-md-fstep" role="listitem"><span class="nx-md-fnum">' + (i + 1) + '</span><span class="nx-md-ftext">' + inline(l, o) + '</span></div>';
      return '<div class="nx-md-fstep" role="listitem"><span class="nx-md-fnum">' + (i + 1) + '</span><span class="nx-md-fnode">' + inline(m[1], o) + '</span>'
        + '<span class="nx-md-farrow"><span class="nx-md-flabel">' + (m[3] ? inline(m[3], o) : '') + '</span></span><span class="nx-md-fnode">' + inline(m[2], o) + '</span></div>';
    }).join('') + '</div>';
  }

  function codeBlock(code, lang, o) {
    var l = String(lang || '').trim().split(/\s+/)[0].toLowerCase();
    if (l === 'flow') return flow(code, o);
    return '<div class="nx-md-code"><div class="nx-md-codehead"><span class="nx-md-lang">' + esc(l || 'text') + '</span><button type="button" class="nx-md-copy" data-copy="1" title="Copy this code">Copy</button></div>'
      + '<pre><code>' + colour(code, l) + '</code></pre></div>';
  }

  var cellsOf = function (line) { var s = line.trim().replace(/^\|/, '').replace(/\|$/, ''); var out = [], cur = '', code = false; for (var i = 0; i < s.length; i++) { var ch = s.charAt(i); if (ch === '`') code = !code; if (ch === '\\' && s.charAt(i + 1) === '|') { cur += '|'; i++; continue; } if (ch === '|' && !code) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; };
  var isSep = function (line) { return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && /-/.test(line) && /\||-{3}/.test(line); };
  var LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;

  /** A list starting at line i: nested by indentation; { html, next }. */
  function list(lines, i, o) {
    var first = LIST.exec(lines[i]);
    var base = first[1].length, ordered = /\d/.test(first[2]);
    var startN = ordered ? parseInt(first[2], 10) : 1;
    var items = [];
    while (i < lines.length) {
      var m = LIST.exec(lines[i]);
      if (m && m[1].length < base) break;
      if (m && m[1].length === base) {
        if (/\d/.test(m[2]) !== ordered) break;
        items.push({ text: m[3], sub: [] });
        i++;
        continue;
      }
      if (m && m[1].length > base && items.length) { var r = list(lines, i, o); items[items.length - 1].sub.push(r.html); i = r.next; continue; }
      if (!m && lines[i].trim() && /^\s+/.test(lines[i]) && items.length) { items[items.length - 1].text += ' ' + lines[i].trim(); i++; continue; }
      break;
    }
    var html = items.map(function (it) {
      var task = /^\[( |x|X)\]\s+(.*)$/.exec(it.text);
      var body = task ? '<input type="checkbox" disabled' + (task[1] !== ' ' ? ' checked' : '') + '> ' + inline(task[2], o) : inline(it.text, o);
      return '<li' + (task ? ' class="nx-md-task"' : '') + '>' + body + it.sub.join('') + '</li>';
    }).join('');
    return { html: ordered ? '<ol' + (startN !== 1 ? ' start="' + startN + '"' : '') + '>' + html + '</ol>' : '<ul>' + html + '</ul>', next: i };
  }

  function blocks(md, o) {
    var lines = String(md == null ? '' : md).replace(/\r/g, '').replace(/\t/g, '    ').split('\n');
    var out = [], para = [];
    var flush = function () { if (para.length) { out.push('<p>' + para.map(function (l) { return inline(l.trim(), o); }).join(' ').replace(/ {2,}$/, '') + '</p>'); para = []; } };
    for (var i = 0; i < lines.length;) {
      var line = lines[i];
      var fence = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/.exec(line);
      if (fence) {
        flush();
        var body = [], j = i + 1;
        while (j < lines.length && lines[j].trim().indexOf(fence[1]) !== 0) { body.push(lines[j]); j++; }
        out.push(codeBlock(body.join('\n'), fence[2], o));
        i = j + 1;
        continue;
      }
      if (!line.trim()) { flush(); i++; continue; }
      var h = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (h) { flush(); var lv = Math.min(5, Math.max(3, h[1].length + 1)); out.push('<h' + lv + '>' + inline(h[2], o) + '</h' + lv + '>'); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
      if (/^\s*>/.test(line)) {
        flush();
        var q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        var co = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i.exec(q[0] || '');
        if (co) {
          var kind = co[1].toUpperCase();
          var rest = [co[2]].concat(q.slice(1)).join('\n').trim();
          out.push('<div class="nx-md-callout nx-md-callout--' + kind.toLowerCase() + '" role="note"><div class="nx-md-callhead">' + CALLOUTS[kind] + '</div>' + blocks(rest, o) + '</div>');
        } else out.push('<blockquote>' + blocks(q.join('\n'), o) + '</blockquote>');
        continue;
      }
      if (/\|/.test(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
        flush();
        var head = cellsOf(line);
        var align = cellsOf(lines[i + 1]).map(function (c) { return /^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : ''; });
        var rows = [];
        i += 2;
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) { rows.push(cellsOf(lines[i])); i++; }
        var td = function (tag, c, k) { return '<' + tag + (align[k] ? ' style="text-align:' + align[k] + '"' : '') + '>' + inline(c, o) + '</' + tag + '>'; };
        out.push('<div class="nx-md-tablewrap"><table class="nx-md-table"><thead><tr>' + head.map(function (c, k) { return td('th', c, k); }).join('') + '</tr></thead><tbody>'
          + rows.map(function (r) { return '<tr>' + head.map(function (x, k) { return td('td', r[k] == null ? '' : r[k], k); }).join('') + '</tr>'; }).join('') + '</tbody></table></div>');
        continue;
      }
      if (LIST.test(line)) { flush(); var r = list(lines, i, o); out.push(r.html); i = r.next; continue; }
      para.push(line);
      i++;
    }
    flush();
    return out.join('\n');
  }

  function render(md, opts) { return blocks(md, opts || {}); }

  // Copy on a code block: its code, as text (installed once per document)
  var installed = false;
  function install() {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.nx-md-copy') : null;
      if (!b) return;
      var pre = b.closest('.nx-md-code') ? b.closest('.nx-md-code').querySelector('pre') : null;
      var text = pre ? pre.textContent : '';
      var done = function () { b.textContent = 'Copied'; b.classList.add('nx-md-copy--done'); setTimeout(function () { b.textContent = 'Copy'; b.classList.remove('nx-md-copy--done'); }, 1500); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallback(text); done(); });
        else { fallback(text); done(); }
      } catch (x) { fallback(text); done(); }
    });
  }
  function fallback(text) { try { var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); } catch (e) { /* nothing to copy with */ } }

  /** The answer as plain text (to copy into an e-mail or Teams): Markdown marks taken out, lists and code kept. */
  function plain(md) {
    return String(md == null ? '' : md).replace(/```\w*\n?/g, '').replace(/^\s*#{1,6}\s+/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
      .replace(/^\s*>\s?\[!(\w+)\]\s*/gm, function (m, k) { return (CALLOUTS[k.toUpperCase()] || k) + ': '; }).replace(/^\s*>\s?/gm, '').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)').trim();
  }

  return { render: render, inline: inline, colour: colour, install: install, plain: plain, esc: esc };
});
