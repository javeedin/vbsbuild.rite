#!/usr/bin/env node
'use strict';
/*
 * Features from Jira (webApps/buildrite/resources/js/jiraFeatures.js): from every Jira story, draft a product feature
 * list — the prompt, parsing the AI's ```features block, the model (features → their stories, status roll-up, the
 * ungrouped ones, unknown keys dropped), the deterministic autoDraft (no AI), and the document / rows.
 * Run: node tests/jira-features.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
let F = null;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'webApps', 'buildrite', 'resources', 'js', 'jiraFeatures.js'), 'utf8'), { define: (deps, f) => { F = f(); } });

// jiraBacklog-shaped stories
const issues = [
  { key: 'EQR-1', summary: 'Browse the equipment catalogue', type: 'Story', status: 'Done', statusCat: 'done', epicName: 'Catalogue', labels: ['catalog'], url: 'https://j/EQR-1' },
  { key: 'EQR-2', summary: 'Filter catalogue by class', type: 'Story', status: 'In Progress', statusCat: 'indeterminate', epicName: 'Catalogue', labels: [], url: 'https://j/EQR-2' },
  { key: 'EQR-3', summary: 'Sync items from Fusion', type: 'Story', status: 'To Do', statusCat: 'new', epicName: 'Fusion Sync', labels: ['fusion'], url: 'https://j/EQR-3' },
  { key: 'EQR-4', summary: 'A loose story', type: 'Story', status: 'To Do', statusCat: 'new', epicName: '', labels: [], url: 'https://j/EQR-4' },
];

T.section('norm + rollup');
const n = F.norm(issues[1]);
T.check('an issue normalises to the small shape', n.key === 'EQR-2' && n.cat === 'indeterminate' && n.epic === 'Catalogue' && n.type === 'Story', JSON.stringify(n));
T.eq('a roll-up counts done / in progress / to do', JSON.stringify(F.rollup(F.normAll(issues))), JSON.stringify({ done: 1, prog: 1, todo: 2, total: 4 }));

T.section('prompt + storiesText');
const p = F.prompt(issues);
T.check('the prompt lists every story key and asks for a features JSON block', /EQR-1/.test(p.user) && /EQR-4/.test(p.user) && /```features/.test(p.system) && /group/i.test(p.system));
T.check('storiesText carries key, status and epic within a budget', /EQR-1 \[Story\/Done\]/.test(F.storiesText(issues)) && /epic: Catalogue/.test(F.storiesText(issues)) && F.storiesText(issues, 20).length <= 60);

T.section('parse the AI answer');
const ai = 'Sure, here you go:\n```features\n[{"name":"Equipment Catalogue","description":"Browse and filter equipment","storyKeys":["EQR-1","eqr-2"]},{"name":"Fusion Sync","description":"Keep items in step with Fusion","storyKeys":["EQR-3"]}]\n```\nHope that helps.';
const drafted = F.parse(ai);
T.check('the ```features block is parsed, keys upper-cased and de-duplicated', drafted.length === 2 && drafted[0].name === 'Equipment Catalogue' && drafted[0].storyKeys.join() === 'EQR-1,EQR-2' && drafted[1].storyKeys.join() === 'EQR-3', JSON.stringify(drafted));
T.check('no block / not JSON → empty, nothing thrown', F.parse('no json here').length === 0 && F.parse('').length === 0 && F.parse(null).length === 0);

T.section('build the model');
const m = F.build(issues, drafted);
T.check('features carry their real stories with a roll-up; order kept', m.features.length === 2 && m.features[0].name === 'Equipment Catalogue' && m.features[0].stories.length === 2 && m.features[0].rollup.done === 1 && m.features[0].rollup.prog === 1, JSON.stringify(m.counts));
T.check('a story in no feature is gathered under ungrouped', m.ungrouped.length === 1 && m.ungrouped[0].key === 'EQR-4' && m.total === 4);
T.check('an unknown key in the draft is dropped, an empty feature removed', F.build(issues, [{ name: 'Ghost', storyKeys: ['NOPE-9'] }, { name: 'Real', storyKeys: ['EQR-1'] }]).features.map((f) => f.name).join() === 'Real');

T.section('autoDraft without AI');
const auto = F.build(issues, F.autoDraft(issues));
T.check('autoDraft groups by epic / label / type and leaves nothing ungrouped', auto.ungrouped.length === 0 && auto.features.some((f) => f.name === 'Catalogue') && auto.features.some((f) => f.name === 'Fusion Sync'), JSON.stringify(auto.features.map((f) => f.name)));

T.section('rows + document');
const r = F.rows(m);
T.check('rows are one per story under its feature (+ ungrouped)', r.length === 4 && r[0].feature === 'Equipment Catalogue' && r[0].key === 'EQR-1' && r.some((x) => x.feature === '(ungrouped)' && x.key === 'EQR-4'));
const doc = F.documentHtml(m, { project: 'EQR', by: 'rite.user', date: '2026-11-23', source: 'All stories' });
T.check('the document names the features, their stories and a roll-up, and is valid HTML', /<!doctype html>/i.test(doc) && /Equipment Catalogue/.test(doc) && /EQR-1/.test(doc) && /jf-chip--done/.test(doc) && /Not grouped \(1\)/.test(doc) && /Project EQR/.test(doc));

T.report();
