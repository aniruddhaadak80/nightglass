/**
 * Positional astronomy.
 *
 * Everything here is pure, deterministic and unit-tested. No network, no
 * clock, no randomness: pass a `Date` and you get the same numbers forever.
 *
 * Algorithms
 * ----------
 * - Sidereal time: the standard GMST linear series (Meeus, *Astronomical
 *   Algorithms*, eq. 12.4), valid to well under an arcsecond over decades.
 * - Sun position: the NOAA/Meeus low-precision solar ephemeris. Accurate to
 *   about 0.01 degrees, which is three orders of magnitude finer than the
 *   1-degree horizon input this application accepts from a user.
 * - Moon position: the truncated ELP series from Meeus ch. 47 (the leading
 *   periodic terms). Accurate to roughly 0.3 degrees in longitude and 0.2 in
 *   latitude — ample for altitude, elongation and phase.
 * - Refraction: Bennett's formula with Saemundsson's correction to the input
 *   altitude.
 *
 * Angles are degrees and epoch J2000 unless a name says otherwise. Times are
 * JavaScript `Date`, always UTC internally.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** J2000.0 as a Julian Day number. */
export const J2000 = 2451545.0;
/** Mean length of a synodic month, days. */
export const SYNODIC_MONTH_DAYS = 29.530588853;

export const DEGREES_PER_HOUR = 15;

/** Wrap into [0, 360). */
export function norm360(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

/** Wrap into [-180, 180). */
export function norm180(deg: number): number {
  return norm360(deg + 180) - 180;
}

/** Julian Day for an instant. */
export function julianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Julian centuries since J2000.0. */
export function julianCenturies(date: Date): number {
  return (julianDay(date) - J2000) / 36525;
}

/** Greenwich Mean Sidereal Time in degrees. */
export function gmstDeg(date: Date): number {
  const d = julianDay(date) - J2000;
  const hours = 18.697374558 + 24.06570982441908 * d;
  return norm360(hours * DEGREES_PER_HOUR);
}

/** Local Apparent Sidereal Time in degrees (longitude east-positive). */
export function localSiderealDeg(date: Date, longitudeDeg: number): number {
  return norm360(gmstDeg(date) + longitudeDeg);
}

export interface Equatorial {
  raDeg: number;
  decDeg: number;
}

export interface Horizontal {
  /** Degrees above the true horizon, refraction not applied. */
  altitudeDeg: number;
  /** Degrees azimuth measured from true north, increasing eastward. */
  azimuthDeg: number;
}

/** Convert an equatorial position to a topocentric-looking horizontal one. */
export function equatorialToHorizontal(
  raDeg: number,
  decDeg: number,
  latitudeDeg: number,
  lstDeg: number,
): Horizontal {
  const hourAngle = norm360(lstDeg - raDeg);
  const ha = hourAngle * DEG;
  const dec = decDeg * DEG;
  const lat = latitudeDeg * DEG;

  const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  const cosAlt = Math.cos(altitude);
  let azimuth: number;
  if (Math.abs(cosAlt) < 1e-9) {
    // Straight overhead: azimuth is genuinely undefined. Pin it to north so
    // the output stays a finite number instead of producing NaN downstream.
    azimuth = 0;
  } else {
    const cosAz = (Math.sin(dec) - Math.sin(lat) * sinAlt) / (Math.cos(lat) * cosAlt);
    azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) * RAD;
    if (Math.sin(ha) > 0) azimuth = norm360(360 - azimuth);
  }

  return { altitudeDeg: altitude * RAD, azimuthDeg: azimuth };
}

/** Geocentric solar position. */
export function sunEquatorial(date: Date): Equatorial {
  const n = julianDay(date) - J2000;
  const meanLon = norm360(280.46646 + 0.9856474 * n);
  const meanAnom = norm360(357.52911 + 0.9856003 * n);
  const eclipticLon =
    norm360(meanLon + 1.914602 * Math.sin(meanAnom * DEG) + 0.019993 * Math.sin(2 * meanAnom * DEG) + 0.000289 * Math.sin(3 * meanAnom * DEG));
  const obliquity = 23.439291 - 0.0130042 * (julianCenturies(date) * 100) * 0.01;

  const lambda = eclipticLon * DEG;
  const eps = obliquity * DEG;
  const ra = norm360(Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * RAD);
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda)) * RAD;
  return { raDeg: ra, decDeg: dec };
}

/** Mean elongation of the Moon from the Sun, degrees. */
function moonElongationDeg(date: Date): number {
  const d = julianDay(date) - J2000;
  return norm360(297.8501921 + 12.19074912 * d);
}

/** Sun's mean anomaly, degrees. */
function sunMeanAnomalyDeg(date: Date): number {
  const d = julianDay(date) - J2000;
  return norm360(357.5291092 + 0.98560028 * d);
}

/**
 * Geocentric lunar position from the truncated ELP series.
 *
 * Longitude error stays under roughly 0.3 degrees, which at the Moon's
 * distance is about 20 000 km — irrelevant here, because the inputs this
 * application reasons about (a horizon the user types in whole degrees) are
 * far coarser.
 */
export function moonEquatorial(date: Date): Equatorial {
  const d = julianDay(date) - J2000;
  const meanLon = norm360(218.3164477 + 13.17639648 * d);
  const meanAnom = norm360(134.9633964 + 13.06499295 * d);
  const argLat = norm360(93.2720950 + 13.22935024 * d);
  const elong = moonElongationDeg(date);
  const sunAnom = sunMeanAnomalyDeg(date);

  const sin = (deg: number) => Math.sin(deg * DEG);

  const lon =
    meanLon +
    6.288774 * sin(meanAnom) +
    1.274027 * sin(2 * elong - meanAnom) +
    0.658314 * sin(2 * elong) +
    0.213618 * sin(2 * meanAnom) -
    0.185116 * sin(sunAnom) -
    0.114332 * sin(2 * argLat) +
    0.058793 * sin(2 * elong - 2 * meanAnom) +
    0.057066 * sin(2 * elong - meanAnom - sunAnom) +
    0.053322 * sin(2 * elong + meanAnom) +
    0.045758 * sin(2 * elong - sunAnom) -
    0.040923 * sin(meanAnom - sunAnom) -
    0.034720 * sin(elong) -
    0.030383 * sin(meanAnom + sunAnom) +
    0.015327 * sin(2 * elong - 2 * sunAnom) -
    0.012528 * sin(meanAnom + 2 * argLat) +
    0.010980 * sin(meanAnom - 2 * argLat);

  const lat =
    5.128122 * sin(argLat) +
    0.280602 * sin(meanAnom + argLat) +
    0.277693 * sin(meanAnom - argLat) +
    0.173237 * sin(2 * elong - argLat) +
    0.055413 * sin(2 * elong - meanAnom + argLat) +
    0.046271 * sin(2 * elong - meanAnom - argLat) +
    0.032573 * sin(2 * elong + argLat) +
    0.017198 * sin(2 * meanAnom + argLat) +
    0.009266 * sin(2 * elong + meanAnom - argLat);

  // Ecliptic to equatorial.
  const ecl = 23.439291 - 3.563e-7 * d;
  const eps = ecl * DEG;
  const l = lon * DEG;
  const b = lat * DEG;
  const ra = norm360(Math.atan2(Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps), Math.cos(l)) * RAD);
  const dec = Math.asin(Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l)) * RAD;
  return { raDeg: ra, decDeg: dec };
}

export interface MoonState {
  raDeg: number;
  decDeg: number;
  /** Illuminated fraction, 0..1. */
  illumination: number;
  /** Days since the last new moon, 0..29.53. */
  ageDays: number;
  /** Geocentric ecliptic longitude, used for the waxing/waning sense. */
  eclipticLonDeg: number;
  waxing: boolean;
}

export function moonState(date: Date): MoonState {
  const sun = sunEquatorial(date);
  const moon = moonEquatorial(date);

  // Phase angle from the geocentric elongation. Exact at new and full, and
  // accurate to a couple of percent near the quarters, which is all the
  // scoring needs.
  const elongation = angularSeparationDeg(sun.raDeg, sun.decDeg, moon.raDeg, moon.decDeg);
  const illumination = (1 - Math.cos(elongation * DEG)) / 2;

  const sunEclLon = norm360(
    Math.atan2(
      Math.sin(sun.raDeg * DEG) * Math.cos(23.439291 * DEG),
      Math.cos(sun.raDeg * DEG),
    ) * RAD,
  );
  const moonEclLon = norm360(
    Math.atan2(
      Math.sin(moon.raDeg * DEG) * Math.cos(23.439291 * DEG) - Math.tan(moon.decDeg * DEG) * Math.sin(23.439291 * DEG),
      Math.cos(moon.raDeg * DEG),
    ) * RAD,
  );
  const phaseAngle = norm360(moonEclLon - sunEclLon);

  return {
    raDeg: moon.raDeg,
    decDeg: moon.decDeg,
    illumination: Math.max(0, Math.min(1, illumination)),
    ageDays: (phaseAngle / 360) * SYNODIC_MONTH_DAYS,
    eclipticLonDeg: moonEclLon,
    waxing: phaseAngle < 180,
  };
}

/** Angular separation between two equatorial positions, degrees. */
export function angularSeparationDeg(
  ra1Deg: number,
  dec1Deg: number,
  ra2Deg: number,
  dec2Deg: number,
): number {
  const ra1 = ra1Deg * DEG;
  const dec1 = dec1Deg * DEG;
  const ra2 = ra2Deg * DEG;
  const dec2 = dec2Deg * DEG;
  const cosSep =
    Math.sin(dec1) * Math.sin(dec2) + Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
  return Math.acos(Math.max(-1, Math.min(1, cosSep))) * RAD;
}

/**
 * Atmospheric refraction in degrees for a true altitude, per Bennett (1982)
 * with Saemundsson's refinement of the input altitude.
 */
export function refractionDeg(trueAltitudeDeg: number): number {
  if (trueAltitudeDeg < -1.5) return 0;
  const h = Math.max(trueAltitudeDeg, -0.9);
  const arcminutes =
    1.02 / Math.tan((h + 10.3 / (h + 5.11)) * DEG) * (1 / 60);
  return arcminutes;
}

/** Apparent altitude, i.e. true altitude lifted by refraction. */
export function apparentAltitudeDeg(trueAltitudeDeg: number): number {
  return trueAltitudeDeg + refractionDeg(trueAltitudeDeg);
}

export interface DarkWindow {
  start: Date;
  end: Date;
  /** False at latitudes and dates where the Sun never reaches -18 degrees. */
  exists: boolean;
  /** Lowest solar altitude reached, degrees. Negative at night. */
  sunMidnightAltitudeDeg: number;
}

const DARK_STEP_MINUTES = 5;

/**
 * The astronomical night for the local calendar date `nightOf`.
 *
 * Scans the 24 hours around local solar midnight and returns the longest run
 * during which the Sun is at or below -18 degrees, which is the conventional
 * threshold for a fully dark sky. When the Sun never gets that low the window
 * does not exist and the caller is told so, rather than being handed a
 * fabricated one.
 */
export function darkWindowFor(nightOf: string, latitudeDeg: number, longitudeDeg: number): DarkWindow {
  const anchor = Date.parse(`${nightOf}T12:00:00Z`);
  const centre = new Date(anchor + 12 * 3600000 - (longitudeDeg / DEGREES_PER_HOUR) * 3600000);

  const stepMs = DARK_STEP_MINUTES * 60000;
  const from = centre.getTime() - 12 * 3600000;
  const to = centre.getTime() + 12 * 3600000;

  let bestStart: Date | null = null;
  let bestEnd: Date | null = null;
  let bestLen = -1;
  let runStart: number | null = null;
  let lowestSun = 90;

  const sunAlt = (ms: number) => {
    const at = new Date(ms);
    const lst = localSiderealDeg(at, longitudeDeg);
    const sun = sunEquatorial(at);
    return equatorialToHorizontal(sun.raDeg, sun.decDeg, latitudeDeg, lst).altitudeDeg;
  };

  for (let ms = from; ms <= to; ms += stepMs) {
    const alt = sunAlt(ms);
    if (alt < lowestSun) lowestSun = alt;
    if (alt <= -18) {
      if (runStart === null) runStart = ms;
    } else if (runStart !== null) {
      const len = ms - runStart;
      if (len > bestLen) {
        bestLen = len;
        bestStart = new Date(runStart);
        // The run closed at this sample because it is lit, so the last dark
        // sample is the previous one. Recording `ms` here would hand the
        // twilight refiner an endpoint that is already above the threshold,
        // leaving it with no bracket to bisect and silently returning a lit
        // instant as the end of astronomical night.
        bestEnd = new Date(ms - stepMs);
      }
      runStart = null;
    }
  }
  if (runStart !== null) {
    const len = to - runStart;
    if (len > bestLen) {
      bestLen = len;
      bestStart = new Date(runStart);
      bestEnd = new Date(to);
    }
  }

  if (bestStart === null || bestEnd === null || bestEnd.getTime() <= bestStart.getTime()) {
    return {
      start: new Date(centre.getTime() - 6 * 3600000),
      end: new Date(centre.getTime() + 6 * 3600000),
      exists: false,
      sunMidnightAltitudeDeg: lowestSun,
    };
  }

  // Refine both edges onto the true -18 degree crossing by bisection. The scan
  // only brackets the crossing to within one step, and an endpoint that is a
  // few minutes early would report twilight ending while the Sun is still
  // technically above the threshold.
  const exactStart = refineTwilight(sunAlt, bestStart.getTime() - stepMs, bestStart.getTime());
  const exactEnd = refineTwilight(sunAlt, bestEnd.getTime(), bestEnd.getTime() + stepMs);

  const start = new Date(exactStart);
  const end = new Date(exactEnd);

  // Report the Sun at the midpoint of the dark window rather than at local
  // solar midnight, which is the quantity the briefing actually displays.
  const mid = start.getTime() + (end.getTime() - start.getTime()) / 2;
  return {
    start,
    end,
    exists: true,
    sunMidnightAltitudeDeg: sunAlt(mid),
  };
}

/**
 * Bisect onto the exact instant at which solar altitude crosses -18 degrees.
 *
 * Takes the two instants that bracket the crossing in either order and works
 * out for itself which side is which from the altitude. Ordering them here
 * rather than trusting the caller removes an entire class of bug: the evening
 * crossing and the morning crossing naturally bracket in opposite directions,
 * and a parameterised `outside`/`inside` pair invites passing the second one
 * backwards, which silently converges to the wrong side of twilight.
 *
 * Twenty-four iterations resolve far below a millisecond, which is finer than
 * anything the surrounding astronomy can justify.
 */
function refineTwilight(sunAlt: (ms: number) => number, aMs: number, bMs: number): number {
  const aboveMs = sunAlt(aMs) > sunAlt(bMs) ? aMs : bMs;
  const belowMs = sunAlt(aMs) > sunAlt(bMs) ? bMs : aMs;

  let above = aboveMs;
  let below = belowMs;

  // No usable bracket: both instants are already at or below the threshold, so
  // the crossing is not between them. Return the later one unchanged.
  if (sunAlt(above) <= -18) return belowMs;

  for (let i = 0; i < 24; i++) {
    const mid = (above + below) / 2;
    if (sunAlt(mid) <= -18) below = mid;
    else above = mid;
  }
  return below;
}

/** Naked-eye limiting magnitude by Bortle class. */
export const BORTLE_LIMITING_MAGNITUDE: Record<number, number> = {
  1: 7.8,
  2: 7.4,
  3: 7.0,
  4: 6.6,
  5: 6.3,
  6: 6.0,
  7: 5.8,
  8: 5.5,
  9: 5.0,
};

/**
 * Faintest star the setup can realistically reach.
 *
 * The telescope term is the standard 7.7 + 5 log10(aperture in cm) under a
 * genuinely dark sky; the Bortle term then subtracts the light-pollution
 * penalty relative to a class-6 suburban sky.
 */
export function limitingMagnitude(bortle: number, apertureMm: number, type: string): number {
  const bortleLimit = BORTLE_LIMITING_MAGNITUDE[bortle] ?? 6.0;
  const pollutionPenalty = bortleLimit - 6.0;
  if (type === "naked-eye") return bortleLimit;
  const apertureCm = Math.max(2, apertureMm / 10);
  const telescopeLimit = 7.7 + 5 * Math.log10(apertureCm);
  return Number((telescopeLimit + pollutionPenalty).toFixed(2));
}

/**
 * Altitude of a body at its upper culmination, degrees.
 *
 * A closed form, used for sanity checks and for the season factor. Independent
 * of the timestamp, so it is a genuinely separate path from the sampled curve.
 */
/** Upper culmination altitude, closed form. */
export function culminationAltitudeDeg(latitudeDeg: number, decDeg: number): number {
  return 90 - Math.abs(latitudeDeg - decDeg);
}