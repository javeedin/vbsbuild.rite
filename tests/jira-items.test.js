#!/usr/bin/env node
'use strict';
/**
 * The sprint items table's filter + sort engine (webApps/buildrite/resources/js/jiraItems.js), shared by the page (the
 * grid), the selection chain (so "select all" ticks only the rows on screen) and the follow-up chain (so "copy all" is
 * the rows on screen). Filter on any column, sort (Key by story number), and the keys of the visible rows.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
let JI = null;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'webApps', 'buildrite', 'resources', 'js', 'jiraItems.js'), 'utf8'), { define: (deps, f) => { JI = f(); } });

const rows = [
  { key: 'EQP-15', summary: 'Cloud Import', status: 'DEVELOPMENT', in: 'here', sprint: '2026-09 B', assignee: 'Rahul Kanth', labels: ['acme'], due: '2026-10-02', resolved: '' },
  { key: 'EQP-3', summary: 'Error Logging', status: 'DONE', in: 'done', sprint: '2026-09 B', assignee: 'Sana Suhana', labels: [], due: '2026-09-30', resolved: '2026-09-29' },
  { key: 'EQP-22', summary: 'Perf Requirements', status: 'DEVELOPMENT', in: 'here', sprint: '2026-09 B', assignee: 'Nobody', labels: ['globex'], due: '2026-09-30', resolved: '' },
];

T.eq('no filter: every row', JI.view(rows, {}, {}).length, 3);
T.eq('filter by status (contains, case-insensitive)', JI.keys(rows, { status: 'development' }, {}).join(','), 'EQP-15,EQP-22');
T.eq('…only the visible keys (what "select all" would tick)', JI.keys(rows, { status: 'development' }, {}).length, 2);
T.eq('filter by summary', JI.keys(rows, { summary: 'logging' }, {}).join(','), 'EQP-3');
T.eq('filter by assignee (Nobody when unassigned)', JI.keys(rows, { assignee: 'nobody' }, {}).join(','), 'EQP-22');
T.eq('filter by customer (labels; "No label" when none)', JI.keys(rows, { customer: 'no label' }, {}).join(','), 'EQP-3');
T.eq('two filters combine (AND)', JI.keys(rows, { status: 'development', customer: 'globex' }, {}).join(','), 'EQP-22');
T.eq('sort by key = story number, not text', JI.view(rows, {}, { col: 'key', dir: 'asc' }).map((r) => r.key).join(','), 'EQP-3,EQP-15,EQP-22');
T.eq('…descending', JI.view(rows, {}, { col: 'key', dir: 'desc' }).map((r) => r.key).join(','), 'EQP-22,EQP-15,EQP-3');
T.eq('filter + sort together', JI.view(rows, { status: 'development' }, { col: 'key', dir: 'asc' }).map((r) => r.key).join(','), 'EQP-15,EQP-22');
T.check('whereOf / labelsText / fieldOf', JI.labelsText({ labels: [] }) === 'No label' && JI.fieldOf({ assignee: '' }, 'assignee') === 'Nobody');
T.report();
