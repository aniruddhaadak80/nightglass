"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BortleClass, InstrumentProfile, InstrumentType, SiteProfile } from "@/lib/types";
import { SETTINGS_INSTRUMENT_KEY, SETTINGS_SITE_KEY, useLocalSetting } from "@/lib/use-local-setting";

const BORTLE_NOTES: Record<number, string> = {
  1: "Truly dark site, zodiacal light casts shadows.",
  2: "Typical truly dark site, airglow visible.",
  3: "Rural sky, some light domes on the horizon.",
  4: "Rural/suburban transition, light domes in several directions.",
  5: "Suburban sky, Milky Way washed out near the horizon.",
  6: "Bright suburban sky, Milky Way only visible near zenith.",
  7: "Suburban/urban transition, Milky Way not visible.",
  8: "City sky, only bright objects and constellations visible.",
  9: "Inner-city sky, only the Moon, planets and brightest stars.",
};

/**
 * Site and instrument configuration.
 *
 * Stored in local storage on purpose: the app has no accounts, and a person&rsquo;s
 * observing site is not something to put in a database behind their back. The
 * values are still sent to this app&rsquo;s own API whenever a briefing is
 * computed, because the engine needs them.
 */
export function SiteSettings({
  defaultSite,
  defaultInstrument,
}: {
  defaultSite: SiteProfile;
  defaultInstrument: InstrumentProfile;
}) {
  const router = useRouter();
  const [storedSite, setStoredSite] = useLocalSetting<SiteProfile>(SETTINGS_SITE_KEY, defaultSite);
  const [storedInstrument, setStoredInstrument] = useLocalSetting<InstrumentProfile>(
    SETTINGS_INSTRUMENT_KEY,
    defaultInstrument,
  );
  // Edits are held locally until Save is pressed, so a half-typed latitude never
  // reaches the ranking.
  const [site, setSite] = useState<SiteProfile>(storedSite);
  const [instrument, setInstrument] = useState<InstrumentProfile>(storedInstrument);
  const [saved, setSaved] = useState(false);

  function persist(nextSite: SiteProfile, nextInstrument: InstrumentProfile) {
    setStoredSite(nextSite);
    setStoredInstrument(nextInstrument);
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="mt-8 space-y-6">
      <section className="plate plate-ticked p-5" aria-labelledby="site">
        <h2 id="site" className="plate-caption">
          Observing site
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mono-label">Label</span>
            <input
              className="field mt-1"
              value={site.name}
              onChange={(e) => setSite({ ...site, name: e.target.value })}
              data-testid="settings-name"
            />
          </label>

          <label className="block">
            <span className="mono-label">Latitude (°N)</span>
            <input
              type="number"
              step="0.0001"
              min={-90}
              max={90}
              className="field mt-1"
              value={site.latitudeDeg}
              onChange={(e) => setSite({ ...site, latitudeDeg: Number(e.target.value) })}
              data-testid="settings-lat"
            />
          </label>

          <label className="block">
            <span className="mono-label">Longitude (°E)</span>
            <input
              type="number"
              step="0.0001"
              min={-180}
              max={180}
              className="field mt-1"
              value={site.longitudeDeg}
              onChange={(e) => setSite({ ...site, longitudeDeg: Number(e.target.value) })}
              data-testid="settings-lon"
            />
          </label>

          <label className="block">
            <span className="mono-label">Bortle class</span>
            <select
              className="field mt-1"
              value={site.bortle}
              onChange={(e) => setSite({ ...site, bortle: Number(e.target.value) as BortleClass })}
              data-testid="settings-bortle"
            >
              {Object.keys(BORTLE_NOTES).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-bone-400">{BORTLE_NOTES[site.bortle]}</span>
          </label>

          <label className="block">
            <span className="mono-label">Horizon obstruction (°)</span>
            <input
              type="number"
              min={0}
              max={80}
              step="1"
              className="field mt-1"
              value={site.horizonDeg}
              onChange={(e) => setSite({ ...site, horizonDeg: Number(e.target.value) })}
              data-testid="settings-horizon"
            />
            <span className="mt-1 block text-xs text-bone-400">
              The height of your trees or roof line above the true horizon.
            </span>
          </label>

          <label className="block">
            <span className="mono-label">IANA timezone</span>
            <input
              className="field mt-1"
              value={site.timezone}
              onChange={(e) => setSite({ ...site, timezone: e.target.value })}
              placeholder="Europe/London"
              data-testid="settings-tz"
            />
            <span className="mt-1 block text-xs text-bone-400">
              Used only to render clock times. Use <code>auto</code> to show UTC.
            </span>
          </label>
        </div>
      </section>

      <section className="plate plate-ticked p-5" aria-labelledby="instrument">
        <h2 id="instrument" className="plate-caption">
          Instrument
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mono-label">Name</span>
            <input
              className="field mt-1"
              value={instrument.name}
              onChange={(e) => setInstrument({ ...instrument, name: e.target.value })}
              data-testid="settings-instrument-name"
            />
          </label>

          <label className="block">
            <span className="mono-label">Aperture (mm)</span>
            <input
              type="number"
              min={0}
              max={2000}
              className="field mt-1"
              value={instrument.apertureMm}
              onChange={(e) => setInstrument({ ...instrument, apertureMm: Number(e.target.value) })}
              data-testid="settings-aperture"
            />
          </label>

          <label className="block">
            <span className="mono-label">Magnification (×)</span>
            <input
              type="number"
              min={0}
              max={2000}
              className="field mt-1"
              value={instrument.magnification}
              onChange={(e) => setInstrument({ ...instrument, magnification: Number(e.target.value) })}
              data-testid="settings-magnification"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mono-label">Type</span>
            <select
              className="field mt-1"
              value={instrument.type}
              onChange={(e) => setInstrument({ ...instrument, type: e.target.value as InstrumentType })}
              data-testid="settings-instrument-type"
            >
              {["refractor", "reflector", "catadioptric", "binocular", "naked-eye"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => persist(site, instrument)}
            data-testid="settings-save"
          >
            Save
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              window.localStorage.removeItem(SETTINGS_SITE_KEY);
              window.localStorage.removeItem(SETTINGS_INSTRUMENT_KEY);
              window.dispatchEvent(new Event(SETTINGS_SITE_KEY));
              window.dispatchEvent(new Event(SETTINGS_INSTRUMENT_KEY));
              setSite(defaultSite);
              setInstrument(defaultInstrument);
              setSaved(false);
              router.refresh();
            }}
          >
            Reset to defaults
          </button>
          {saved ? (
            <span className="text-xs text-brass-300" role="status">
              Saved. Tonight&rsquo;s ranking now uses these values.
            </span>
          ) : null}
        </div>
      </section>

      <p className="text-xs leading-relaxed text-bone-400">
        Settings live in this browser&rsquo;s local storage only. There is no account and no server-side
        profile. Clearing site data resets them to the defaults, which currently describe a
        suburban site at 28.6139°N, 77.209°E.
      </p>
    </div>
  );
}