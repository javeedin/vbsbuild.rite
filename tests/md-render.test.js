#!/usr/bin/env node
'use strict';
/**
 * Markdown → HTML for the AI Assistant's answers (webApps/buildrite/resources/js/mdRender.js): headings, paragraphs,
 * bold / italic / struck / code, links (only http, https, mailto), lists (nested, numbered from where they start, task
 * lists), tables (aligned, a | inside code kept), fenced code (its language, colours, Copy), callouts, quotes, rules, a
 * ```flow block drawn as steps, citations [n] (only the sources that exist), file references; and safe — every text
 * escaped, no HTML or script of the answer's own gets through; the answer as plain text.
 */
const fs = require('fs');
const path = require('path');
const H = require('./_harness');

const T = H.makeAsserter();
let M = null;
new Function('define', fs.readFileSync(path.join(__dirname, '..', 'webApps', 'buildrite', 'resources', 'js', 'mdRender.js'), 'utf8'))((d, f) => { M = f(); });
const r = (md, o) => M.render(md, o).replace(/\n/g, '');

T.section('text');
T.eq('headings (one level under the card\'s), a paragraph joined, bold / italic / struck / code', r('# Title\n## Part\nThe **key** point is *here*,\nand ~~not~~ `there`.'),
  '<h3>Title</h3><h3>Part</h3><p>The <strong>key</strong> point is <em>here</em>, and <del>not</del> <code>there</code>.</p>');
T.eq('links: http(s) and mailto open outside; any other kind is only its text; a bare address made a link',
  r('[docs](https://example.com/a) [bad](javascript:alert(1)) see https://example.com/b.'),
  '<p><a href="https://example.com/a" target="_blank" rel="noopener noreferrer">docs</a> bad see <a href="https://example.com/b" target="_blank" rel="noopener noreferrer">https://example.com/b</a>.</p>');
T.eq('a rule; a quote', r('one\n\n---\n\n> quoted **text**'), '<p>one</p><hr><blockquote><p>quoted <strong>text</strong></p></blockquote>');

T.section('lists');
T.eq('bullets nested by indentation, a line carried on', r('- one\n  - one a\n  - one b\n- two\n  still two'), '<ul><li>one<ul><li>one a</li><li>one b</li></ul></li><li>two still two</li></ul>');
T.eq('numbered from where it starts; task items', r('3. third\n4. fourth\n\n- [x] done\n- [ ] to do'), '<ol start="3"><li>third</li><li>fourth</li></ol><ul><li class="nx-md-task"><input type="checkbox" disabled checked> done</li><li class="nx-md-task"><input type="checkbox" disabled> to do</li></ul>');

T.section('tables');
T.eq('a table: its header, aligned columns, a | inside code kept', r('| Field | Type | Size |\n|:--|:-:|--:|\n| `a|b` | text | 10 |\n| id | number |'),
  '<div class="nx-md-tablewrap"><table class="nx-md-table"><thead><tr><th>Field</th><th style="text-align:center">Type</th><th style="text-align:right">Size</th></tr></thead>'
  + '<tbody><tr><td><code>a|b</code></td><td style="text-align:center">text</td><td style="text-align:right">10</td></tr><tr><td>id</td><td style="text-align:center">number</td><td style="text-align:right"></td></tr></tbody></table></div>');

T.section('code');
const js = r('```js\nconst a = "x"; // note\nreturn 42;\n```');
T.check('a code block: its language, a Copy button, colours (keyword, string, comment, number)', /<span class="nx-md-lang">js<\/span><button type="button" class="nx-md-copy"/.test(js)
  && /<span class="nx-md-k">const<\/span> a = <span class="nx-md-s">&quot;x&quot;<\/span>; <span class="nx-md-c">\/\/ note<\/span>/.test(js) && /<span class="nx-md-n">42<\/span>/.test(js), js);
const sql = r('```sql\nSELECT name FROM customers WHERE id = \'7\' -- one\n```');
T.check('…SQL: keywords any case, strings, comments', /<span class="nx-md-k">SELECT<\/span> name <span class="nx-md-k">FROM<\/span>/.test(sql) && /<span class="nx-md-s">'7'<\/span>/.test(sql) && /<span class="nx-md-c">-- one<\/span>/.test(sql), sql);
const json = r('```json\n{ "id": 7, "ok": true }\n```');
T.check('…JSON: keys, values', /<span class="nx-md-a">&quot;id&quot;<\/span>: <span class="nx-md-n">7<\/span>/.test(json) && /<span class="nx-md-k">true<\/span>/.test(json), json);
T.check('…XML and HTTP', /&lt;<span class="nx-md-k">item<\/span>/.test(r('```xml\n<item id="1"/>\n```')) && /<span class="nx-md-k">GET<\/span> \/shop/.test(r('```http\nGET /shop/v1/orders\nAccept: application/json\n```')));
T.eq('a file reference in code: a button the page can open', r('See `webApps/shop/flows/orders/pages/x-page.js:42` and `name`.'),
  '<p>See <button type="button" class="nx-md-fileref" data-path="webApps/shop/flows/orders/pages/x-page.js" data-line="42" title="Open webApps/shop/flows/orders/pages/x-page.js at line 42"><code>webApps/shop/flows/orders/pages/x-page.js:42</code></button> and <code>name</code>.</p>');

T.section('callouts, flows, citations');
T.eq('callouts: Note, Warning — their text rendered', r('> [!WARNING] Do **not** change it.\n> It is shared.'),
  '<div class="nx-md-callout nx-md-callout--warning" role="note"><div class="nx-md-callhead">Warning</div><p>Do <strong>not</strong> change it. It is shared.</p></div>');
const fl = r('```flow\nNew Order page -> Shop REST: GET /customers\n2. Shop REST -> BI Publisher: run CUSTOMERS_RP\nThe clerk checks the credit\n```');
T.check('a flow: each step numbered, from → to with what happens; a step without an arrow as text', (fl.match(/class="nx-md-fstep"/g) || []).length === 3
  && /<span class="nx-md-fnode">New Order page<\/span><span class="nx-md-farrow"><span class="nx-md-flabel">GET \/customers<\/span><\/span><span class="nx-md-fnode">Shop REST<\/span>/.test(fl) && /<span class="nx-md-ftext">The clerk checks the credit<\/span>/.test(fl), fl);
T.eq('citations: only sources that exist become chips', r('Yes [2], not [9].', { cites: [1, 2] }), '<p>Yes <button type="button" class="nx-md-cite" data-cite="2" title="Source 2">2</button>, not [9].</p>');

T.section('safe');
const bad = r('<script>alert(1)</script> <img src=x onerror=alert(1)> **<b>x</b>**\n\n| <i>a</i> |\n|--|\n| "q" |\n\n```html\n<script>x</script>\n```');
T.check('no HTML of the answer\'s own gets through: script, an image\'s handler, tags in a table or code — all shown as text', !/<script|<img|<b>|<i>/.test(bad) && /&lt;script&gt;alert\(1\)&lt;\/script&gt;/.test(bad) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(bad), bad);
T.check('…nor a link that runs code, nor an attribute broken out of', !/href="javascript/i.test(r('[x](javascript:alert(1)) [y](JAVASCRIPT:1)')) && !/"\s*onclick/.test(r('[a](https://x.example/"onclick="alert(1))')));
T.eq('the answer as plain text (to paste into an e-mail)', M.plain('## Steps\n1. **Open** `the page`\n> [!TIP] Save first\n[docs](https://example.com)'), 'Steps\n1. Open the page\nTip: Save first\ndocs (https://example.com)');
T.report();
