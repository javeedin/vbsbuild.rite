#!/usr/bin/env node
'use strict';
/**
 * Change requests › Analytics (webApps/buildrite/resources/js/crAnalytics.js): the headline figures (open, fixed, time to
 * fix — from the day it was asked to the day its change was saved —, fixed at the first try, lines changed, overdue),
 * status and kind shares, page by page (kinds, lines, files, the time it took, overdue), areas (the app's flows),
 * customers, who asks, who fixed, the files that move most, the weeks (asked and fixed), how old the open ones are,
 * what is late, the latest fixed.
 */
const fs = require('fs');
const path = require('path');
const H = require('./_harness');

const T = H.makeAsserter();
let A = null;
new Function('define', fs.readFileSync(path.join(__dirname, '..', 'webApps', 'buildrite', 'resources', 'js', 'crAnalytics.js'), 'utf8'))((deps, f) => { A = f(); });

const NOW = new Date(2026, 10, 18, 15, 0).getTime(); // Wed 18 Nov 2026
const fx = (status, files, savedAt) => ({ status, files: files.map((f) => ({ file: f[0], added: f[1], removed: f[2] })), added: files.reduce((n, f) => n + f[1], 0), removed: files.reduce((n, f) => n + f[2], 0), savedAt: savedAt || '', approvedBy: 'dana' });
const BILL = 'webApps/shop/flows/customers/pages/customer-billing-page.html';
const reqs = [
  { id: 'a', code: 'CR-0001', title: 'Overdue first', page: 'shop/customers/customer-billing', pageLabel: 'My Billing', kind: 'enhance', priority: 'high', customer: 'Northwind', requestedBy: 'sam', requestedOn: '2026-11-10',
    status: 'fixed', fixedOnShown: '2026-11-12', fixedByShown: 'dana', attempts: 1, fixSum: fx('committed', [[BILL, 9, 0]], '2026-11-12T10:00:00.000Z'), updatedAt: '2026-11-12T10:00:00.000Z' },
  { id: 'b', code: 'CR-0002', title: 'Wrong total', page: 'shop/customers/customer-billing', pageLabel: 'My Billing', kind: 'fix', priority: 'urgent', customer: 'Northwind', requestedBy: 'lee', requestedOn: '2026-11-16',
    status: 'fixed', fixedOnShown: '2026-11-16', fixedByShown: 'ravi', attempts: 2, fixSum: fx('committed', [[BILL, 2, 1], ['webApps/shop/flows/customers/pages/customer-billing-page.js', 4, 2]], '2026-11-16T09:00:00.000Z') },
  { id: 'c', code: 'CR-0003', title: 'Home button', page: 'shop/orders/order-create', pageLabel: 'New Order', kind: 'change', priority: 'medium', customer: 'Contoso', requestedBy: 'sam', requestedOn: '2026-11-17',
    status: 'proposed', attempts: 1, fixSum: fx('proposed', [['webApps/shop/flows/orders/pages/order-create-page.html', 3, 0]]) },
  { id: 'd', code: 'CR-0004', title: 'Old one', page: 'shop/orders/order-create', pageLabel: 'New Order', kind: 'fix', priority: 'low', customer: '', requestedBy: 'sam', requestedOn: '2026-07-01', dueOn: '2026-11-01', status: 'new', attempts: 0 },
  { id: 'e', code: 'CR-0005', title: 'Dropped', page: 'shop/orders/order-detail', pageLabel: 'Order', kind: 'change', priority: 'medium', requestedBy: 'kim', requestedOn: '2026-11-02', status: 'rejected', attempts: 0 },
  { id: 'f', code: 'CR-0006', title: 'Waiting', page: 'shop/customers/customer-billing', pageLabel: 'My Billing', kind: 'enhance', priority: 'medium', customer: 'Contoso', requestedBy: 'lee', requestedOn: '2026-11-18', status: 'hold', attempts: 1, fixSum: fx('applied', [[BILL, 1, 1]]) }
];
const m = A.model(reqs, { now: NOW, weeks: 4 });
const k = (key) => m.kpis.filter((x) => x.key === key)[0];

T.section('the headline figures');
T.check('6 requests on 3 pages; 3 open (1 in progress, 1 new, 1 on hold), 2 fixed', k('total').n === '6' && /3 pages/.test(k('total').sub) && k('open').n === '3' && /1 in progress · 1 new/.test(k('open').sub) && k('fixed').n === '2', JSON.stringify(m.kpis.slice(0, 3)));
T.check('…fixed: 40% of those not closed (2 of 5; the rejected one is closed)', /40% of those not closed/.test(k('fixed').sub), k('fixed').sub);
T.check('time to fix from the day asked to the day saved: 2 days and the same day → average 1 day, median 1 day', k('speed').n === '1 day' && /median 1 day/.test(k('speed').sub), JSON.stringify(k('speed')));
T.check('fixed at the first try: 1 of 2 (50%); AI attempts on average over the requests with one', k('first').n === '50%' && /1\.3 AI attempts on average/.test(k('first').sub), JSON.stringify(k('first')));
T.check('lines changed: applied and saved fixes only (+16 −4), 2 files touched; a proposal not counted', k('lines').n === '+16 −4' && /2 files touched/.test(k('lines').sub), JSON.stringify(k('lines')));
T.check('overdue: an open one past its due date (bad); none → ok', k('late').n === '1' && k('late').tone === 'bad' && A.model([], { now: NOW }).kpis.filter((x) => x.key === 'late')[0].tone === 'ok');

T.section('shares: status, kind, priority');
T.eq('status in order, with counts', m.status.map((s) => s.label + ' ' + s.n).join(', '), 'New 1, In progress 1, Fixed 2, On hold 1, Closed 1');
T.eq('kinds, with how many fixed', m.kinds.map((x) => x.label + ' ' + x.n + '/' + x.fixed).join(', '), 'Fix a bug 2/1, Enhance 2/1, Change 2/0');
T.eq('priorities, most urgent first, open counted', m.priorities.map((x) => x.label + ' ' + x.n + ' (' + x.open + ' open)').join(', '), 'Urgent 1 (0 open), High 1 (0 open), Medium 3 (2 open), Low 1 (1 open)');

T.section('page by page');
const bill = m.pages[0];
T.check('the busiest page first: My Billing — 3 requests, 2 fixed, kinds 1 fix · 2 enhance, lines of its applied/saved fixes, 2 files, its time to fix', bill.label === 'My Billing' && bill.n === 3 && bill.fixed === 2
  && bill.kindText === '1 fix a bug · 2 enhance' && bill.added === 16 && bill.removed === 4 && bill.files === 2 && bill.avgDays === '1 day' && bill.w === '100%', JSON.stringify(bill));
const order = m.pages.filter((p) => p.label === 'New Order')[0];
T.check('…New Order: 2 requests, none fixed, 1 overdue, its kinds as one bar', order.n === 2 && order.fixed === 0 && order.overdue === 1 && order.kindBar.map((x) => x.key + ':' + x.w).join() === 'fix:50%,change:50%', JSON.stringify(order));
T.eq('areas: the app\'s flows', m.areas.map((a) => a.key + ' ' + a.n).join(', '), 'shop/customers 3, shop/orders 3');

T.section('people and files');
T.eq('customers (no customer said so)', m.customers.map((c) => c.label + ' ' + c.n).join(', '), 'Contoso 2, Northwind 2, (no customer) 2');
T.eq('who asks', m.requesters.map((c) => c.label + ' ' + c.n).join(', '), 'sam 3, lee 2, kim 1');
T.eq('who fixed, with lines and time', m.fixers.map((c) => c.label + ' ' + c.n + ' ' + c.lines + ' ' + c.avgDays).join(', '), 'dana 1 9 2 days, ravi 1 9 same day');
T.eq('the files that move most', m.files.map((f) => f.name + ' ' + f.n + ' +' + f.added + ' −' + f.removed).join(', '), 'customer-billing-page.html 3 +12 −2, customer-billing-page.js 1 +4 −2');

T.section('time');
T.eq('the weeks (Mondays): asked and fixed', m.weeks.map((w) => w.label + ' ' + w.asked + '/' + w.fixed).join(', '), '26 Oct 0/0, 2 Nov 1/0, 9 Nov 1/1, 16 Nov 3/1');
T.check('…the current week marked, bars scaled to the busiest, a tooltip', m.weeks[3].current && m.weeks[3].hAsked === '100%' && /Week of 16 Nov 2026: 3 asked, 1 fixed/.test(m.weeks[3].tip));
T.eq('how old the open ones are', m.ageing.map((a) => a.label + ' ' + a.n).join(', '), 'Up to a week 2, 8–30 days 0, 1–3 months 0, Over 3 months 1');
T.check('late: CR-0004, 17 days past 1 Nov', m.overdue.length === 1 && m.overdue[0].code === 'CR-0004' && m.overdue[0].days === 17 && m.overdue[0].due === '1 Nov 2026', JSON.stringify(m.overdue));
T.eq('the latest fixed first, with how long it took and its lines', m.recent.map((r) => r.code + ' ' + r.took + ' ' + r.lines).join(', '), 'CR-0002 same day +6 −3, CR-0001 2 days +9 −0');
T.check('nothing yet: zeros, no error', A.model([], { now: NOW }).total === 0 && A.model(null).pages.length === 0);
T.report();
