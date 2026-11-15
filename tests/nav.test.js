/*
 * Build.Rite's menu (webApps/buildrite/resources/js/nav.js): its groups — Workspace, Work, Application, Tools — and
 * their screens, each opening a page that exists; the records that open in tabs of their own; the search box's matches;
 * every item shown (Build.Rite runs on this PC for the person using it: no page access to load); Issues first.
 *
 * Run:  node tests/nav.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
let N = null;
vm.runInNewContext(fs.readFileSync(path.join(H.APP, 'resources', 'js', 'nav.js'), 'utf8'), { define: (deps, f) => { N = f(); } });
const flowPages = (flow) => { try { return Object.keys(JSON.parse(fs.readFileSync(path.join(H.APP, 'flows', flow, flow + '-flow.json'), 'utf8')).pages || {}); } catch (e) { return []; } };
const exists = (route) => flowPages(route.flow).indexOf(route.page) !== -1;

T.section('the groups and their screens');
T.eq('four groups, in order', N.GROUPS.map((g) => g.label).join(' | '), 'Workspace | Work | Application | Tools');
T.eq('Workspace', N.GROUPS[0].items.map((i) => i.label).join(', '), 'Organizations & projects, Run console');
T.eq('Work', N.GROUPS[1].items.map((i) => i.label).join(', '), 'Issues, Jira stories, Standup minutes, Follow-ups');
T.eq('Application', N.GROUPS[2].items.map((i) => i.label).join(', '), 'Application pages, FDD library, Flows explained');
T.eq('Tools', N.GROUPS[3].items.map((i) => i.label).join(', '), 'SQL');
const items = N.GROUPS.reduce((a, g) => a.concat(g.items), []);
T.check('every item: an id, an icon, keywords, and a page that exists in its flow', items.every((i) => i.id && /^oj-ux-ico-/.test(i.icon) && i.keywords && exists(i.route)),
  items.filter((i) => !exists(i.route)).map((i) => i.id).join());
T.check('…each id once; item() finds it; its group named on it', new Set(items.map((i) => i.id)).size === items.length && items.every((i) => N.item(i.id) === i && N.GROUPS.some((g) => g.key === i.group)));
T.check('no access to load: every item shown, whatever is asked', items.every((i) => N.itemVisible(i)) && !N.itemVisible(null) && !N.itemVisible({ id: 'nope' })
  && N.visibleGroups().map((g) => g.items.length).join() === N.GROUPS.map((g) => g.items.length).join() && N.customerOnly() === false);
T.check('the product: Build.Rite, opening on Issues', N.product.isBuild && N.product.name === 'Build.Rite' && N.product.home === 'issues' && !!N.item('issues'));
T.check('a screen\'s tab opens its page (routeOf); no other app to link to', JSON.stringify(N.routeOf(N.item('jira'))) === JSON.stringify({ flow: 'insights', page: 'jira', params: {} }) && N.newUrl('x', 'jira') === '' && N.routeOf(null) === null);

T.section('records: screens opened from another, in a tab of their own');
const R = N.RECORDS;
T.check('each record opens a page that exists, under a menu item', Object.keys(R).every((k) => exists(R[k]) && !!N.item(R[k].navId)), Object.keys(R).filter((k) => !exists(R[k])).join());
T.eq('the records', Object.keys(R).sort().join(), 'jira-analysis,jira-analysis-set,jira-progress,jira-sprint,vbs-project,vbs-setup');
T.eq('a sprint: keyed by its id, titled by its name', R['jira-sprint'].key({ id: 6, name: '2026-07' }) + ' / ' + R['jira-sprint'].title({ id: 6, name: '2026-07' }), '6 / Sprint 2026-07');
T.eq('a set of stories: the same set (any order, any case) is the same tab', R['jira-analysis-set'].key({ keys: 'abc-36, ABC-23' }), 'ABC-23,ABC-36');
T.eq('…titled by its keys, or how many', [R['jira-analysis-set'].title({ keys: 'ABC-1,ABC-2' }), R['jira-analysis-set'].title({ keys: 'ABC-1,ABC-2,ABC-3' })].join(' / '), 'AI · ABC-1, ABC-2 / AI · 3 stories');
T.check('one set-up wizard tab, one daily progress tab', R['vbs-setup'].key({}) === 'setup' && R['jira-progress'].key({}) === 'daily');
T.eq('a VB Studio project: keyed by host/org/project, titled by its name', R['vbs-project'].key({ key: 'h/o/p' }) + ' / ' + R['vbs-project'].title({ key: 'h/o/shop-app' }), 'h/o/p / shop-app');

T.section('the search box');
const s1 = N.search('jira');
T.check('a word: the screens it names first, then those whose keywords hold it', s1[0].id === 'jira' && s1.some((x) => x.id === 'issues') && s1[0].group === 'Work', JSON.stringify(s1.map((x) => x.id)));
T.check('…by its group too (SQL is in Tools), and case does not matter', N.search('TOOLS').map((x) => x.id).indexOf('sql') !== -1 && N.search('Standup')[0].id === 'minutes');
T.check('a word in no screen: none; nothing typed: none', N.search('zzzz').length === 0 && N.search('  ').length === 0);
T.check('only Build.Rite\'s own screens: nothing of a business app', ['requests', 'fleet', 'yard', 'equipment', 'billing'].every((w) => N.search(w).length === 0));
T.report();
