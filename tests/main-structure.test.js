#!/usr/bin/env node
'use strict';
/**
 * desktop/main.js, read as text (it needs Electron to run): no two top-level functions or constants share a name. In
 * JavaScript the later one silently replaces the earlier: "which workspace is set up" (currentWorkspace) once shared
 * its name with "build the workspace's app", so asking which workspace started a build that failed — Application
 * pages saw no workspace and each ask left an error nobody caught.
 */
const fs = require('fs');
const path = require('path');
const H = require('./_harness');

const T = H.makeAsserter();
const src = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8');
const names = [];
src.split('\n').forEach((l) => {
  const m = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(l) || /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(l);
  if (m) names.push(m[1]);
});
const dup = names.filter((n, i) => names.indexOf(n) !== i);
T.check('every top-level function and constant of main.js has a name of its own (' + names.length + ')', !dup.length, 'twice: ' + dup.join(', '));
T.check('which workspace is set up: currentWorkspace(), apart from building its app (buildWorkspace(c, app, title))',
  /function currentWorkspace\(\)/.test(src) && /async function buildWorkspace\(c, app, title\)/.test(src) && !/buildWorkspace\(\)/.test(src));
T.report();
