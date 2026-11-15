#!/usr/bin/env node
'use strict';
/**
 * The warm-up (webApps/buildrite/resources/js/warmup.js): every JET component one of Build.Rite's screens imports is in
 * its list, so none is left to load when its tab is first opened; and the list holds nothing no screen uses.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const APP = path.join(__dirname, '..', 'webApps', 'buildrite');
let W = null;
vm.runInNewContext(fs.readFileSync(path.join(APP, 'resources', 'js', 'warmup.js'), 'utf8'), { define: (deps, f) => { W = f(() => {}); } });

const importsOf = (flows) => {
  const out = {};
  flows.forEach((flow) => {
    const dir = path.join(APP, 'flows', flow, 'pages');
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).filter((f) => /-page\.json$/.test(f)).forEach((f) => {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      Object.values((j.imports && j.imports.components) || {}).forEach((c) => { if (c.path !== 'ojs/ojknockout') (out[c.path] = out[c.path] || []).push(flow + '/' + f); });
    });
  });
  return out;
};
const all = importsOf(fs.readdirSync(path.join(APP, 'flows')));
const list = W.LISTS.buildrite;
T.check('one list: Build.Rite\'s', Array.isArray(list) && list.length > 0 && Object.keys(W.LISTS).join() === 'buildrite', Object.keys(W.LISTS).join());
const miss = Object.keys(all).filter((m) => list.indexOf(m) === -1);
T.check('every component a Build.Rite screen imports is warmed up', miss.length === 0, miss.map((m) => m + ' (' + all[m].join(', ') + ')').join('; '));
const unused = list.filter((m) => !all[m]);
T.check('nothing warmed up that no screen uses', unused.length === 0, unused.join(', '));
T.check('…and ojknockout (always there) is not', list.indexOf('ojs/ojknockout') === -1);
T.report();
