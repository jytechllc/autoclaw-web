// Native OS notification bridge for the AutoClaw desktop shell.
//
// The web app calls window.autoclawDesktop.notify(...) (see preload.js), which
// invokes the "autoclaw:notify" IPC channel registered here. Kept as its own
// module so the handler can be exercised by a standalone harness using the same
// code path as production.
const { ipcMain, Notification } = require("electron");

// Registers the "autoclaw:notify" IPC handler.
//   iconPath:   optional () => string, the icon shown on the notification.
//   onActivate: optional (url?) => void, invoked when the notification is
//               clicked. `url` is the optional deep-link the web app attached
//               to the notification (production focuses the window and, if a
//               url is present, navigates to it in-window).
function registerNotificationIpc({ iconPath, onActivate } = {}) {
  ipcMain.handle("autoclaw:notify", (_event, options) => {
    if (!Notification.isSupported()) return { ok: false, reason: "unsupported" };
    const opts = options || {};
    const url = typeof opts.url === "string" ? opts.url : undefined;
    const notification = new Notification({
      title: typeof opts.title === "string" ? opts.title : "AutoClaw",
      body: typeof opts.body === "string" ? opts.body : "",
      silent: Boolean(opts.silent),
      icon: iconPath ? iconPath() : undefined,
    });
    if (typeof onActivate === "function") {
      notification.on("click", () => onActivate(url));
    }
    notification.show();
    return { ok: true };
  });
}

module.exports = { registerNotificationIpc };
