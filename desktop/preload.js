'use strict';

/**
 * What Build.Rite's pages (and your workspace's app, run by Build.Rite) see of the desktop app: window.erpDesktop, a
 * small read-only marker and the screen recorder's controls. The pages talk to the desktop app through its local
 * server (lib/devserver.js), so no HTTP bridge is needed here. Sandboxed and context-isolated: nothing but the fields
 * below crosses over.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('erpDesktop', {
  isDesktop: true,
  app: 'buildrite',
  version: process.env.BUILDRITE_DESKTOP_VERSION || '',
  platform: process.platform,
  // Record, on a Jira story's panel: the screens and windows to record (with a thumbnail), the one chosen, the shortcuts
  // while recording (Screenshot and Stop from any app), and the window (minimised while testing, back when done).
  recordSources: () => ipcRenderer.invoke('rec:sources'),
  recordUse: (id) => ipcRenderer.invoke('rec:use', String(id || '')),
  recordState: (on) => ipcRenderer.invoke('rec:state', !!on),
  recordWindow: (what) => ipcRenderer.invoke('rec:window', String(what || '')),
  onRecordKey: (cb) => {
    ipcRenderer.removeAllListeners('rec:key');
    ipcRenderer.on('rec:key', (event, what) => { if (typeof cb === 'function') cb(String(what)); });
  },
});
