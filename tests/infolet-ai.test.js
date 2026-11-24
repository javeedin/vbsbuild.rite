#!/usr/bin/env node
'use strict';
/*
 * The dashboard-AI planner (resources/js/infoletAi.js): the plan prompt, and parsing the LLM's plan into
 * [{ title, question }] — whether it answers with a fenced ```json block, a bare array, or an { infolets: [...] }
 * object, and tolerating junk. Run: node tests/infolet-ai.test.js
 */
const H = require('./_harness');
const A = require('../webApps/buildrite/resources/js/infoletAi');

const T = H.makeAsserter();

try {
  T.section('the plan prompt');
  const m = A.planMessages('how are sales doing this year', 'tables: ORDERS, CUSTOMERS');
  T.check('asks for a JSON array of title + question, carries the marker, and no SQL', /JSON array/.test(m.system) && m.system.indexOf(A.MARKER) !== -1 && /Do not write SQL/.test(m.system), m.system.slice(0, 80));
  T.check('the user message is the goal plus context', /how are sales doing this year/.test(m.user) && /ORDERS, CUSTOMERS/.test(m.user));

  T.section('parse a fenced JSON block');
  const fenced = 'Here is a plan:\n```json\n[{"title":"Sales by month","question":"total sales by month this year"},{"title":"Top customers","question":"the 10 customers with the most orders"}]\n```\nHope that helps.';
  const p1 = A.parsePlan(fenced);
  T.check('two infolets, titles and questions parsed', p1.length === 2 && p1[0].title === 'Sales by month' && p1[1].question === 'the 10 customers with the most orders', JSON.stringify(p1));

  T.section('parse a bare array, and an { infolets: [] } object');
  T.check('a bare array works', A.parsePlan('[{"title":"A","question":"count of orders"}]').length === 1);
  T.check('an object with an infolets array works', A.parsePlan('{"infolets":[{"name":"B","ask":"revenue by region"}]}')[0].question === 'revenue by region');

  T.section('tidy and cap');
  T.check('a missing title falls back to the question; blank questions are dropped', (() => {
    const p = A.parsePlan('[{"question":"orders by status"},{"title":"X"},{"title":"Y","question":"  "}]');
    return p.length === 1 && p[0].title === 'orders by status' && p[0].question === 'orders by status';
  })());
  T.check('at most MAX items', A.parsePlan(JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ title: 't' + i, question: 'q' + i })))).length === A.MAX);
  T.check('junk never throws (empty list)', A.parsePlan('sorry, I cannot do that').length === 0 && A.parsePlan('').length === 0 && A.parsePlan(null).length === 0);
} catch (e) {
  T.check('no exception: ' + (e && e.stack), false);
}
T.report();
