// AutoClaw desktop shell (Electron).
// The desktop app is a thin native client for the hosted AutoClaw web app, so it
// loads the production URL in a BrowserWindow. No Next.js bundle is shipped.
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  shell,
  nativeImage,
  ipcMain,
  dialog,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { registerNotificationIpc } = require("./notify");

// App identity. On Windows this MUST be set (and match the installer's appId)
// before any Notification is shown, otherwise notifications render without the
// app name/icon — or silently fail. Safe no-op on macOS/Linux.
const APP_ID = "us.jytech.autoclaw";

// Target web app URL. Override with AUTOCLAW_DESKTOP_URL for staging/local dev.
const APP_URL = process.env.AUTOCLAW_DESKTOP_URL || "https://autoclaw.jytech.us";
const APP_ORIGIN = (() => {
  try {
    return new URL(APP_URL).origin;
  } catch {
    return "https://autoclaw.jytech.us";
  }
})();

// How often the offline page retries the hosted app (auto-reconnect).
const RETRY_INTERVAL_MS = 5000;

const isDev = !app.isPackaged;
let mainWindow = null;
let tray = null;
let retryTimer = null;
let started = false; // true once the first remote navigation has been kicked off
let showingError = false; // true while the local offline page is displayed
let isQuitting = false; // true once a real quit is underway (vs. close-to-tray)
let saveStateTimer = null; // debounce for persisting window bounds

// Default window geometry; also the fallback when no saved state exists.
const DEFAULT_BOUNDS = { width: 1280, height: 860 };

// Persist window size/position/maximized state between launches so the app
// reopens where the user left it. Stored as JSON in userData (drive folder for
// portable builds, %APPDATA% otherwise).
function windowStateFile() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function readWindowState() {
  try {
    const raw = fs.readFileSync(windowStateFile(), "utf8");
    const s = JSON.parse(raw);
    if (typeof s.width === "number" && typeof s.height === "number") return s;
  } catch {
    // No saved state yet, or unreadable — fall back to defaults.
  }
  return null;
}

function saveWindowState() {
  if (!mainWindow) return;
  try {
    const isMaximized = mainWindow.isMaximized();
    // getBounds() reports the maximized bounds while maximized, which we don't
    // want to restore to. getNormalBounds() is the pre-maximize rectangle.
    const bounds = mainWindow.getNormalBounds();
    fs.writeFileSync(
      windowStateFile(),
      JSON.stringify({ ...bounds, isMaximized }),
    );
  } catch {
    // Read-only drive or locked path — losing window state is non-fatal.
  }
}

// Coalesce the rapid-fire resize/move events into a single write.
function scheduleSaveWindowState() {
  if (saveStateTimer) clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(saveWindowState, 400);
}

// USB / portable build: keep all app state (login session, cookies, cache) in a
// folder next to the .exe instead of the host's %APPDATA%. This makes it a true
// "U 盘版": plug the drive into any Windows machine, stay logged in, and leave no
// trace on the host once it's unplugged. electron-builder injects
// PORTABLE_EXECUTABLE_DIR only for the `portable` target, so installed builds are
// unaffected and keep using the standard per-user location.
function configurePortableDataDir() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (!portableDir) return;
  const dataDir = path.join(portableDir, "AutoClaw-Data");
  try {
    // Must run before app `ready`; pins session + cache under the drive folder.
    app.setPath("userData", dataDir);
    app.setPath("sessionData", dataDir);
  } catch {
    // Read-only drive or locked path — fall back to the default location.
  }
}

function iconPath() {
  return path.join(__dirname, "..", "electron-resources", "icon.png");
}

function clearRetryTimer() {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}

// Navigate the main window to the hosted web app. Used on startup (after the
// splash paints), by the auto-reconnect timer, and by the "Retry now" button.
function loadRemoteApp() {
  if (mainWindow) mainWindow.loadURL(APP_URL);
}

// Show the bundled offline page and start polling the hosted URL. The page is
// loaded only on the first failure (guarded by showingError) so repeated misses
// don't make it flicker; the timer keeps retrying until a load succeeds, at
// which point did-finish-load clears it — i.e. auto-reconnect.
function showOfflinePage() {
  if (!mainWindow || showingError) return;
  showingError = true;
  mainWindow.loadFile(path.join(__dirname, "offline.html"));
  clearRetryTimer();
  retryTimer = setInterval(loadRemoteApp, RETRY_INTERVAL_MS);
}

function createWindow() {
  const saved = readWindowState();
  const bounds = saved || DEFAULT_BOUNDS;

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    // x/y are omitted when there's no saved state so the OS centers the window.
    ...(typeof bounds.x === "number" && typeof bounds.y === "number"
      ? { x: bounds.x, y: bounds.y }
      : {}),
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#0b0b0f",
    show: false, // revealed on ready-to-show once the splash has painted
    autoHideMenuBar: true, // hide the menu bar by default (toggle with Alt)
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  if (saved && saved.isMaximized) mainWindow.maximize();

  const wc = mainWindow.webContents;

  // Startup: paint a local splash (loading.html) immediately, then navigate to
  // the hosted app once the splash is up. The splash stays visible until the
  // remote first paints (or fails), so cold start is never a blank window.
  mainWindow.loadFile(path.join(__dirname, "loading.html"));
  const revealWindow = () => {
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
  };
  mainWindow.once("ready-to-show", revealWindow);
  // Fallback: some Linux/WSLg compositors never emit `ready-to-show`, which
  // would leave the window stuck invisible. Reveal it once the splash paints,
  // and again on a short timer, so the window can't get lost. show() is
  // idempotent, so this is a no-op once the window is already visible.
  wc.once("did-finish-load", revealWindow);
  setTimeout(revealWindow, 2000);

  wc.on("did-finish-load", () => {
    // Local pages (loading/offline) finished painting. On the first one, kick
    // off the real navigation to the hosted app.
    if (wc.getURL().startsWith("file://")) {
      if (!started) {
        started = true;
        loadRemoteApp();
      }
      return;
    }
    // Hosted app loaded successfully — back online, stop retrying.
    clearRetryTimer();
    showingError = false;
  });

  // Main-frame load failure (offline, DNS, server unreachable) → offline page +
  // auto-reconnect. ERR_ABORTED (-3) is a normal navigation cancel (e.g. the
  // retry timer firing mid-load), so ignore it.
  wc.on("did-fail-load", (_event, errorCode, _desc, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    showOfflinePage();
  });

  // Renderer crash (GPU/OOM/killed) → recover instead of leaving a dead white
  // window. A clean exit is normal (e.g. during quit), so ignore it; otherwise
  // re-navigate to the hosted app.
  wc.on("render-process-gone", (_event, details) => {
    if (isQuitting || details.reason === "clean-exit") return;
    showingError = false;
    loadRemoteApp();
  });

  // Page hung (long task / stuck request). Offer to reload rather than leaving
  // the user stuck on a frozen window.
  wc.on("unresponsive", () => {
    if (!mainWindow || isQuitting) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      buttons: ["Wait", "Reload"],
      defaultId: 0,
      cancelId: 0,
      title: "AutoClaw",
      message: "AutoClaw is not responding.",
      detail: "You can keep waiting, or reload the app.",
    });
    // A hard-wedged main thread can't honor a normal reload() (the reload has
    // to run on the very thread that's stuck), so forcibly crash the renderer;
    // the render-process-gone handler above then re-navigates to a fresh page.
    if (choice === 1 && mainWindow) {
      mainWindow.webContents.forcefullyCrashRenderer();
    }
  });

  // Persist window geometry as the user resizes/moves it.
  mainWindow.on("resize", scheduleSaveWindowState);
  mainWindow.on("move", scheduleSaveWindowState);

  // Open external links (window.open / target=_blank) in the system browser.
  // Same-origin navigations (incl. Auth0 redirect back to the app) stay in-window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const sameOrigin = new URL(url).origin === APP_ORIGIN;
      // Auth providers must stay inside the app window to complete login.
      const isAuth = /auth0\.com|accounts\.google\.com|login\.|oauth/i.test(url);
      if (sameOrigin || isAuth) return { action: "allow" };
    } catch {
      /* fall through to external */
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Close-to-tray: the first close hides the window and keeps the app resident
  // (so notifications keep working). Quitting for real (tray menu, app menu, or
  // Cmd/Ctrl+Q) sets isQuitting first, letting the window actually close.
  //
  // Linux (incl. WSLg) is excluded: its system tray is unreliable or absent, so
  // a hidden window can't be brought back — there, closing the window quits, as
  // Linux users expect. Windows and macOS have a tray/Dock to restore from.
  mainWindow.on("close", (event) => {
    if (isQuitting || process.platform === "linux") {
      saveWindowState();
      return;
    }
    event.preventDefault();
    saveWindowState();
    mainWindow.hide();
  });

  mainWindow.on("closed", () => {
    clearRetryTimer();
    if (saveStateTimer) {
      clearTimeout(saveStateTimer);
      saveStateTimer = null;
    }
    started = false;
    showingError = false;
    mainWindow = null;
  });
}

function buildMenu() {
  const template = [
    {
      label: "AutoClaw",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        ...(isDev ? [{ role: "toggleDevTools" }, { type: "separator" }] : []),
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(iconPath());
    if (img.isEmpty()) return;
    tray = new Tray(img.resize({ width: 16, height: 16 }));
    tray.setToolTip("AutoClaw");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Open AutoClaw",
          click: () => {
            if (mainWindow) mainWindow.show();
            else createWindow();
          },
        },
        { type: "separator" },
        { role: "quit" },
      ]),
    );
    tray.on("click", () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show();
      } else {
        createWindow();
      }
    });
  } catch {
    /* tray is optional */
  }
}

// Native OS notifications. The web app calls window.autoclawDesktop.notify(...)
// (see preload.js), which routes here so we can use the OS-integrated Electron
// Notification (correct app name/icon on Windows) and focus the window on click.
function showMainWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

// Redirect app state to the drive for portable builds. Must run before `ready`.
configurePortableDataDir();

// Single-instance lock: focus the existing window instead of opening a second.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  // Distinguish a real quit from a close-to-tray so the window "close" handler
  // knows whether to hide or actually close.
  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.whenReady().then(() => {
    // Must be set before any notification is shown (Windows requirement).
    app.setAppUserModelId(APP_ID);
    // Clicking a notification brings the app to the foreground.
    registerNotificationIpc({ iconPath, onClick: showMainWindow });
    // "Retry now" button on the offline page → re-attempt the hosted app.
    ipcMain.handle("autoclaw:retry", () => {
      loadRemoteApp();
      return { ok: true };
    });
    buildMenu();
    createWindow();
    createTray();

    app.on("activate", () => {
      // With close-to-tray the window is hidden, not destroyed — reveal it.
      if (mainWindow) showMainWindow();
      else createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
