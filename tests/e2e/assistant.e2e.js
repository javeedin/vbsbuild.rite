#!/usr/bin/env node
'use strict';
/*
 * The AI Assistant, in a browser: Ctrl+J opens it from anywhere (the box ready to type in); questions to start with come
 * from the sample app itself; a question is answered by the AI of AI settings (a stand-in here) from what was gathered in
 * the workspace (the page named, its code with line numbers, its integration flow — numbered, with the formatting rules),
 * and shown formatted: headings, steps, a table, a code block with Copy, a drawn flow, a callout, citations and a file
 * reference that open the source (the code with its line marked, or what the AI was given, with Open), sources under
 * it, follow-up questions that ask; Enter sends; the scope (Process: the saved flow) and a page chosen; Ask again; an
 * answer copied; an AI that fails says so with Try again; conversations kept, opened again, removed.
 * Needs `npm run build`. Run: node tests/e2e/assistant.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const I = require('../../desktop/lib/integrations');

const T = H.makeAsserter();
const settle = (page, ms) => page.waitForTimeout(ms || 400);
const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-ask-e2e-'));
  const pg = await E.pagesSandbox();
  const flowStore = require('../../desktop/lib/savedFlows').open({ dir: path.join(dir, 'flows') });
  flowStore.save({ name: 'Order to cash', purpose: 'How an order is taken, invoiced and paid.', status: 'approved', lanes: [{ id: 'shop', name: 'Shop REST', kind: 'rest' }],
    actions: [{ id: 'a1', trigger: 'when the page opens', title: 'The clerk opens a new order', steps: [{ id: 's1', system: 'shop', method: 'GET', path: '/shop/v1/customers', endpoint: 'shopApi/getCustomers', object: 'Customers', direction: 'Read', text: 'Reads the customers and their credit' }] }],
    stickies: [{ id: 'n1', text: 'Credit hold blocks the invoice', color: 'pink' }] }, 'Priya Raman');
  // a stand-in AI (the OpenAI provider of AI settings): a rich answer that cites what it was given
  const asked = [];
  const llmFetch = async (url, init) => {
    const body = JSON.parse(String((init && init.body) || '{}'));
    const sys = ((body.messages || [])[0] || {}).content || '', user = ((body.messages || [])[body.messages.length - 1] || {}).content || '';
    asked.push({ sys, user });
    const q = (/QUESTION\n([\s\S]*)$/.exec(user) || [])[1] || '';
    if (/break it/i.test(q)) return { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'Incorrect API key provided' } }) };
    const num = (re) => ((new RegExp('\\[(\\d+)\\] ' + re)).exec(user) || [])[1] || '1';
    const nPage = num('Page: New Order'), nFile = num('webApps/shop/flows/orders/pages/order-create-page-chains/LoadCustomersChain\\.js'), nFlow = num('Saved flow FL-0001');
    const content = /invoice/i.test(q)
      ? 'An order is **invoiced after it is taken**, unless the customer is on credit hold [' + nFlow + '].\n\nSources: [' + nFlow + ']\n```followups\nWho releases a credit hold?\n```'
      : 'The **New Order** page loads the customers when it opens [' + nPage + '], with their credit from a report [' + nFile + '].\n\n## How it works\n1. `LoadCustomersChain` runs when the page opens [' + nPage + '].\n2. It calls **GET /shop/v1/customers**, then BI Publisher.\n\n'
        + '| Step | Call | System |\n|---|---|---|\n| 1 | GET /shop/v1/customers | Shop REST |\n| 2 | runBIPReport CUSTOMERS_RP | BI Publisher |\n\n'
        + '```js\nconst res = await Actions.callRest(context, { endpoint: \'shopApi/getCustomers\' });\n```\n\n```flow\nNew Order page -> Shop REST: GET /customers\nShop REST -> BI Publisher: CUSTOMERS_RP\n```\n\n'
        + '> [!TIP] The call is at `webApps/shop/flows/orders/pages/order-create-page-chains/LoadCustomersChain.js:7`.\n\nSources: [' + nPage + '], [' + nFile + ']\n```followups\nWhat does CUSTOMERS_RP return?\nHow is the order saved?\nWhich other pages call the shop?\n```';
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
  };
  const aiStore = await require('../../desktop/lib/aiSql').open({ file: path.join(dir, 'ai.json'), encrypt: (t) => Buffer.from(t), decrypt: (b) => String(b), fetch: llmFetch });
  aiStore.save({ provider: 'openai', key: 'sk-test', model: 'gpt-4o' });
  const assistantStore = require('../../desktop/lib/assistant').open({ dir: path.join(dir, 'assistant'), root: pg.root, pages: pg.store, flows: flowStore, ai: aiStore, scan: I.scan });
  const env = await E.start({ port: 19992, pagesStore: pg.store, aiStore, flowStore, assistantStore });
  const page = env.page;
  try { await page.context().grantPermissions(['clipboard-read', 'clipboard-write']); } catch (e) { /* not offered */ }
  page.on('dialog', (d) => d.accept());
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const turns = () => page.$$('#askThread .nx-ask-turn');
  const waitAnswer = async (n) => { await page.waitForFunction((k) => document.querySelectorAll('#askThread .nx-ask-turn').length >= k && !document.getElementById('askThinking'), n, { timeout: 30000 }); await settle(page, 400); };
  try {
    T.section('Ctrl+J, from anywhere');
    await env.open('/?open=issues');
    await page.waitForSelector('.nx-tab--on', { timeout: 30000 });
    await settle(page, 800);
    await page.keyboard.press('Control+j');
    await page.waitForSelector('#askInput', { timeout: 20000 });
    await settle(page, 900);
    T.check('the AI Assistant opens in its tab, its box ready to type in', /AI Assistant/.test(await text(page, '.nx-tab--on .nx-tab-title')) && (await page.evaluate(() => (document.activeElement || {}).id)) === 'askInput');
    T.check('…in the menu under Tools', /AI Assistant/.test(await text(page, '[data-nav-id="assistant"]')));
    T.check('which AI answers, from AI settings', /^Answers by ChatGPT \(OpenAI\) · gpt-4o \(the default\)$/.test(await text(page, '#askAi')), await text(page, '#askAi'));
    const sugg = await page.$$eval('#askSuggest .nx-ask-card', (l) => l.map((x) => x.innerText.trim()));
    T.check('questions to start with, from the app itself (its pages and systems)', /Ask anything about shop/.test(await text(page, '#askHello')) && sugg.length >= 4 && sugg.some((s) => /page work, step by step\?$/.test(s)) && sugg.some((s) => /^Which pages call /.test(s)), JSON.stringify(sugg));
    await env.shot('assistant-start.png');

    T.section('a question, answered from the workspace, formatted');
    await page.fill('#askInput', 'How does the New Order page load the customers and their credit status?');
    await page.press('#askInput', 'Enter');
    await page.waitForSelector('#askThinking', { timeout: 5000 }).catch(() => {});
    await waitAnswer(1);
    const a0 = asked[0];
    T.check('Enter sent it: the AI got the formatting rules and the context gathered — the page named, its code with line numbers, numbered', /Format the answer in GitHub-flavoured Markdown/.test(a0.sys) && /\[\d+\] Page: New Order\nPage "New Order"/.test(a0.user)
      && /\[\d+\] webApps\/shop\/flows\/orders\/pages\/order-create-page-chains\/LoadCustomersChain\.js\n\d+: /.test(a0.user) && /QUESTION\nHow does the New Order page load/.test(a0.user));
    const md = '#askThread .nx-ask-turn--last .nx-ask-md';
    T.check('the question as a bubble; the box emptied', /How does the New Order page load/.test(await text(page, '#askThread .nx-ask-q')) && (await page.inputValue('#askInput')) === '');
    T.check('formatted: the key point in bold, a heading, numbered steps, a table', (await text(page, md + ' p strong')) === 'New Order' && (await text(page, md + ' h3')) === 'How it works'
      && (await page.$$(md + ' ol li')).length === 2 && (await page.$$(md + ' .nx-md-table tbody tr')).length === 2 && /GET \/shop\/v1\/customers/.test(await text(page, md + ' .nx-md-table')));
    T.check('…a code block (its language, colours, Copy), a drawn flow, a callout', (await text(page, md + ' .nx-md-lang')) === 'js' && !!(await page.$(md + ' .nx-md-code .nx-md-k')) && (await page.$$(md + ' .nx-md-fstep')).length === 2
      && /^1 New Order page GET \/customers Shop REST$/.test(await text(page, md + ' .nx-md-fstep')) && /^tip/i.test(await text(page, md + ' .nx-md-callout--tip')));
    T.check('…no Sources line or follow-ups block left in the text; citations as chips', !/Sources:|followups/.test(await text(page, md)) && (await page.$$(md + ' .nx-md-cite')).length === 3);
    T.check('sources under it, the cited ones first; what else was looked at, folded; how it was answered', (await page.$$('#askThread .nx-ask-srcs > .nx-ask-src')).length === 2 && /Also looked at \(\d+\)/.test(await text(page, '.nx-ask-more summary'))
      && /^ChatGPT \(OpenAI\) · gpt-4o · [0-9.]+ s · \d+ items looked at/.test(await text(page, '.nx-ask-meta .nx-note')), await text(page, '.nx-ask-meta .nx-note'));
    T.check('follow-up questions to ask next', (await page.$$eval('#askFollow .nx-ask-fchip', (l) => l.map((x) => x.innerText.trim()))).join('|') === 'What does CUSTOMERS_RP return?|How is the order saved?|Which other pages call the shop?');
    await env.shot('assistant-answer.png');

    T.section('the sources');
    await page.click(md + ' .nx-md-fileref');
    await page.waitForSelector('#askSrc .nx-ask-ln--at', { timeout: 10000 });
    T.check('a file reference: the file, its lines numbered, the line marked', /LoadCustomersChain\.js · line 7$/.test(await text(page, '#askSrcTitle')) && (await text(page, '#askSrc .nx-ask-ln--at .nx-ask-lnno')) === '7'
      && /callRest/.test(await text(page, '#askSrc .nx-ask-ln--at')), await text(page, '#askSrcTitle'));
    await page.click('#askSrc .nx-dialog-head [data-act="srcClose"]');
    await settle(page);
    await page.click(md + ' .nx-md-cite');
    await page.waitForSelector('#askSrc', { timeout: 5000 });
    await settle(page);
    T.check('a citation: what the AI was given (the page\'s facts), with Open', /^Source \d+ · What the AI was given$/i.test(await text(page, '#askSrc .nx-kicker')) && /Page "New Order" \(shop\/orders\/order-create\)/.test(await text(page, '#askSrcText')) && !!(await page.$('#askSrcGo')));
    await page.click('#askSrc .nx-dialog-head [data-act="srcClose"]');
    await settle(page);
    await page.click('#askThread .nx-ask-srcs > .nx-ask-src:nth-of-type(2)');
    await page.waitForSelector('#askSrc .nx-ask-code', { timeout: 10000 });
    T.check('a source chip (code): the file, the first matching line marked', /LoadCustomersChain\.js/.test(await text(page, '#askSrcTitle')) && !!(await page.$('#askSrc .nx-ask-ln--at')));
    await page.click('#askSrc .nx-dialog-head [data-act="srcClose"]');
    await settle(page);

    T.section('copy, follow up, ask again');
    await page.click(md + ' .nx-md-copy');
    await settle(page, 300);
    T.check('Copy on a code block: copied', (await text(page, md + ' .nx-md-copy')) === 'Copied');
    await page.click('#askFollow .nx-ask-fchip');
    await waitAnswer(2);
    T.check('a follow-up asks it, the conversation so far sent with it', (await turns()).length === 2 && /CONVERSATION SO FAR\n\nQ: How does the New Order page load/.test(asked[1].user) && /QUESTION\nWhat does CUSTOMERS_RP return\?$/.test(asked[1].user));
    await page.click('#askAgain');
    await waitAnswer(2);
    T.check('Ask again: the last question again, its answer replaced (not added)', (await turns()).length === 2 && /QUESTION\nWhat does CUSTOMERS_RP return\?$/.test(asked[2].user));

    T.section('scope and page');
    await page.click('.nx-ask-scope[data-key="process"]');
    await page.fill('#askInput', 'When is an order invoiced?');
    await page.click('#askSend');
    await waitAnswer(3);
    T.check('Process: the saved flow looked at (its steps and notes); the answer cites it', /scope: process/.test(asked[3].user) && /\[\d+\] Saved flow FL-0001: Order to cash/.test(asked[3].user) && /Credit hold blocks the invoice/.test(asked[3].user)
      && /invoiced after it is taken/.test(await text(page, md)) && /Saved flow FL-0001/.test(await text(page, '#askThread .nx-ask-turn--last .nx-ask-srcs')) && /^Process$/.test(await text(page, '#askThread .nx-ask-turn--last .nx-ask-qtags')));
    await page.click('.nx-ask-scope[data-key="all"]');
    await page.selectOption('#askPage', 'shop/orders/order-detail');
    await settle(page);
    await page.fill('#askInput', 'What does it show?');
    await page.press('#askInput', 'Enter');
    await waitAnswer(4);
    T.check('a page chosen: it is looked at, said in the question', /about the page Order\)/.test(asked[4].user) && /\[\d+\] Page: Order\n/.test(asked[4].user) && /Page: Order/.test(await text(page, '#askThread .nx-ask-turn--last .nx-ask-qtags')));
    await page.selectOption('#askPage', '');

    T.section('an AI that fails');
    await page.fill('#askInput', 'Please break it');
    await page.press('#askInput', 'Enter');
    await waitAnswer(5);
    T.check('not answered: why, with Try again and AI settings', /^Not answered\. .*Incorrect API key provided/.test(await text(page, '#askThread .nx-ask-turn--last .nx-ask-err')) && !!(await page.$('#askThread .nx-ask-turn--last [data-act="again"]')), await text(page, '#askThread .nx-ask-turn--last .nx-ask-err'));
    await env.shot('assistant-conversation.png');

    T.section('conversations');
    T.check('kept on this PC: in the list, its title from the first question', (await page.$$('#askConvs .nx-ask-conv')).length === 1 && /How does the New Order page load/.test(await text(page, '#askConvs .nx-ask-convtitle')) && /5 questions/.test(await text(page, '#askConvs .nx-ask-conv small')));
    await page.click('#askNew');
    await settle(page);
    T.check('New chat: a clean start', (await turns()).length === 0 && !!(await page.$('#askHello')));
    await page.click('#askConvs .nx-ask-convbtn');
    await page.waitForSelector('#askThread .nx-ask-turn', { timeout: 5000 });
    await settle(page);
    T.check('opened again: every question and answer, formatted', (await turns()).length === 5 && !!(await page.$('#askThread .nx-ask-turn:first-child .nx-md-table')));
    await page.hover('#askConvs .nx-ask-conv');
    await page.click('#askConvs .nx-ask-convx');
    await settle(page, 600);
    T.check('removed', (await page.$$('#askConvs .nx-ask-conv')).length === 0 && !!(await page.$('#askHello')) && assistantStore.list().convs.length === 0);

    T.check('no page errors', errs().length === 0, errs().slice(0, 3).join(' | '));
  } catch (e) {
    T.check('no exception: ' + e.message, false);
    await env.shot('assistant-failed.png').catch(() => {});
  } finally {
    await env.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  T.report();
})();
