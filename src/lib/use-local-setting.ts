"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

/**
 * Read and write a JSON object in local storage, without an effect.
 *
 * Two components need the value of a persisted setting before their first paint
 * and the settings themselves are browser-only. Reading it in an effect and
 * copying it into state is the usual approach and it produces a second render
 * pass with the wrong values in it; `useSyncExternalStore` is the primitive
 * designed for exactly this, and it stays correct across hydration because the
 * server snapshot is the default.
 *
 * Snapshot identity is cached against the raw string so that repeated renders
 * return the same object reference. `useSyncExternalStore` requires that: a
 * fresh object on every call makes React believe the store changed.
 */
export function useLocalSetting<T extends object>(key: string, fallback: T): [T, (next: T) => void] {
  const cache = useRef<{ raw: string | null; value: T }>({ raw: null, value: fallback });

  const subscribe = useCallback(
    (onChange: () => void) => {
      // The `storage` event covers other tabs; a local custom event covers
      // writes from this page.
      window.addEventListener("storage", onChange);
      window.addEventListener(key, onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(key, onChange);
      };
    },
    [key],
  );

  const getSnapshot = useCallback(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      raw = null;
    }
    if (raw === cache.current.raw) return cache.current.value;

    let value = fallback;
    if (raw) {
      try {
        value = { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
      } catch {
        // A corrupt entry is not worth breaking the page over.
        value = fallback;
      }
    }
    cache.current = { raw, value };
    return value;
  }, [key, fallback]);

  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage can be full or blocked; the in-page value still updates below.
      }
      // Force a re-read: notify subscribers so the snapshot is recomputed.
      window.dispatchEvent(new Event(key));
    },
    [key],
  );

  return [value, setValue];
}

export const SETTINGS_SITE_KEY = "nightglass.site";
export const SETTINGS_INSTRUMENT_KEY = "nightglass.instrument";