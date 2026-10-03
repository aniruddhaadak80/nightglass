/**
 * Preload bridge.
 *
 * The renderer runs a remote origin with context isolation and sandboxing on, so
 * this is the entire surface the page can reach. Three methods, no Node access,
 * no arbitrary channel.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nightglassDesktop", {
  /** True when running inside the desktop shell rather than a plain browser. */
  isDesktop: true,

  platform: () => ipcRenderer.invoke("nightglass:platform"),

  /**
   * Show a native OS notification. Returns whether it was actually shown, so
   * the caller can fall back to an in-page message rather than assuming success.
   */
  notify: (title, body) => ipcRenderer.invoke("nightglass:notify", { title, body }),

  /**
   * Save text through the native dialog.
   * @returns {Promise<{ok: boolean, path?: string, reason?: string}>}
   */
  saveTextFile: (suggestedName, contents, filters) =>
    ipcRenderer.invoke("nightglass:saveTextFile", { suggestedName, contents, filters }),
});