#!/usr/bin/env node
'use strict';
/**
 * Build.Rite as the desktop app serves it: its name, its menu (SQL last, after Flows explained), the Jira updates bell,
 * Issues first and pinned, no business actions of any app, your menu (who you are, your look — no versions of another
 * app), Application pages with no workspace set up, the pages' headers, and Flows explained (each flow step by step, and
 * played). Needs npm run build.
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const BUILD_SCREENS = ['projects', 'run-console', 'issues', 'jira', 'minutes', 'followups', 'app-pages', 'fdd-library', 'flows', 'sql'];

(async () => {
  // Jira (the fake backend): one story changed lately — created, moved, assigned to me, commented — and one older story
  const H0 = Date.now();
  const ago = (h) => new Date(H0 - h * 3600000).toISOString().replace('Z', '+0000');
  const ME = { accountId: 'me-1', displayName: 'Priya Raman' };
  const BEN = { accountId: 'u-2', displayName: 'Ben Ortiz' };
  const feedIssues = [
    { key: 'ABC-41', fields: { summary: 'Rental rates by branch', issuetype: { name: 'Story' }, status: { name: 'In Progress' }, priority: { name: 'High' }, assignee: ME, reporter: BEN, created: ago(5), updated: ago(1),
      comment: { comments: [{ created: ago(1), author: BEN, body: 'Can we show the FDD rates too?' }] } },
      changelog: { histories: [{ created: ago(4), author: BEN, items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }, { field: 'assignee', to: 'me-1', toString: 'Priya Raman' }] }] } },
    { key: 'ABC-12', fields: { summary: 'Billing totals', issuetype: { name: 'Bug' }, status: { name: 'Done' }, assignee: BEN, created: ago(300), updated: ago(30) },
      changelog: { histories: [{ created: ago(30), author: ME, items: [{ field: 'status', fromString: 'In Review', toString: 'Done' }] }] } },
  ];
  const env = await E.start({ port: 19880, handle: (r, res) => {
    if (r.path === '/rest/api/2/myself') return res.json(ME);
    if (r.path === '/rest/api/2/search/jql' && r.query.get('expand') === 'changelog') return res.json({ issues: feedIssues, isLast: true });
    return false;
  } });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('Build.Rite, as the desktop app serves it');
    await env.open('/');
    await page.waitForSelector('#nxNav [data-nav-id]', { timeout: 30000 });
    await page.waitForSelector('.nx-tab-btn', { timeout: 30000 }).catch(() => {});
    T.check('its name: Build.Rite, "for the team" (the window\'s title too)', /Build\.Rite\s*for the team/.test(await text(page, '#nxBrandBuild')) && (await page.title()) === 'Build.Rite'
      && (await page.evaluate(() => document.documentElement.getAttribute('data-nx-product'))) === 'buildrite');
    const items = await page.$$eval('#nxNav [data-nav-id]', (b) => b.map((x) => x.getAttribute('data-nav-id')));
    T.check('no help foot of another app at the foot of the menu', !(await page.$('#nxNavHelp')));
    T.eq('its screens in the menu, in order', items.join(','), BUILD_SCREENS.join(','));
    T.check('SQL last, after Flows explained (Tools)', items[items.length - 1] === 'sql' && items[items.length - 2] === 'flows', items.join(','));
    await page.click('#nxNav [data-nav-id="sql"]');
    await page.waitForSelector('#sqlSub', { timeout: 15000 }).catch(() => {});
    T.check('…and opens the SQL worksheet', !!(await page.$('#sqlSub')) && !!(await page.$('.nx-tab[data-tab-id="sql"]')));
    // the Jira updates bell: what changed in Jira lately, counted until it is opened
    await page.waitForSelector('#nxJiraCount', { timeout: 10000 }).catch(() => {});
    T.check('the Jira updates bell: what changed lately, counted (never opened: all 5)', (await text(page, '#nxJiraCount')) === '5', await text(page, '#nxJiraCount'));
    await page.click('#nxJiraBell');
    await page.waitForSelector('#nxJiraList .nx-jfeed-item', { timeout: 10000 });
    const feed = await text(page, '#nxJiraList');
    T.check('…opened: by day, newest first — the comment, the status change and the assignment to me (one edit, in Jira\'s order), the new story; the older story\'s change',
      /^Today\s*ABC-41\s*Rental rates by branch\s*Can we show the FDD rates too\?\s*Ben Ortiz · \d\d:\d\d · Story · yours[\s\S]*To Do → In Progress[\s\S]*Assigned to Priya Raman[\s\S]*New story · High · for Priya Raman/.test(feed)
      && /ABC-12\s*Billing totals\s*In Review → Done/.test(feed), feed.slice(0, 400));
    T.check('…its kinds, with how many', /All 5\s*Mine 4\s*New 1\s*Status 2\s*Assigned 1\s*Comments 1/.test(await text(page, '#nxJiraKinds')), await text(page, '#nxJiraKinds'));
    await page.click('#nxJiraKinds [data-key="status"]');
    T.check('…one kind: only the status changes', (await page.$$('#nxJiraList .nx-jfeed-item')).length === 2 && !/Can we show/.test(await text(page, '#nxJiraList')));
    await env.shot('buildrite-jira-bell.png');
    await page.click('#nxJiraKinds [data-key="all"]');
    await page.click('#nxJiraList .nx-jfeed-item--status:has-text("ABC-12")');
    await page.waitForSelector('.nx-tab--on[data-tab-id="jira"]', { timeout: 10000 }).catch(() => {});
    T.check('…an update opened: the story in Jira stories', !!(await page.$('.nx-tab--on[data-tab-id="jira"]')));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    T.check('…closed: all seen, no count; kept for next time', !(await page.$('#nxJiraPanel')) && !(await page.$('#nxJiraCount')) && !!(await page.evaluate(() => localStorage.getItem('buildrite.jiraSeen'))));
    await page.click('.nx-tab[data-tab-id="issues"] .nx-tab-btn').catch(() => page.click('.nx-tab[data-tab-id="issues"]'));
    const tabs = await page.$$eval('.nx-tab', (t) => t.map((x) => x.getAttribute('data-tab-id') + (x.classList.contains('nx-tab--pinned') ? '*' : '')));
    T.check('Issues is the first tab, pinned (no My work)', tabs[0] === 'issues*' && tabs.indexOf('home') === -1 && tabs.indexOf('home*') === -1, tabs.join(','));
    T.check('no business actions of any app: no New request, availability, cart, Help, phone QR code or notifications bell', !(await page.$('#nxNewRequest')) && !(await page.$('#nxQa')) && !(await page.$('#nxCart')) && !(await page.$('#nxHelp')) && !(await page.$('#nxPhone')) && !(await page.$('#nxBell')));
    T.check('the search finds Build.Rite\'s screens', (await page.getAttribute('#nxCommand', 'placeholder')) === 'Search Build.Rite screens…');
    await page.click('#nxUser');
    await page.waitForSelector('#nxProfilePanel', { timeout: 5000 });
    T.check('your menu: who you are and your look; no versions of another app to switch to', /Priya Raman|priya\.raman/.test(await text(page, '#nxProfilePanel')) && !!(await page.$('#nxLooks'))
      && !(await page.$('#nxGoBuild')) && !(await page.$('#nxGoNext')) && !(await page.$('#nxVersionsLabel')) && !/version/i.test(await text(page, '#nxProfilePanel')), await text(page, '#nxProfilePanel'));
    await page.keyboard.press('Escape');
    await page.click('.nx-backdrop').catch(() => {});
    await page.waitForSelector('#nxProfilePanel', { state: 'detached', timeout: 5000 }).catch(() => {});
    await page.click('#nxNav [data-nav-id="app-pages"]');
    await page.waitForSelector('#pgNoWorkspace', { timeout: 30000 }).catch(() => {});
    T.check('its screens open (Application pages: your workspace\'s pages — none set up yet, said)', !!(await page.$('#pgNoWorkspace')) && (await page.$$('#pgRows .nx-pg-row')).length === 0);
    const look = await page.evaluate(() => {
      const head = document.querySelector('.nx-pagehead');
      const after = head ? getComputedStyle(head, '::after') : null;
      return { strip: after ? after.backgroundImage : '', band: head ? getComputedStyle(head).backgroundColor : '', nav: getComputedStyle(document.getElementById('nxNav')).backgroundColor };
    });
    T.check('every page\'s header: Redwood\'s teal with Oracle\'s colour strip (no five-colour line); the menu the same teal', /colorstrip_redwood/.test(look.strip) && !/linear-gradient/.test(look.strip)
      && look.band === 'rgb(44, 82, 102)' && look.nav === look.band, JSON.stringify(look));
    for (const id of ['jira', 'fdd-library', 'minutes']) {
      await page.click('#nxNav [data-nav-id="' + id + '"]');
      await page.waitForTimeout(1500);
    }
    const heads = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.nx-pagehead'), (h) => getComputedStyle(h, '::after').backgroundImage));
    T.check('…on the other pages too (Jira stories, the FDD library, standup minutes)', heads.length >= 3 && heads.every((b) => /colorstrip_redwood/.test(b)), heads.length + ' ' + heads.map((b) => b.slice(0, 40)).join(' | '));
    await page.click('#nxNav [data-nav-id="jira"]');
    await page.waitForTimeout(800);
    await env.shot('buildrite-jira.png');

    // Flows explained: every flow of the team's tools, step by step
    await page.click('#nxNav [data-nav-id="flows"]');
    await page.waitForSelector('.nx-hw-flow', { timeout: 15000 });
    const flows = await page.$$eval('.nx-hw-flow', (s) => s.map((x) => x.id + ':' + x.querySelectorAll(':scope > .nx-hw-steps > .nx-hw-step').length));
    T.check('Flows explained: the ten flows, each step by step — your workspace first (6 steps), then Issues (10 steps, its side paths)', flows.length === 10 && flows[0] === 'hw-workspace:6' && flows[1] === 'hw-issues:10'
      && (await page.$$('#hw-issues .nx-hw-branch')).length === 5 && /Log it[\s\S]*Write it up[\s\S]*Analyze[\s\S]*Try it in a sandbox[\s\S]*Send for approval[\s\S]*Approve[\s\S]*Apply change[\s\S]*Pull request[\s\S]*Verify[\s\S]*Close/.test(await text(page, '#hw-issues .nx-hw-steps')), flows.join(','));
    T.check('…who does each step (You, AI, Agent, The app, Git, Jira), where it is kept, what Build.Rite works with', (await page.$$('#hwLegend .nx-hw-key')).length === 6 && /Agent/.test(await text(page, '#hw-issues .nx-hw-step--agent'))
      && /Where it is kept[\s\S]*issues\.json/.test(await text(page, '#hw-issues')) && /Jira[\s\S]*The AI[\s\S]*Microsoft 365[\s\S]*Git/.test(await text(page, '#hwLinks')));
    await env.shot('buildrite-flows.png');

    // Watch the flow: a tile plays it, animated
    await page.click('#hwIndex .nx-hw-tile[data-key="issues"]');
    await page.waitForFunction(() => { const d = document.getElementById('hwPlay'); return d && d.open && !!document.getElementById('hwPlayCard'); }, null, { timeout: 10000 });
    const p0 = await page.evaluate(() => ({ card: document.getElementById('hwPlayCard').textContent.replace(/\s+/g, ' ').trim(), prog: document.getElementById('hwPlayProgress').textContent.trim(),
      made: document.querySelectorAll('#hwPlayMade .nx-play-made').length, now: document.querySelectorAll('.nx-play-node--now').length, nodes: document.querySelectorAll('.nx-play-node').length, dot: getComputedStyle(document.getElementById('hwPlayDot')).left }));
    T.check('a tile plays its flow: a dialog, step 1 of 10 on show (who, what), the path of 10 with the first lit, the first thing it makes', p0.prog === 'Step 1 of 10' && /^You Step 1 Log it/.test(p0.card) && /Makes The issue, with its key/.test(p0.card)
      && p0.nodes === 10 && p0.now === 1 && p0.made === 1 && /Pause/.test(await text(page, '#hwPlayToggle')), JSON.stringify(p0));
    await page.waitForFunction(() => /Step 2 of 10/.test((document.getElementById('hwPlayProgress') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const p1 = await page.evaluate(() => ({ prog: document.getElementById('hwPlayProgress').textContent.trim(), card: document.getElementById('hwPlayCard').textContent, done: document.querySelectorAll('.nx-play-node--done').length,
      made: Array.prototype.map.call(document.querySelectorAll('#hwPlayMade .nx-play-made'), (m) => m.textContent.trim() + (m.classList.contains('nx-play-made--fresh') ? '*' : '')), dot: getComputedStyle(document.getElementById('hwPlayDot')).left }));
    T.check('…it moves on by itself: step 2 (the AI writes it up), the dot further along, what it made so far (the newest marked)', p1.prog === 'Step 2 of 10' && /Write it up/.test(p1.card) && p1.done === 1
      && p1.made.join('|') === 'The issue, with its key|Its write-up*' && parseFloat(p1.dot) > parseFloat(p0.dot), JSON.stringify([p1, p0.dot]));
    await page.click('#hwPlayToggle');
    await page.click('#hwPlayNext');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    T.check('paused; Next and → move on by hand (step 4: Try it in a sandbox)', /Play/.test(await text(page, '#hwPlayToggle')) && (await text(page, '#hwPlayProgress')) === 'Step 4 of 10' && /Try it in a sandbox/.test(await text(page, '#hwPlayCard')));
    for (let k = 0; k < 7; k++) await page.click('#hwPlayNext');
    await page.waitForSelector('#hwPlayEnd', { timeout: 5000 }).catch(() => {});
    T.check('its end: done, the other ways it can go, where it is kept; all 10 things it made', /That is the flow: Issues/.test(await text(page, '#hwPlayEnd')) && (await page.$$('#hwPlayEnd .nx-play-branch')).length === 5
      && /Where it is kept[\s\S]*issues\.json/.test(await text(page, '#hwPlayEnd')) && (await page.$$('#hwPlayMade .nx-play-made')).length === 10 && (await text(page, '#hwPlayProgress')) === 'Done · 10 steps' && await page.isDisabled('#hwPlayNext'));
    await page.waitForTimeout(1500); // its end slides in, and the dot finishes its run, before the picture
    await env.shot('buildrite-watch-end.png');
    await page.click('#hwPlayRestart');
    await page.waitForTimeout(300);
    T.check('from the start again, playing', (await text(page, '#hwPlayProgress')) === 'Step 1 of 10' && /Pause/.test(await text(page, '#hwPlayToggle')));
    await page.waitForTimeout(3300);
    await env.shot('buildrite-watch.png');
    await page.click('#hwPlayDetails');
    await page.waitForTimeout(600);
    T.check('"See the details" closes it, at the flow\'s section on the page', !(await page.evaluate(() => document.getElementById('hwPlay').open)) && await page.isVisible('#hw-issues'));
    await page.click('#hw-codefix .nx-hw-watchbtn');
    // its text changes as soon as the flow is chosen; the dialog opens a moment later (showModal, once drawn): wait for both
    await page.waitForFunction(() => document.getElementById('hwPlay').open && /Step 1 of 5/.test((document.getElementById('hwPlayProgress') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    T.check('each flow\'s "Watch the flow" plays it (Code fix: 5 steps)', /Code fix/.test(await text(page, '#hwPlayTitle')) && (await text(page, '#hwPlayProgress')) === 'Step 1 of 5');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    T.check('Escape closes it (and it stops)', !(await page.evaluate(() => document.getElementById('hwPlay').open)));
    await page.click('#hw-codefix .nx-hw-openbtn');
    await page.waitForSelector('#pgNoWorkspace', { timeout: 20000 }).catch(() => {});
    T.check('…and each one opens its screen (Code fix → Application pages)', !!(await page.$('.nx-tab--on[data-tab-id="app-pages"]')) && !(await page.evaluate(() => document.getElementById('hwPlay').open)));
    T.check('Application pages, no workspace set up: none shown (never Build.Rite\'s own pages) — Set up your workspace offered; no Rescan', !!(await page.$('#pgNoWorkspace')) && !(await page.$('#pgRows .nx-pg-row')) && !(await page.$('#pgApps'))
      && /No workspace set up/.test(await text(page, '#pgNoWorkspace')) && !!(await page.$('#pgSetupWs')) && !(await page.$('#pgRescan')) && /^No workspace set up/.test(await text(page, '#pgSub')), await text(page, '#pgSub'));
    await env.shot('buildrite.png');
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.message), false);
  } finally {
    await env.close();
  }

  T.report();
})();
