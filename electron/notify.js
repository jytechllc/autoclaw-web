// Native OS notification bridge for the AutoClaw desktop shell.
//
// The web app calls window.autoclawDesktop.notify(...) (see preload.js), which
// invokes the "autoclaw:notify" IPC channel registered here. Kept as its own
// module so the handler can be exercised by a standalone harness using the same
// code path as production.
const { ipcMain, Notification } = require("electron");

// Registers the "autoclaw:notify" IPC handler.
//   iconPath: optional () => string, the icon shown on the notification.
//   onClick:  optional () => void, invoked when the notification is clicked
//             (production uses this to focus the main window).
function registerNotificationIpc({ iconPath, onClick } = {}) {
  ipcMain.handle("autoclaw:notify", (_event, options) => {
    if (!Notification.isSupported()) return { ok: false, reason: "unsupported" };
    const opts = options || {};
    const notification = new Notification({
      title: typeof opts.title === "string" ? opts.title : "AutoClaw",
      body: typeof opts.body === "string" ? opts.body : "",
      silent: Boolean(opts.silent),
      icon: iconPath ? iconPath() : undefined,
    });
    if (typeof onClick === "function") notification.on("click", onClick);
    notification.show();
    return { ok: true };
  });
}

module.exports = { registerNotificationIpc };
