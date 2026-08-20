/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

// Bridge a small, well-defined API to the renderer (Next.js pages).
// The renderer detects `window.wsh` and uses it for silent printing and
// listing available printers. Nothing else is exposed to the web content.
contextBridge.exposeInMainWorld("wsh", {
  silentPrint: (opts) => ipcRenderer.invoke("wsh:silent-print", opts),
  listPrinters: () => ipcRenderer.invoke("wsh:list-printers"),
});
