/**
 * Desktop bridge for the nightglass UI.
 *
 * The web build has no access to this, so every capability is feature-detected
 * and every call degrades to something honest. Nothing here assumes a desktop
 * runtime exists: on a plain browser `window.nightglassDesktop` is undefined
 * and each helper reports that rather than throwing.
 *
 * This is the *only* module that touches the Electron bridge, so the desktop
 * surface stays in one auditable place.
 */

declare global {
  interface Window {
    nightglassDesktop?: {
      isDesktop: true;
      platform(): Promise<{ ok: boolean; platform: string; version: string; origin: string; notifications: boolean }>;
      notify(title: string, body?: string): Promise<{ ok: boolean; reason?: string }>;
      saveTextFile(
        suggestedName: string,
        contents: string,
        filters?: Array<{ name: string; extensions: string[] }>,
      ): Promise<{ ok: boolean; path?: string; reason?: string }>;
    };
  }
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && Boolean(window.nightglassDesktop);
}

/**
 * Native notification, when the desktop shell provides one.
 *
 * Returns `null` in a browser so callers can decide what to do rather than
 * treating "no desktop" as a failure.
 */
export async function desktopNotify(title: string, body?: string): Promise<{ ok: boolean; reason?: string } | null> {
  if (!isDesktop()) return null;
  try {
    return await window.nightglassDesktop!.notify(title, body);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "notification failed" };
  }
}

/** Save a session card through the native dialog, or `null` in a browser. */
export async function desktopSave(
  suggestedName: string,
  contents: string,
): Promise<{ ok: boolean; path?: string; reason?: string } | null> {
  if (!isDesktop()) return null;
  try {
    return await window.nightglassDesktop!.saveTextFile(suggestedName, contents);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "save failed" };
  }
}

/** Describe the host, for the Settings page. */
export async function desktopInfo(): Promise<{ platform: string; version: string; origin: string } | null> {
  if (!isDesktop()) return null;
  try {
    const result = await window.nightglassDesktop!.platform();
    return result.ok ? { platform: result.platform, version: result.version, origin: result.origin } : null;
  } catch {
    return null;
  }
}