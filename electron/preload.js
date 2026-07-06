// Minimal, safe preload. Exposes a tiny read-only surface to the web app so it
// can detect it is running inside the AutoClaw desktop shell, plus a thin bridge
// to native OS notifications.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("autoclawDesktop", {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  // Show a native OS notification. Returns a Promise<{ ok, reason? }>.
  // Usage: window.autoclawDesktop.notify({ title, body, silent?, url? })
  // `url` (optional): a same-origin path or URL to open in-window when the
  // notification is clicked (in addition to focusing the app).
  notify: (options) =>
    ipcRenderer.invoke("autoclaw:notify", {
      title: options?.title,
      body: options?.body,
      silent: options?.silent,
      url: options?.url,
    }),
  // Re-attempt loading the hosted app (used by the offline page's retry button).
  retry: () => ipcRenderer.invoke("autoclaw:retry"),
});
