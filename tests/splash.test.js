#!/usr/bin/env node
'use strict';
/**
 * The startup splash (desktop/splash.html, shown by desktop/main.js createSplash / endSplash), read as text: the logo's
 * story (Build.Rite → Write.Rite, the box BR → WR), the opening-out the app triggers with the class "out", nothing from
 * the network; main.js shows it before the window, hands over once the app has loaded (or could not start), never
 * leaves the app hidden, and can be switched off.
 *
 * Run:  node tests/splash.test.js
 */
const fs = require('fs');
const path = require('path');
const H = require('./_harness');

const T = H.makeAsserter();
const html = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'splash.html'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8');
const letters = (cls) => ((new RegExp('<span class="w ' + cls + '">([\\s\\S]*?)</span>\\s*</span>|<span class="w ' + cls + '">([\\s\\S]*?)</span>(?=\\s*<span class="w|\\s*</span>)').exec(html) || [])[0] || '')
  .replace(/<[^>]+>/g, '').replace(/\s+/g, '');

T.check('the word flips: Build, then Write; the box: BR, then WR', /Build/.test(letters('w1')) && /Write/.test(letters('w2'))
  && /<div class="face front">BR<\/div>/.test(html) && /<div class="face back">WR<\/div>/.test(html), letters('w1') + ' / ' + letters('w2'));
T.check('…the line under it: Build it right. → Write it right.; ".Rite" kept', /Build it right\./.test(html) && /Write it right\./.test(html) && /class="rite"/.test(html));
T.check('the flip in 3D on the box, the pop-in on a wrapper (an opacity animation on the flipping box flattens it: ЯB)', /\.boxwrap \{[^}]*animation: box-in/.test(html)
  && /\.box \{[^}]*transform-style: preserve-3d;[^}]*animation: box-flip/.test(html) && !/\.box \{[^}]*box-in/.test(html));
T.check('opened out by the class "out": the box grows to the app\'s colour, the rest falls away', /\.out \.boxwrap \{ animation: box-out/.test(html) && /--app: #f5f4f2/.test(html) && /\.out \.card/.test(html));
T.check('nothing from the network, no script; calmer for reduced motion', !/https?:\/\//.test(html.replace(/<!--[\s\S]*?-->/g, '')) && !/<script/i.test(html) && /prefers-reduced-motion: reduce/.test(html));
T.check('main.js: the splash before the window; the window waits for it', /createSplash\(\);\s*createWindow\(\);/.test(main) && /win\.once\('ready-to-show', \(\) => \{ if \(!splash \|\| splashDone\) win\.show\(\); \}\);/.test(main));
T.check('…handed over once the app has loaded (after the logo has played), at once when it cannot start', /win\.loadURL\(appUrl\(\)\)\.then\(\(\) => endSplash\(\), \(\) => endSplash\(\)\);/.test(main)
  && (main.match(/endSplash\(true\);/g) || []).length >= 2 && /SPLASH_MIN_MS = 7000/.test(main) && /classList\.add\('out'\)/.test(main));
T.check('…never leaves the app hidden: at most SPLASH_MAX_MS, closing the splash shows the app; BUILDRITE_NO_SPLASH=1 skips it', /setTimeout\(\(\) => endSplash\(true\), SPLASH_MAX_MS\)/.test(main)
  && /splash\.on\('closed', \(\) => \{ splash = null; if \(!splashDone\) \{ splashDone = true; showMainWindow\(\); \} \}\);/.test(main) && /BUILDRITE_NO_SPLASH === '1'/.test(main));
T.check('…a frameless, transparent, sandboxed window that never navigates', /frame: false, transparent: true/.test(main) && /splash\.webContents\.on\('will-navigate', \(event\) => event\.preventDefault\(\)\)/.test(main)
  && /webPreferences: \{ sandbox: true, contextIsolation: true, nodeIntegration: false \} \}\);\s*splash\.webContents/.test(main));
T.report();
