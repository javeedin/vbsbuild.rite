#!/usr/bin/env node
'use strict';
/*
 * Running an API-level edge path (webApps/buildrite/resources/js/edgeTest.js): classify an edge, parse its API from
 * `stresses`, plan the edge request by mutating the recorded happy-path request, and grade a run's response against what
 * the edge says should happen.
 * Run: node tests/edge-test.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
let E = null;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'webApps', 'buildrite', 'resources', 'js', 'edgeTest.js'), 'utf8'), { define: (deps, f) => { E = f(); } });

T.section('classify + runnable');
T.check('an invalid-id edge expects a 404', E.classify({ name: 'Invalid or missing identifier', trigger: 'The id in /orders/{id} is wrong', stresses: 'GET /orders/{id}' }).expect.cls === '404');
T.check('a bad-input edge expects a 4xx (not caught by invalid-id)', E.classify({ name: 'Invalid or missing input', trigger: 'Required fields are blank or fail validation', stresses: 'POST /orders' }).kind === 'bad-input' && E.classify({ name: 'Invalid or missing input', trigger: 'Required fields are blank', stresses: 'POST /orders' }).expect.cls === '4xx');
T.check('a no-results edge expects a 2xx', E.classify({ name: 'No matching records', trigger: 'The query returns nothing', stresses: 'GET /items' }).expect.cls === '2xx');
T.check('a duplicate edge is handled-class', E.classify({ name: 'Duplicate submission', trigger: 'The user submits twice', stresses: 'POST /orders' }).kind === 'duplicate');
T.check('a generic write edge is handled-class', E.classify({ name: 'Server rejects the change', trigger: 'the backend returns 500', stresses: 'POST /orders' }).expect.cls === 'handled');
T.check('a UI / outside-system edge is env (not runnable), and no path is env too',
  E.classify({ name: 'Oracle Fusion is unavailable', trigger: 'the call times out', stresses: 'GET /fscmRestApi/x' }).kind === 'env'
  && E.classify({ name: 'User cancels or leaves', trigger: 'goes back', stresses: 'navigation / unsaved state' }).kind === 'env'
  && E.classify({ name: 'Page fails to load', trigger: 'a resource fails', stresses: 'GET /x' }).kind === 'env'
  && E.runnable({ name: 'No matching records', trigger: 'nothing', stresses: 'GET /items' }) === true
  && E.runnable({ name: 'Session expires', trigger: 'times out', stresses: 'auth / session' }) === false);

T.section('methodOf / pathOf');
T.check('the method and path are parsed from stresses, default GET', E.methodOf({ stresses: 'POST /ords/shop/v1/orders' }) === 'POST' && E.pathOf({ stresses: 'POST /ords/shop/v1/orders' }) === '/ords/shop/v1/orders' && E.methodOf({ stresses: '/items' }) === 'GET');

T.section('plan the edge request (mutate the happy path)');
const idPlan = E.plan({ name: 'Invalid or missing identifier', trigger: 'bad id', stresses: 'GET /orders/{id}' }, { params: { id: '42' }, query: '', body: '' });
T.check('invalid-id breaks every path param', idPlan.params.id === E.BAD_ID && /path id/.test(idPlan.note));
const idNone = E.plan({ name: 'Invalid or missing identifier', trigger: 'bad id', stresses: 'GET /items' }, { params: {}, query: '', body: '' });
T.check('invalid-id with no path param notes it instead', Object.keys(idNone.params).length === 0 && /no id in the path/.test(idNone.note));
const badPlan = E.plan({ name: 'Invalid or missing input', trigger: 'required blank', stresses: 'POST /orders' }, { params: {}, query: '', body: '{"customer":"C1","qty":2}' });
T.check('bad-input empties a JSON body to force validation', badPlan.body === '{}' && /required fields missing/.test(badPlan.note));
const dupPlan = E.plan({ name: 'Duplicate submission', trigger: 'twice', stresses: 'POST /orders' }, { params: {}, query: '', body: '{"x":1}' });
T.check('duplicate keeps the request and flags twice', dupPlan.body === '{"x":1}' && dupPlan.twice === true);

T.section('grade the response');
T.check('a 5xx always fails (crash, not handled)', E.grade({ cls: '4xx' }, { status: 500 }).pass === false && E.grade({ cls: '2xx' }, { status: 503 }).verdict === 'fail');
T.check('4xx expected: a 4xx passes, a 2xx fails (bad data accepted)', E.grade({ cls: '4xx' }, { status: 422 }).pass === true && E.grade({ cls: '4xx' }, { status: 200 }).pass === false && /not rejected/.test(E.grade({ cls: '4xx' }, { status: 201 }).text));
T.check('404 expected: only a 404 passes', E.grade({ cls: '404' }, { status: 404 }).pass === true && E.grade({ cls: '404' }, { status: 200 }).pass === false);
T.check('2xx expected: a 2xx passes and reports rows', E.grade({ cls: '2xx' }, { status: 200, rows: 0 }).pass === true && /0 row/.test(E.grade({ cls: '2xx' }, { status: 200, rows: 0 }).text));
T.check('handled: anything under 500 passes', E.grade({ cls: 'handled' }, { status: 409 }).pass === true && E.grade({ cls: 'handled' }, { status: 500 }).pass === false);
T.check('no status / env → not pass (unknown / na)', E.grade({ cls: '4xx' }, { status: null, error: 'x' }).verdict === 'unknown' && E.grade(null, { status: 400 }).verdict === 'na');

T.report();
