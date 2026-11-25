'use strict';

/**
 * The backend-login window's only link to the main process: read the failed call + any saved username, test a login,
 * save it, copy the address. Sandboxed and context-isolated; used by this window alone. The password is sent to the
 * main process to test/save; it is never returned.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('backendLogin', {
  initial: () => ipcRenderer.invoke('backendLogin:initial'),
  test: (form) => ipcRenderer.invoke('backendLogin:test', form),
  save: (form) => ipcRenderer.invoke('backendLogin:save', form),
  copy: (text) => ipcRenderer.invoke('backendLogin:copy', text),
  cancel: () => ipcRenderer.invoke('backendLogin:cancel'),
});
