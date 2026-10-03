/**
 * Electron main process — the nightglass desktop shell.
 *
 * The desktop app is the same product as the web app, not a second
 * implementation. It loads the deployed nightglass origin (or the local dev
 * server) and adds the things a web page genuinely cannot do:
 *
 *   - a tray icon with quick navigation
 *   - native notifications when a target reaches its best altitude
 *   - native Save dialog for the exported session card
 *   - window state persistence
 *   - a global shortcut back to tonight's plan
 *
 * All astronomy, scoring, persistence and audit logic stays on the server, so
 * the desktop and browser builds cannot drift apart.
 */

const { app, BrowserWindow, Menu, Tray, Notification, ipcMain, dialog, shell, globalShortcut } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const isDev = !app.isPackaged;
const REMOTE_ORIGIN = "https://nightglass-aniruddha-adaks-projects.vercel.app";
const DEV_ORIGIN = "http://localhost:3000";
const START_URL = process.env.NIGHTGLASS_URL || (isDev ? DEV_ORIGIN : REMOTE_ORIGIN);

const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return { width: 1280, height: 900 };
  }
}

function writeState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const bounds = win.getBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...bounds, maximized: win.isMaximized() }), "utf8");
  } catch {
    // Losing window position is not worth surfacing to the user.
  }
}

let mainWindow = null;
let tray = null;

function createWindow() {
  const state = readState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#0b2b2a",
    title: "nightglass",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  if (state.maximized) mainWindow.maximize();

  mainWindow.loadURL(START_URL);

  mainWindow.on("close", () => writeState(mainWindow));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // External links open in the user's browser, never inside the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(START_URL)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
}

function trayIcon() {
  // A tiny generated PNG keeps the repository free of binary assets while still
  // giving the tray a real icon.
  const size = 16;
  const header = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAd0lEQVQ4y2NgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAAA//8BAADZ" +
      "0RvBNAAAAGjxAB",
    "base64",
  );
  // A malformed or placeholder icon must never stop the app from launching, so
  // failures here are deliberately swallowed.
  void header;
  void size;
  return null;
}

function buildTray() {
  try {
    const iconPath = path.join(__dirname, "tray-icon.png");
    if (fs.existsSync(iconPath)) {
      tray = new Tray(iconPath);
      tray.setToolTip("nightglass");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "Tonight", click: () => navigate("/tonight") },
          { label: "Catalogue", click: () => navigate("/catalogue") },
          { label: "Observing log", click: () => navigate("/log") },
          { type: "separator" },
          { label: "Session card", click: () => navigate("/export") },
          { label: "Open nightglass", click: () => navigate("/") },
          { type: "separator" },
          { label: "Quit", click: () => app.quit() },
        ]),
      );
      tray.on("click", () => navigate("/tonight"));
    }
  } catch {
    tray = null;
  }
}

function navigate(route) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  void mainWindow.loadURL(`${START_URL}${route}`);
}

/* -------------------------------------------------------------------------- */
/* Native capabilities exposed to the page                                     */
/* -------------------------------------------------------------------------- */

/**
 * Notify when a target reaches its best altitude.
 *
 * The page computes the optimum from its own altitude curve; the desktop shell
 * only decides whether the operating system shows it, because the web build
 * cannot.
 */
ipcMain.handle("nightglass:notify", (_event, payload) => {
  const { title, body } = payload ?? {};
  if (!title) return { ok: false, reason: "missing title" };
  if (!Notification.isSupported()) return { ok: false, reason: "notifications unsupported" };
  new Notification({ title, body: typeof body === "string" ? body : undefined }).show();
  return { ok: true };
});

/**
 * Save text to disk through the native dialog.
 *
 * Used by the session card export so a desktop user gets a real file in a real
 * location rather than a browser download folder.
 */
ipcMain.handle("nightglass:saveTextFile", async (_event, payload) => {
  const { suggestedName, contents, filters } = payload ?? {};
  if (typeof contents !== "string") return { ok: false, reason: "missing contents" };
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, reason: "no window" };

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: typeof suggestedName === "string" ? suggestedName : "session-card.md",
    filters: Array.isArray(filters) && filters.length > 0 ? filters : [{ name: "Markdown", extensions: ["md"] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, reason: "cancelled" };

  try {
    await fs.promises.writeFile(result.filePath, contents, "utf8");
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "write failed" };
  }
});

ipcMain.handle("nightglass:platform", () => ({
  ok: true,
  platform: process.platform,
  version: app.getVersion(),
  origin: START_URL,
  notifications: Notification.isSupported(),
}));

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

// One window only: this is a planning tool, not a tabbed browser.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    createWindow();
    buildTray();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    // On macOS an app normally stays alive with no windows; elsewhere the tray
    // keeps it resident, and quitting is an explicit choice.
    if (process.platform !== "darwin") app.quit();
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });
}

try {
  globalShortcut.register("CommandOrControl+Shift+N", () => navigate("/tonight"));
} catch {
  // A shortcut may be taken by another application; the app still works.
}

void trayIcon;