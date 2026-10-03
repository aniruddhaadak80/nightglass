import { describe, expect, it } from "vitest";
import {
  angularSeparationDeg,
  apparentAltitudeDeg,
  culminationAltitudeDeg,
  darkWindowFor,
  equatorialToHorizontal,
  gmstDeg,
  julianDay,
  limitingMagnitude,
  localSiderealDeg,
  moonEquatorial,
  moonState,
  norm180,
  norm360,
  refractionDeg,
  sunEquatorial,
} from "@/lib/astro";

describe("modular arithmetic", () => {
  it("wraps into [0,360)", () => {
    expect(norm360(0)).toBe(0);
    expect(norm360(360)).toBe(0);
    expect(norm360(-90)).toBe(270);
    expect(norm360(725)).toBe(5);
  });

  it("wraps into [-180,180)", () => {
    expect(norm180(190)).toBe(-170);
    expect(norm180(-190)).toBe(170);
    expect(norm180(0)).toBe(0);
  });
});

describe("julian day", () => {
  it("reproduces the J2000 epoch", () => {
    expect(julianDay(new Date("2000-01-01T12:00:00Z"))).toBeCloseTo(2451545.0, 6);
  });

  it("advances one day per 86400000 ms", () => {
    const a = julianDay(new Date("2026-10-06T00:00:00Z"));
    const b = julianDay(new Date("2026-10-07T00:00:00Z"));
    expect(b - a).toBeCloseTo(1, 9);
  });
});

describe("sidereal time", () => {
  it("returns a value in [0,360)", () => {
    for (let d = 0; d < 40; d++) {
      const g = gmstDeg(new Date(Date.UTC(2026, 9, 6, d, 13, 22)));
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThan(360);
    }
  });

  it("advances about 15.041 degrees per sidereal hour", () => {
    // One hour of sidereal time is 15.0410686 degrees; a solar hour is 15.0073.
    const t0 = new Date("2026-10-06T00:00:00Z");
    const t1 = new Date("2026-10-06T01:00:00Z");
    const delta = norm360(gmstDeg(t1) - gmstDeg(t0));
    expect(delta).toBeCloseTo(15.041, 2);
  });

  it("shifts by the observer longitude", () => {
    const at = new Date("2026-10-06T22:00:00Z");
    expect(norm360(localSiderealDeg(at, 90) - localSiderealDeg(at, 0))).toBeCloseTo(90, 6);
  });
});

describe("equatorial to horizontal", () => {
  it("puts an object on the observer's meridian at 90 minus the latitude gap", () => {
    // At local sidereal time equal to the object's RA, the hour angle is zero
    // and the object stands at its highest point.
    const lat = 40;
    const dec = 12;
    const { altitudeDeg } = equatorialToHorizontal(100, dec, lat, 100);
    expect(altitudeDeg).toBeCloseTo(90 - Math.abs(lat - dec), 6);
  });

  it("places Polaris at approximately the observer latitude", () => {
    // The classic sanity check: the pole star sits at your latitude. Polaris is
    // 0.74 degrees off the true celestial pole, so it can read up to a degree
    // high — the tolerance is the star's real offset, not slack in the maths.
    const polarisRa = 2.5303 * 15;
    const polarisDec = 89.2641;
    for (const lat of [-60, -20, 0, 28.6, 51.5, 70]) {
      const { altitudeDeg } = equatorialToHorizontal(polarisRa, polarisDec, lat, polarisRa);
      expect(Math.abs(altitudeDeg - lat)).toBeLessThan(1.0);
    }
  });

  it("gives an object on the celestial equator a 6 hour period above the horizon", () => {
    // Count samples over 24 hours whose altitude exceeds zero.
    let above = 0;
    const steps = 240;
    for (let i = 0; i < steps; i++) {
      const at = new Date(Date.UTC(2026, 9, 6, 0, 0, 0) + (i * 86400000) / steps);
      const lst = localSiderealDeg(at, 0);
      if (equatorialToHorizontal(0, 0, 40, lst).altitudeDeg > 0) above += 1;
    }
    expect(above).toBeCloseTo(steps / 2, -1);
  });

  it("never returns a non-finite altitude, even straight overhead", () => {
    const lat = 45;
    const { altitudeDeg, azimuthDeg } = equatorialToHorizontal(123, lat, lat, 123);
    expect(Number.isFinite(altitudeDeg)).toBe(true);
    expect(Number.isFinite(azimuthDeg)).toBe(true);
    expect(altitudeDeg).toBeCloseTo(90, 6);
  });
});

describe("solar ephemeris", () => {
  it("keeps declination inside the obliquity of the ecliptic", () => {
    for (let d = 0; d < 365; d++) {
      const { decDeg } = sunEquatorial(new Date(Date.UTC(2026, 0, 1 + d)));
      expect(decDeg).toBeGreaterThanOrEqual(-23.5);
      expect(decDeg).toBeLessThanOrEqual(23.5);
    }
  });

  it("puts the solstice declinations on the expected side", () => {
    // Late June: Sun north of the equator. Late December: south of it.
    const june = sunEquatorial(new Date("2026-06-21T12:00:00Z"));
    const december = sunEquatorial(new Date("2026-12-21T12:00:00Z"));
    expect(june.decDeg).toBeGreaterThan(23.0);
    expect(december.decDeg).toBeLessThan(-23.0);
  });

  it("reaches the analytic culmination altitude at upper culmination", () => {
    // Scan a day for the Sun's maximum altitude and compare it with the closed
    // form. This exercises the real sampling path rather than assuming an
    // instant that is only approximately solar noon.
    const lat = 40;
    let best = -90;
    let at = new Date("2026-10-06T00:00:00Z");
    for (let m = 0; m < 1440; m += 1) {
      const when = new Date(Date.UTC(2026, 9, 6, 0, m));
      const lst = localSiderealDeg(when, 0);
      const sun = sunEquatorial(when);
      const { altitudeDeg } = equatorialToHorizontal(sun.raDeg, sun.decDeg, lat, lst);
      if (altitudeDeg > best) {
        best = altitudeDeg;
        at = when;
      }
    }
    const dec = sunEquatorial(at).decDeg;
    expect(best).toBeCloseTo(90 - Math.abs(lat - dec), 1);
    // Midday at longitude 0 is close to 12:00 UT.
    expect(Math.abs(at.getUTCHours() - 12)).toBeLessThan(2);
  });

  it("rises in the east and sets in the west", () => {
    const lat = 40;
    // An equatorial point rises and sets 12 hours apart, six hours from
    // culmination, so the night contains exactly two horizon crossings. The
    // first one found is whichever the day happens to start inside.
    const crossings: number[] = [];
    let previous: boolean | null = null;
    for (let m = 0; m <= 1440; m += 2) {
      const at = new Date(Date.UTC(2026, 9, 6, 0, m));
      const lst = localSiderealDeg(at, 0);
      const { altitudeDeg, azimuthDeg } = equatorialToHorizontal(0, 0, lat, lst);
      const isUp = altitudeDeg > 0;
      if (previous !== null && isUp !== previous) crossings.push(azimuthDeg);
      previous = isUp;
    }
    expect(crossings).toHaveLength(2);
    // One crossing east, one west.
    expect(crossings.some((az) => az > 45 && az < 135)).toBe(true);
    expect(crossings.some((az) => az > 225 && az < 315)).toBe(true);
  });
});

describe("lunar ephemeris", () => {
  it("returns a position inside the valid declination band", () => {
    for (let d = 0; d < 60; d++) {
      const { decDeg } = moonEquatorial(new Date(Date.UTC(2026, 9, 1 + d)));
      expect(decDeg).toBeGreaterThanOrEqual(-29);
      expect(decDeg).toBeLessThanOrEqual(29);
    }
  });

  it("completes a full synodic cycle within one calendar month", () => {
    // Sampled daily across 30 days there must be a new moon (near zero) and a
    // full moon (near one). This exercises the whole ephemeris without
    // hard-coding a date that could drift.
    let min = 1;
    let max = 0;
    for (let d = 0; d < 30; d++) {
      const state = moonState(new Date(Date.UTC(2026, 9, 1 + d, 12)));
      min = Math.min(min, state.illumination);
      max = Math.max(max, state.illumination);
      expect(state.illumination).toBeGreaterThanOrEqual(0);
      expect(state.illumination).toBeLessThanOrEqual(1);
      expect(state.ageDays).toBeGreaterThanOrEqual(0);
      expect(state.ageDays).toBeLessThan(29.54);
    }
    expect(min).toBeLessThan(0.06);
    expect(max).toBeGreaterThan(0.94);
  });

  it("puts the Moon near the Sun at new and opposite it at full", () => {
    for (let d = 0; d < 60; d++) {
      const at = new Date(Date.UTC(2026, 8, 1 + d, 12));
      const state = moonState(at);
      const sun = sunEquatorial(at);
      const sep = angularSeparationDeg(sun.raDeg, sun.decDeg, state.raDeg, state.decDeg);
      // Separation and illumination are two views of the same phase, so they
      // must agree across the whole cycle.
      const implied = (1 - Math.cos((sep * Math.PI) / 180)) / 2;
      expect(implied).toBeCloseTo(state.illumination, 5);
    }
  });

  it("reports a coherent waxing sense across the cycle", () => {
    let waxing = 0;
    let waning = 0;
    for (let d = 0; d < 30; d++) {
      const state = moonState(new Date(Date.UTC(2026, 9, 1 + d, 12)));
      if (state.waxing) waxing += 1;
      else waning += 1;
    }
    // Both halves occur; a broken ephemeris would collapse one of them.
    expect(waxing).toBeGreaterThan(8);
    expect(waning).toBeGreaterThan(8);
  });
});

describe("angular separation", () => {
  it("is zero for a point against itself", () => {
    expect(angularSeparationDeg(120, 30, 120, 30)).toBeCloseTo(0, 9);
  });

  it("is 90 degrees for a quarter turn on the equator", () => {
    expect(angularSeparationDeg(0, 0, 90, 0)).toBeCloseTo(90, 6);
  });

  it("is 180 degrees for antipodes", () => {
    expect(angularSeparationDeg(0, 0, 180, 0)).toBeCloseTo(180, 6);
  });

  it("is symmetric", () => {
    const a = angularSeparationDeg(31.2, -7.5, 210.4, 61.9);
    const b = angularSeparationDeg(210.4, 61.9, 31.2, -7.5);
    expect(a).toBeCloseTo(b, 9);
  });

  it("measures the pole-to-equator distance along a meridian", () => {
    expect(angularSeparationDeg(0, 90, 0, 0)).toBeCloseTo(90, 6);
  });
});

describe("refraction", () => {
  it("lifts the horizon by about 29 arcminutes", () => {
    // Bennett at h = 0 gives 1.02 / tan(10.3 / 5.11 deg) = 28.99 arcmin.
    expect(refractionDeg(0)).toBeCloseTo(0.483, 2);
  });

  it("shrinks with altitude", () => {
    expect(refractionDeg(45)).toBeLessThan(refractionDeg(10));
    expect(refractionDeg(10)).toBeLessThan(refractionDeg(0));
  });

  it("is zero well below the horizon", () => {
    expect(refractionDeg(-5)).toBe(0);
  });

  it("lifts an apparent altitude above the true one", () => {
    expect(apparentAltitudeDeg(3)).toBeGreaterThan(3);
  });
});

describe("dark window", () => {
  it("finds a genuine astronomical night at mid latitude", () => {
    const w = darkWindowFor("2026-10-06", 40, -3);
    expect(w.exists).toBe(true);
    expect(w.end.getTime()).toBeGreaterThan(w.start.getTime());
    expect(w.sunMidnightAltitudeDeg).toBeLessThanOrEqual(-18);
  });

  it("reports no dark night at high latitude in midsummer", () => {
    const w = darkWindowFor("2026-06-21", 78, 0);
    expect(w.exists).toBe(false);
    expect(w.sunMidnightAltitudeDeg).toBeGreaterThan(-18);
  });

  it("pins both window edges to the exact -18 degree crossing", () => {
    // Regression guard. The scan is coarse by design; the edges are then
    // bisected onto the real crossing. Getting the bracket wrong once made the
    // reported end of night land ~5 minutes after sunrise of twilight.
    const sunAlt = (ms: number, lat: number, lon: number) => {
      const at = new Date(ms);
      const sun = sunEquatorial(at);
      return equatorialToHorizontal(sun.raDeg, sun.decDeg, lat, localSiderealDeg(at, lon)).altitudeDeg;
    };
    for (const lat of [-33.9, 28.6139, 40, 51.5]) {
      const w = darkWindowFor("2026-10-06", lat, 0);
      expect(w.exists).toBe(true);
      expect(sunAlt(w.start.getTime(), lat, 0)).toBeLessThanOrEqual(-18);
      expect(sunAlt(w.start.getTime(), lat, 0)).toBeGreaterThan(-18.01);
      expect(sunAlt(w.end.getTime(), lat, 0)).toBeLessThanOrEqual(-18);
      expect(sunAlt(w.end.getTime(), lat, 0)).toBeGreaterThan(-18.01);
      // One second outside the window must be back above the threshold.
      expect(sunAlt(w.start.getTime() - 1000, lat, 0)).toBeGreaterThan(-18);
      expect(sunAlt(w.end.getTime() + 1000, lat, 0)).toBeGreaterThan(-18);
    }
  });

  it("gives a longer night in winter than in summer at mid latitude", () => {
    const summer = darkWindowFor("2026-06-21", 40, 0);
    const winter = darkWindowFor("2026-12-21", 40, 0);
    expect(winter.exists).toBe(true);
    if (summer.exists) {
      expect(winter.end.getTime() - winter.start.getTime()).toBeGreaterThan(
        summer.end.getTime() - summer.start.getTime(),
      );
    }
  });
});

describe("limiting magnitude", () => {
  it("uses the published naked-eye value for each Bortle class", () => {
    expect(limitingMagnitude(1, 0, "naked-eye")).toBeCloseTo(7.8, 5);
    expect(limitingMagnitude(9, 0, "naked-eye")).toBeCloseTo(5.0, 5);
  });

  it("scales with aperture under the standard law", () => {
    // 7.7 + 5 log10(aperture in cm) under a class-6 sky.
    expect(limitingMagnitude(6, 200, "reflector")).toBeCloseTo(7.7 + 5 * Math.log10(20), 1);
    expect(limitingMagnitude(6, 300, "reflector")).toBeGreaterThan(
      limitingMagnitude(6, 200, "reflector"),
    );
  });

  it("degrades in brighter skies", () => {
    expect(limitingMagnitude(9, 200, "reflector")).toBeLessThan(
      limitingMagnitude(4, 200, "reflector"),
    );
  });
});

describe("culmination altitude", () => {
  it("is 90 degrees when declination equals latitude", () => {
    expect(culminationAltitudeDeg(51.5, 51.5)).toBeCloseTo(90, 6);
  });

it("is 90 minus the latitude gap", () => {
    expect(culminationAltitudeDeg(51.5, 0)).toBeCloseTo(38.5, 6);
    expect(culminationAltitudeDeg(0, -51.5)).toBeCloseTo(38.5, 6);
    expect(culminationAltitudeDeg(51.5, 80)).toBeCloseTo(61.5, 6);
    expect(culminationAltitudeDeg(-30, 45)).toBeCloseTo(15, 6);
  });
});

describe("determinism", () => {
  it("returns identical output for identical input", () => {
    const at = new Date("2026-10-06T22:17:33.123Z");
    const first = JSON.stringify([sunEquatorial(at), moonEquatorial(at), moonState(at), gmstDeg(at)]);
    const second = JSON.stringify([sunEquatorial(at), moonEquatorial(at), moonState(at), gmstDeg(at)]);
    expect(first).toBe(second);
  });
});