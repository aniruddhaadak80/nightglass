import type { InstrumentProfile, SiteProfile, SkyConditions, SkyObject } from "@/lib/types";

/**
 * Fixtures shared by the astronomy and engine tests.
 *
 * These are deliberately hand-written rather than captured from a live feed so
 * the assertions stay deterministic and do not depend on the network.
 */

export function star(overrides: Partial<SkyObject> = {}): SkyObject {
  return {
    id: "V/50:1",
    name: "Test Star",
    designation: "α Test",
    kind: "star",
    raDeg: 10.0,
    decDeg: 20.0,
    magnitude: 1.5,
    angularSizeArcmin: null,
    constellation: "Test",
    blurb: "A bright test star.",
    sourceId: "1",
    catalog: "Bright Star Catalogue (V/50)",
    ...overrides,
  };
}

export function site(overrides: Partial<SiteProfile> = {}): SiteProfile {
  return {
    name: "Test Site",
    latitudeDeg: 40.0,
    longitudeDeg: 0.0,
    bortle: 5,
    horizonDeg: 10,
    timezone: "UTC",
    ...overrides,
  };
}

export function instrument(overrides: Partial<InstrumentProfile> = {}): InstrumentProfile {
  return {
    name: "200 mm Newtonian",
    apertureMm: 200,
    magnification: 120,
    type: "reflector",
    ...overrides,
  };
}

export function conditions(overrides: Partial<SkyConditions> = {}): SkyConditions {
  return {
    status: "live",
    fetchedAt: "2026-10-06T00:00:00.000Z",
    source: {
      id: "open-meteo",
      label: "Open-Meteo",
      attribution: "https://open-meteo.com/",
      endpoint: "https://api.open-meteo.com/v1/forecast",
    },
    degradedReason: null,
    cloudCoverPct: 10,
    cloudLowPct: 5,
    cloudMidPct: 3,
    cloudHighPct: 2,
    visibilityMeters: 24000,
    windSpeedKph: 8,
    temperatureC: 12,
    humidityPct: 60,
    transparency: 0.9,
    seeing: 0.75,
    ...overrides,
  };
}

/** A mid-latitude site in late autumn: a genuinely dark, long night. */
export const DARK_NIGHT = {
  nightOf: "2026-10-06",
  site: site({ latitudeDeg: 40.0, longitudeDeg: -3.0, bortle: 5, horizonDeg: 10 }),
};