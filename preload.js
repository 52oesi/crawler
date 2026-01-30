const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startCrawl: (payload) =>
    ipcRenderer.invoke('start-crawl', payload),

  convertToExcel: () =>
    ipcRenderer.invoke('convert-to-excel'),

  filterToExcel: () =>
    ipcRenderer.invoke('filter-to-excel'),

  onLogMessage: (callback) =>
    ipcRenderer.on('log-message', (_, msg) => callback(msg))
});
