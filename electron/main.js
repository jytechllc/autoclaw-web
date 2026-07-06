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
  session,
  clipboard,
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

// How often to re-check for app updates while running (the app is resident in
// the tray, so a long-lived process still picks up new releases same-day).
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// GPU process losses tolerated per session before falling back to software
// rendering (Chromium restarts a crashed GPU process on its own, so a single
// crash is survivable).
const GPU_CRASH_LIMIT = 3;

const isDev = !app.isPackaged;
let mainWindow = null;
let tray = null;
let retryTimer = null;
let started = false; // true once the first remote navigation has been kicked off
let showingError = false; // true while the local offline page is displayed
let isQuitting = false; // true once a real quit is underway (vs. close-to-tray)
let saveStateTimer = null; // debounce for persisting window bounds
let autoUpdater = null; // set by initAutoUpdater() on builds that can self-update
let updateReadyVersion = null; // version string once an update is downloaded
let manualUpdateCheck = false; // menu-triggered check → surface result dialogs
let gpuCrashCount = 0; // GPU process losses this session (see GPU_CRASH_LIMIT)
let savedZoomLevel = 0; // restored zoom level; a fresh page load resets it to 0
// Best-known UI locale for the local splash/offline pages. Seeded from the OS
// locale at startup, then refreshed from the app's `locale` cookie once the
// hosted app has loaded, so these pages match the language the user picked.
let shellLocale = "en";

// Locales the shell's local pages are translated into (mirror lib/i18n).
const SHELL_LOCALES = ["en", "zh", "zh-TW", "ko"];

// Map an OS/cookie locale tag onto one of SHELL_LOCALES, or null if unsupported.
function normalizeLocale(raw) {
  if (!raw || typeof raw !== "string") return null;
  if (SHELL_LOCALES.includes(raw)) return raw;
  const lower = raw.toLowerCase();
  if (lower === "zh-tw" || lower === "zh-hant" || lower.startsWith("zh-hant"))
    return "zh-TW";
  if (lower.startsWith("zh")) return "zh";
  if (lower.startsWith("ko")) return "ko";
  if (lower.startsWith("en")) return "en";
  return null;
}

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
    // Persist the zoom level too, so a user who zooms in/out keeps it across
    // launches (a fresh page load otherwise resets it to 0 = 100%).
    const zoomLevel = mainWindow.webContents.getZoomLevel();
    fs.writeFileSync(
      windowStateFile(),
      JSON.stringify({ ...bounds, isMaximized, zoomLevel }),
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

// ---------------------------------------------------------------------------
// Graphics-acceleration fallback. On machines with broken GPU drivers or
// compositors (old/odd Windows GPUs, remote desktops, WSLg) hardware
// compositing can produce a black or never-shown window while the process
// runs fine. Three escape hatches:
//   - AUTOCLAW_DISABLE_GPU=1 env var (Chromium's own --disable-gpu flag also
//     works) for a single launch,
//   - a persisted "Disable Graphics Acceleration" menu toggle,
//   - automatic fallback when the GPU process keeps dying within one session.

function gpuStateFile() {
  return path.join(app.getPath("userData"), "gpu-state.json");
}

function readGpuDisabled() {
  try {
    const raw = fs.readFileSync(gpuStateFile(), "utf8");
    return JSON.parse(raw).disableHardwareAcceleration === true;
  } catch {
    return false;
  }
}

// Returns false when the flag can't be persisted (e.g. read-only portable
// drive) so callers don't promise that a restart will change anything.
function writeGpuDisabled(disabled) {
  try {
    fs.writeFileSync(
      gpuStateFile(),
      JSON.stringify({ disableHardwareAcceleration: disabled }),
    );
    return true;
  } catch {
    return false;
  }
}

// Must run after configurePortableDataDir() (the flag lives in userData) and
// before app `ready` (Chromium locks in GPU switches at startup). Returns
// whether this launch runs without hardware acceleration.
function applyGpuFallback() {
  const disabled =
    process.env.AUTOCLAW_DISABLE_GPU === "1" || readGpuDisabled();
  if (disabled) {
    // Both calls, to match a real `--disable-gpu` launch: on some drivers
    // disableHardwareAcceleration() alone still spawns a GPU process, which
    // is exactly the part that's broken on machines needing this fallback.
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch("disable-gpu");
  }
  return disabled;
}

function restartApp() {
  // Flag the real quit first so the close-to-tray handler lets the window go.
  isQuitting = true;
  saveWindowState();
  app.relaunch();
  app.exit(0);
}

function promptRestartForGpuChange(message, type) {
  // A GPU crash loop before the first window exists leaves nothing on screen
  // to anchor a dialog, so restart silently. The persisted flag makes the
  // relaunched process start in software rendering, so this cannot loop.
  if (!app.isReady()) {
    restartApp();
    return;
  }
  const choice = dialog.showMessageBoxSync({
    type: type || "info",
    buttons: ["Restart Now", "Later"],
    defaultId: 0,
    cancelId: 1,
    title: "AutoClaw",
    message,
    detail: "The change is applied the next time AutoClaw starts.",
  });
  if (choice === 0) restartApp();
}

// Menu toggle handler. `menuItem.checked` has already flipped to the new
// value by the time click fires.
function toggleGpuFallback(menuItem) {
  if (!writeGpuDisabled(menuItem.checked)) {
    menuItem.checked = !menuItem.checked;
    dialog.showMessageBox({
      type: "warning",
      title: "AutoClaw",
      message: "Could not save the setting.",
      detail: "The app data folder is not writable.",
    });
    return;
  }
  promptRestartForGpuChange(
    menuItem.checked
      ? "Graphics acceleration is now off."
      : "Graphics acceleration is now on.",
  );
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
  // Packaged: electron-builder copies the icon next to the asar (see
  // extraResources in electron-builder.yml). Dev: read it from the repo.
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(__dirname, "..", "electron-resources", "icon.png");
}

function clearRetryTimer() {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}

// Whether a URL is allowed to load inside the main window. Same-origin pages,
// our own local file:// pages (loading/offline), and auth-provider domains
// (which must stay in-window so login can complete) are allowed; everything
// else is treated as an external link. Shared by the new-window handler and the
// will-navigate guard so the two can't drift apart.
function isInAppUrl(url) {
  try {
    const target = new URL(url);
    if (target.protocol === "file:") return true;
    if (target.origin === APP_ORIGIN) return true;
    return /auth0\.com|accounts\.google\.com|login\.|oauth/i.test(url);
  } catch {
    return false;
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
  mainWindow.loadFile(path.join(__dirname, "offline.html"), {
    query: { lang: shellLocale },
  });
  clearRetryTimer();
  retryTimer = setInterval(loadRemoteApp, RETRY_INTERVAL_MS);
}

function createWindow() {
  const saved = readWindowState();
  const bounds = saved || DEFAULT_BOUNDS;
  if (saved && typeof saved.zoomLevel === "number") savedZoomLevel = saved.zoomLevel;

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
      // Run the renderer in Chromium's OS-level sandbox. The preload only uses
      // contextBridge + ipcRenderer, both available under sandbox, so this
      // costs nothing and hardens against a compromised remote page.
      sandbox: true,
      spellcheck: true,
    },
  });

  if (saved && saved.isMaximized) mainWindow.maximize();

  const wc = mainWindow.webContents;

  // Startup: paint a local splash (loading.html) immediately, then navigate to
  // the hosted app once the splash is up. The splash stays visible until the
  // remote first paints (or fails), so cold start is never a blank window.
  mainWindow.loadFile(path.join(__dirname, "loading.html"), {
    query: { lang: shellLocale },
  });
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
    // A fresh document loads at zoom 0; restore the user's saved zoom.
    if (savedZoomLevel) wc.setZoomLevel(savedZoomLevel);
    // Pick up the user's chosen language so a later offline page matches it.
    session.defaultSession.cookies
      .get({ url: APP_ORIGIN, name: "locale" })
      .then((cookies) => {
        const loc = normalizeLocale(cookies[0] && cookies[0].value);
        if (loc) shellLocale = loc;
      })
      .catch(() => {});
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

  // Persist window geometry as the user resizes/moves it, and the zoom level
  // when the user Ctrl/Cmd+scrolls (menu zoom is captured on the next save/quit).
  mainWindow.on("resize", scheduleSaveWindowState);
  mainWindow.on("move", scheduleSaveWindowState);
  wc.on("zoom-changed", scheduleSaveWindowState);

  // Native right-click menu: spellcheck suggestions plus the standard edit
  // actions and "copy link". Without this, right-clicking inside the hosted app
  // does nothing, which feels unlike a real desktop app.
  wc.on("context-menu", (_event, params) => {
    const items = [];

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions) {
        items.push({
          label: suggestion,
          click: () => wc.replaceMisspelling(suggestion),
        });
      }
      if (params.dictionarySuggestions.length === 0) {
        items.push({ label: "No suggestions", enabled: false });
      }
      items.push(
        {
          label: "Add to Dictionary",
          click: () =>
            wc.session.addWordToSpellCheckerDictionary(params.misspelledWord),
        },
        { type: "separator" },
      );
    }

    if (params.isEditable || params.selectionText) {
      items.push(
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { role: "selectAll" },
      );
    }

    if (params.linkURL) {
      if (items.length) items.push({ type: "separator" });
      items.push({
        label: "Copy Link",
        click: () => clipboard.writeText(params.linkURL),
      });
    }

    if (items.length) {
      Menu.buildFromTemplate(items).popup({ window: mainWindow });
    }
  });

  // Open external links (window.open / target=_blank) in the system browser.
  // Same-origin navigations (incl. Auth0 redirect back to the app) stay in-window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isInAppUrl(url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Guard top-level navigations too: a link (or script) that navigates the main
  // frame to an off-app site would otherwise replace the shell with an
  // arbitrary page. Keep in-app URLs in-window and send the rest to the system
  // browser. Programmatic loads (loadURL/loadFile) don't fire this event, so
  // the startup/offline flow is unaffected.
  wc.on("will-navigate", (event, url) => {
    if (isInAppUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url);
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

// ---------------------------------------------------------------------------
// Launch at login. Offered only on packaged Windows/macOS installs: Linux's
// implementation is unreliable across desktop environments, dev runs would just
// register the electron binary, and the portable ("U 盘版") build's whole point
// is to leave no trace on the host — so registering a login item there would
// defeat it (and break once the drive is unplugged).
function loginItemSupported() {
  if (isDev || process.env.PORTABLE_EXECUTABLE_DIR) return false;
  return process.platform === "win32" || process.platform === "darwin";
}

function isOpenAtLogin() {
  if (!loginItemSupported()) return false;
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}

// Menu toggle handler. `menuItem.checked` has already flipped to the new value.
function toggleOpenAtLogin(menuItem) {
  try {
    app.setLoginItemSettings({ openAtLogin: menuItem.checked });
  } catch {
    // Revert the checkbox and report if the OS rejected the change.
    menuItem.checked = !menuItem.checked;
    dialog.showMessageBox({
      type: "warning",
      title: "AutoClaw",
      message: "Could not change the launch-at-login setting.",
    });
  }
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
        // Escape hatch for machines where GPU compositing shows a black or
        // invisible window (see the graphics-acceleration fallback block).
        {
          type: "checkbox",
          label: "Disable Graphics Acceleration",
          checked: gpuDisabled,
          click: toggleGpuFallback,
        },
        ...(loginItemSupported()
          ? [
              {
                type: "checkbox",
                label: "Open at Login",
                checked: isOpenAtLogin(),
                click: toggleOpenAtLogin,
              },
            ]
          : []),
        { type: "separator" },
        ...(isDev ? [{ role: "toggleDevTools" }, { type: "separator" }] : []),
        ...(updaterSupported()
          ? [
              { label: "Check for Updates…", click: manualCheckForUpdates },
              { type: "separator" },
            ]
          : []),
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

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    // Version line so a user can read their version off the tray when asked.
    { label: `AutoClaw v${app.getVersion()}`, enabled: false },
    { type: "separator" },
    {
      label: "Open AutoClaw",
      click: () => {
        if (mainWindow) mainWindow.show();
        else createWindow();
      },
    },
    // Shown only while a downloaded update is waiting (see initAutoUpdater).
    // With close-to-tray the app can stay resident for days, so the tray is
    // the one place a pending update stays visible without stealing focus.
    ...(updateReadyVersion
      ? [
          {
            label: `Restart to Update (v${updateReadyVersion})`,
            click: restartToInstall,
          },
        ]
      : []),
    ...(updaterSupported()
      ? [{ label: "Check for Updates…", click: manualCheckForUpdates }]
      : []),
    { type: "separator" },
    { role: "quit" },
  ]);
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(iconPath());
    if (img.isEmpty()) return;
    tray = new Tray(img.resize({ width: 16, height: 16 }));
    tray.setToolTip("AutoClaw");
    tray.setContextMenu(buildTrayMenu());
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

// ---------------------------------------------------------------------------
// Auto-update. electron-updater reads the feed URL baked into the package by
// electron-builder (`publish` in electron-builder.yml → app-update.yml), which
// points at the repo's GitHub Releases. Only builds with an installer can
// update themselves:
//   - Windows NSIS install: the primary channel — fully supported.
//   - Windows portable: the exe on the drive can't replace itself → skipped.
//   - Linux: only AppImage has in-place update support (APPIMAGE env is set).
//   - macOS: electron-updater requires a code-signed app; ours is unsigned.
function updaterSupported() {
  if (isDev) return false;
  if (process.platform === "win32") return !process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.platform === "linux") return Boolean(process.env.APPIMAGE);
  return false;
}

function initAutoUpdater() {
  if (!updaterSupported()) return;
  // Lazy require so a packaging problem degrades to "no auto-update" instead
  // of taking the whole app down at startup.
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (err) {
    console.error("auto-update unavailable:", err);
    autoUpdater = null;
    return;
  }

  autoUpdater.autoDownload = true;
  // Even when the user picks "Later", the update applies on the next quit.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    dialog.showMessageBox({
      type: "info",
      title: "AutoClaw",
      message: `AutoClaw ${info.version} is available.`,
      detail:
        "It is downloading in the background — you'll be asked to restart once it's ready.",
    });
  });

  autoUpdater.on("update-not-available", () => {
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    dialog.showMessageBox({
      type: "info",
      title: "AutoClaw",
      message: "You're up to date.",
      detail: `AutoClaw ${app.getVersion()} is the latest version.`,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    updateReadyVersion = info.version;
    refreshTrayMenu();
    // Prompt only when the window is actually on screen. If it's hidden in
    // the tray, don't steal focus — the tray shows "Restart to Update" and
    // autoInstallOnAppQuit applies the update on the next quit anyway.
    if (mainWindow && mainWindow.isVisible()) {
      dialog
        .showMessageBox(mainWindow, {
          type: "info",
          buttons: ["Restart Now", "Later"],
          defaultId: 0,
          cancelId: 1,
          title: "AutoClaw",
          message: `AutoClaw ${info.version} is ready to install.`,
          detail:
            "Restart now to apply the update, or it will be installed automatically the next time you quit.",
        })
        .then(({ response }) => {
          if (response === 0) restartToInstall();
        });
    }
  });

  // Failed checks are routine for a desktop client (offline, firewalled,
  // GitHub unreachable) — log and retry next cycle instead of nagging. Only a
  // user-initiated check surfaces the failure.
  autoUpdater.on("error", (err) => {
    console.error("auto-update error:", err);
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    dialog.showMessageBox({
      type: "warning",
      title: "AutoClaw",
      message: "Could not check for updates.",
      detail: String((err && err.message) || err),
    });
  });

  // First check shortly after startup (don't compete with the initial page
  // load), then periodically while the app stays resident. Rejections are
  // already reported via the "error" event above.
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 15000);
  setInterval(
    () => autoUpdater.checkForUpdates().catch(() => {}),
    UPDATE_CHECK_INTERVAL_MS,
  );
}

// Result dialogs are deliberately parentless: a tray-triggered check can run
// while the main window is hidden, and a dialog modal to a hidden window
// would be invisible.
function manualCheckForUpdates() {
  if (!autoUpdater) return;
  manualUpdateCheck = true;
  autoUpdater.checkForUpdates().catch(() => {});
}

function restartToInstall() {
  if (!autoUpdater) return;
  // Flag the real quit first so the close-to-tray handler lets the window go.
  isQuitting = true;
  // Silent install matters: with oneClick:false a non-silent run would pop
  // the full NSIS wizard. isForceRunAfter relaunches the app once installed.
  autoUpdater.quitAndInstall(true, true);
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

// Navigate the main window to a notification's deep-link. Accepts a same-origin
// path ("/campaigns/123") or full URL; resolved against APP_ORIGIN and rejected
// unless it lands in-app, so a crafted notification can't steer the shell to an
// arbitrary site.
function navigateInApp(target) {
  if (!mainWindow || typeof target !== "string" || !target) return;
  let resolved;
  try {
    resolved = new URL(target, APP_ORIGIN).toString();
  } catch {
    return;
  }
  if (!isInAppUrl(resolved)) return;
  mainWindow.webContents.loadURL(resolved);
}

// Redirect app state to the drive for portable builds. Must run before `ready`.
configurePortableDataDir();

// Apply the persisted/env graphics fallback — also must run before `ready`.
const gpuDisabled = applyGpuFallback();

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

  // GPU process crash loop → fall back to software rendering. A session that
  // keeps losing its GPU process usually means a broken driver and ends as a
  // black window, so persist the fallback and offer a restart (silent restart
  // when it happens before the first window is up).
  app.on("child-process-gone", (_event, details) => {
    if (gpuDisabled || details.type !== "GPU") return;
    const fatal = ["crashed", "abnormal-exit", "launch-failed", "killed"];
    if (!fatal.includes(details.reason)) return;
    gpuCrashCount += 1;
    // Strict equality so the dialog shows once, not on every crash after it.
    if (gpuCrashCount !== GPU_CRASH_LIMIT) return;
    if (!writeGpuDisabled(true)) return;
    promptRestartForGpuChange(
      "Graphics acceleration has been turned off because the display driver keeps failing.",
      "warning",
    );
  });

  app.whenReady().then(() => {
    // Must be set before any notification is shown (Windows requirement).
    app.setAppUserModelId(APP_ID);

    // Seed the splash/offline-page language from the OS locale (available only
    // after ready). Refined from the app's locale cookie once it has loaded.
    shellLocale = normalizeLocale(app.getLocale()) || "en";

    // Deny web permission requests the shell doesn't need (camera, mic,
    // geolocation, MIDI, etc.). Native OS notifications go through the preload
    // bridge (see notify.js), not the web Notification API, so that permission
    // isn't needed either. clipboard-sanitized-write is allowed for copy
    // buttons. Anything not explicitly allowed is denied.
    const allowedPermissions = new Set(["clipboard-sanitized-write"]);
    session.defaultSession.setPermissionRequestHandler(
      (_wc, permission, callback) => callback(allowedPermissions.has(permission)),
    );
    // Clicking a notification brings the app to the foreground and, if the
    // notification carried a deep-link, navigates to it in-window.
    registerNotificationIpc({
      iconPath,
      onActivate: (url) => {
        showMainWindow();
        if (url) navigateInApp(url);
      },
    });
    // "Retry now" button on the offline page → re-attempt the hosted app.
    ipcMain.handle("autoclaw:retry", () => {
      loadRemoteApp();
      return { ok: true };
    });
    buildMenu();
    createWindow();
    createTray();
    initAutoUpdater();

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
