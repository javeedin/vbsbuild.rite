#!/usr/bin/env node
'use strict';
/**
 * Build.Rite's shell, in a browser: it opens on Issues (pinned); the menu's groups and screens (Workspace, Work,
 * Application, Tools); the search box (Ctrl K) finds a screen by its name or keywords and opens it; who you are — your
 * name and email, from /_currentuser (the desktop app: your git name and email) — in the top bar and your menu; your look;
 * the menu folded to icons and back; nothing of another app anywhere on the page. Needs npm run build.
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');

(async () => {
  const env = await E.start({ port: 19960, username: 'priya.raman@example.com', fullName: 'Priya Raman', email: 'priya.raman@example.com' });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('opening');
    await env.open('/');
    await page.waitForSelector('.nx-tab', { timeout: 30000 });
    T.check('the window: Build.Rite', (await page.title()) === 'Build.Rite' && /Build\.Rite/.test(await text(page, '#nxBrandBuild')));
    const tabs = await page.$$eval('.nx-tab', (t) => t.map((x) => x.getAttribute('data-tab-id') + (x.classList.contains('nx-tab--pinned') ? '*' : '') + (x.classList.contains('nx-tab--on') ? '!' : '')));
    T.check('it opens on Issues, pinned and shown', tabs[0] === 'issues*!' && tabs.length === 1, tabs.join(','));

    T.section('the menu');
    const groups = await page.$$eval('.nx-nav-label', (l) => l.map((x) => x.textContent.trim()));
    T.eq('its groups', groups.join(' | '), 'Workspace | Work | Application | Tools');
    const items = await page.$$eval('.nx-nav-item', (b) => b.map((x) => x.getAttribute('data-nav-id')));
    T.eq('its screens, in order', items.join(','), 'projects,run-console,issues,jira,minutes,followups,app-pages,fdd-library,flows,sql,ai');
    T.check('the open screen\'s item marked', /nx-nav-item--on/.test((await page.getAttribute('.nx-nav-item[data-nav-id="issues"]', 'class')) || ''));
    await page.click('.nx-nav-item[data-nav-id="minutes"]');
    await page.waitForSelector('.nx-tab--on[data-tab-id="minutes"]', { timeout: 15000 }).catch(() => {});
    T.check('an item opens its screen in a tab of its own (Issues kept)', !!(await page.$('.nx-tab--on[data-tab-id="minutes"]')) && !!(await page.$('.nx-tab[data-tab-id="issues"]')));
    await page.click('#nxNavToggle');
    await page.waitForTimeout(300);
    T.check('folded to icons, and back', !!(await page.$('.nx-app--rail')) && (await page.evaluate(() => localStorage.getItem('buildrite.nav'))) === 'rail');
    await page.click('#nxNavToggle');
    await page.waitForTimeout(300);
    T.check('…unfolded', !(await page.$('.nx-app--rail')) && (await page.evaluate(() => localStorage.getItem('buildrite.nav'))) === 'full');

    T.section('the search box');
    T.eq('it searches Build.Rite\'s screens', await page.getAttribute('#nxCommand', 'placeholder'), 'Search Build.Rite screens…');
    await page.keyboard.press('Control+k');
    T.check('Ctrl K: the box focused', await page.evaluate(() => document.activeElement && document.activeElement.id === 'nxCommand'));
    await page.keyboard.type('terminal');
    await page.waitForSelector('#nxResults .nx-gs-row', { timeout: 5000 }).catch(() => {});
    const res = await page.$$eval('#nxResults .nx-gs-row', (r) => r.map((x) => x.getAttribute('data-key')));
    T.check('a keyword finds its screen (the Run console: "terminal"), under Screens, said what it searched', res.join() === 'nav:run-console' && /Screens\s*1/.test(await text(page, '#nxResults .nx-gs-head'))
      && /Searches Build\.Rite's screens/.test(await text(page, '#nxResultsFoot')), res.join());
    await page.keyboard.press('Enter');
    await page.waitForSelector('.nx-tab--on[data-tab-id="run-console"]', { timeout: 15000 }).catch(() => {});
    T.check('Enter opens it; the box cleared and closed', !!(await page.$('.nx-tab--on[data-tab-id="run-console"]')) && !(await page.$('#nxResults')) && (await page.inputValue('#nxCommand')) === '');
    await page.click('#nxCommand');
    await page.keyboard.type('jira');
    await page.waitForSelector('#nxResults .nx-gs-row', { timeout: 5000 }).catch(() => {});
    T.check('a name: that screen first', ((await page.$$eval('#nxResults .nx-gs-row', (r) => r.map((x) => x.getAttribute('data-key'))))[0] || '') === 'nav:jira');
    await page.click('#nxResults .nx-gs-row[data-key="nav:jira"]');
    await page.waitForSelector('.nx-tab--on[data-tab-id="jira"]', { timeout: 15000 }).catch(() => {});
    T.check('…clicked: opened', !!(await page.$('.nx-tab--on[data-tab-id="jira"]')));
    await page.click('#nxCommand');
    await page.keyboard.type('fleet');
    await page.waitForSelector('#nxResultsEmpty', { timeout: 5000 }).catch(() => {});
    T.check('a word no screen has: nothing matches, said', /Nothing matches “fleet”/.test(await text(page, '#nxResultsEmpty')) && (await page.$$('#nxResults .nx-gs-row')).length === 0);
    await page.keyboard.press('Escape');

    T.section('who you are');
    T.check('the top bar: your initials, name and email (from /_currentuser)', (await text(page, '#nxUser .nx-avatar')) === 'PR' && (await text(page, '#nxUser .nx-user-name')) === 'Priya Raman'
      && (await text(page, '#nxUser .nx-user-role')) === 'priya.raman@example.com', await text(page, '#nxUser'));
    await page.click('#nxUser');
    await page.waitForSelector('#nxProfilePanel', { timeout: 5000 });
    T.check('your menu: your name and email, your look and colours — nothing to switch to', /Priya Raman/.test(await text(page, '#nxProfileName')) && /priya\.raman@example\.com/.test(await text(page, '#nxProfilePanel'))
      && !!(await page.$('#nxLooks')) && !(await page.$('#nxVersionsLabel')) && !(await page.$('#nxGoNext')), await text(page, '#nxProfilePanel'));
    await env.shot('shell-profile.png');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#nxProfilePanel', { state: 'detached', timeout: 5000 }).catch(() => {});

    T.section('nothing of another app');
    const all = await page.evaluate(() => document.body.innerText + ' ' + Array.prototype.map.call(document.querySelectorAll('[title],[aria-label],[placeholder]'), (e) => [e.title, e.getAttribute('aria-label'), e.getAttribute('placeholder')].join(' ')).join(' '));
    T.check('no other product named on the page (its text, titles, labels, placeholders)', !/equip\s*rite|Old app|New app|requests|availability|yard/i.test(all), (all.match(/.{0,40}(equip\s*rite|requests|availability|yard).{0,40}/i) || [''])[0]);
    T.check('no business actions in the top bar', !(await page.$('#nxNewRequest')) && !(await page.$('#nxQa')) && !(await page.$('#nxCart')) && !(await page.$('#nxPhone')) && !(await page.$('#nxBell')) && !(await page.$('#nxHelp')));
    await env.shot('shell.png');
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.message), false);
  } finally {
    await env.close();
  }
  T.report();
})();
