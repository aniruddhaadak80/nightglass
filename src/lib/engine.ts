/**
 * The observability engine.
 *
 * A pure, versioned function. Given the same object, site, instrument, live
 * conditions and dark window it returns byte-identical output forever — which
 * is what lets the UI, the REST route and the MCP tool all call this one
 * function instead of three reimplementations.
 *
 * The score is a weighted mean of six factors, each normalised to 0..100 and
 * each carrying the measured quantity behind it. Weights sum to exactly 1, so
 * the score is directly readable as "this many points came from that".
 *
 *   factor                weight   what it measures
 *   --------------------  -------  ---------------------------------------------
 *   horizon_clearance      0.26    how long and how high, above the real horizon
 *   sky_darkness           0.20    Sun depth, light pollution, Moon interference
 *   instrument_reach       0.20    magnitude and surface brightness vs. the limit
 *   transparency           0.16    live cloud and visibility
 *   seeing_tolerance       0.10    whether the target survives unsteady air
 *   culmination            0.08    theoretical best altitude from this latitude
 *
 * Surface brightness matters as much as integrated magnitude for extended
 * objects, and a galaxy that is comfortably within the magnitude limit can
 * still be invisible if its surface brightness is too low. Factor three
 * therefore splits its weighting on angular size.
 */

import {
  angularSeparationDeg,
  apparentAltitudeDeg,
  culminationAltitudeDeg,
  equatorialToHorizontal,
  limitingMagnitude,
  localSiderealDeg,
  moonState,
  sunEquatorial,
} from "./astro";
import type {
  Factor,
  InstrumentProfile,
  ObservabilityScore,
  ScoreBand,
  SiteProfile,
  SkyConditions,
  SkyObject,
  AltitudeSample,
} from "./types";

export const ENGINE_VERSION = "2026.1.0";

export interface EngineInput {
  object: SkyObject;
  site: SiteProfile;
  instrument: InstrumentProfile;
  conditions: SkyConditions;
  /** Astronomical night bounds. */
  windowStart: Date;
  windowEnd: Date;
}

export const FACTOR_WEIGHTS = {
  horizon_clearance: 0.26,
  sky_darkness: 0.2,
  instrument_reach: 0.2,
  transparency: 0.16,
  seeing_tolerance: 0.1,
  culmination: 0.08,
} as const;

const CURVE_STEP_MINUTES = 5;
/** Keep the payload bounded no matter how long a pathological window is. */
const MAX_CURVE_SAMPLES = 240;
/** Highest score a never-visible target may take; the top of the blocked band. */
export const HORIZON_GATE_CEILING = 19.9;

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

/** Round to a fixed number of decimals, returning a number (not a string). */
export function round(n: number, digits = 2): number {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Sample the object's altitude across the dark window. */
export function altitudeCurve(input: EngineInput): AltitudeSample[] {
  const { site, windowStart, windowEnd } = input;
  const stepMs = CURVE_STEP_MINUTES * 60000;
  const span = windowEnd.getTime() - windowStart.getTime();

  if (!Number.isFinite(span) || span <= 0) return [];

  const count = Math.min(MAX_CURVE_SAMPLES, Math.max(2, Math.ceil(span / stepMs) + 1));
  const step = span / (count - 1);

  const samples: AltitudeSample[] = [];
  for (let i = 0; i < count; i++) {
    const at = new Date(windowStart.getTime() + i * step);
    const lst = localSiderealDeg(at, site.longitudeDeg);
    const { altitudeDeg, azimuthDeg } = equatorialToHorizontal(
      input.object.raDeg,
      input.object.decDeg,
      site.latitudeDeg,
      lst,
    );
    const moon = moonState(at);
    const moonH = equatorialToHorizontal(moon.raDeg, moon.decDeg, site.latitudeDeg, lst);
    // Sun altitude is recomputed from the same sidereal time so every column
    // in the sample describes one instant.
    const sun = sunEquatorial(at);
    const sunH = equatorialToHorizontal(sun.raDeg, sun.decDeg, site.latitudeDeg, lst);
    samples.push({
      minutes: i * (span / 60000 / (count - 1)),
      at: at.toISOString(),
      altitudeDeg: round(altitudeDeg, 3),
      azimuthDeg: round(azimuthDeg, 3),
      sunAltitudeDeg: round(sunH.altitudeDeg, 3),
      moonAltitudeDeg: round(moonH.altitudeDeg, 3),
    });
  }
  return samples;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function formatClock(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timeZone && timeZone !== "auto" ? timeZone : "UTC",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(11, 16);
  }
}

/** Surface brightness in magnitudes per square arcminute. */
export function surfaceBrightness(object: SkyObject): number | null {
  if (!object.angularSizeArcmin || object.angularSizeArcmin <= 0) return null;
  return round(object.magnitude + 2.5 * Math.log10(object.angularSizeArcmin), 2);
}

/**
 * How much a target tolerates unsteady air, 0..1, from its angular size.
 *
 * A pinpoint double star needs a rock-steady atmosphere; an open cluster or a
 * broad nebula shows almost nothing of the difference. Monotonic in size and
 * saturating, so a 60 arcminute cluster is treated as fully tolerant.
 */
export function toleranceForAngularSize(arcmin: number): number {
  return clamp01(0.2 + (Math.log10(Math.max(arcmin, 0.3)) + 0.5) / 2.2);
}

/**
 * The seeing factor for a target of a given tolerance in air of a given steadiness.
 *
 * Modelled as a floor plus a power law rather than a plain product:
 *
 *   value = 100 * ( floor + (1 - floor) * air ^ exponent )
 *
 * A plain `tolerance * air` product is the obvious thing to write and it is
 * wrong: it gives a large target a *higher* baseline, so the same gust of bad
 * air costs it more points in absolute terms than it costs a small one. In
 * reality the ordering is the reverse. Here a tolerant target both starts from
 * a higher floor and follows the air less steeply, so bad air opens a gap in
 * favour of large objects instead of closing it.
 */
export function seeingFactorValue(tolerance: number, air: number): number {
  const t = clamp01(tolerance);
  const a = clamp01(air);
  const floor = 0.55 - 0.3 * (1 - t);
  const exponent = 0.35 + 1.15 * (1 - t);
  return 100 * (floor + (1 - floor) * a ** exponent);
}

export function bandFor(score: number): ScoreBand {
  if (score >= 78) return "prime";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  if (score >= 20) return "poor";
  return "blocked";
}

export function rankTarget(input: EngineInput): ObservabilityScore {
  const { object, site, instrument, conditions } = input;
  const curve = altitudeCurve(input);
  const effective = curve.map((s) => ({ ...s, effectiveAltitude: apparentAltitudeDeg(s.altitudeDeg) }));

  const horizon = clamp(site.horizonDeg, 0, 80);
  const above = effective.filter((s) => s.effectiveAltitude > horizon);
  const maxAlt = effective.reduce((m, s) => Math.max(m, s.effectiveAltitude), -90);
  const clearanceFraction = effective.length > 0 ? above.length / effective.length : 0;
  const windowMs = input.windowEnd.getTime() - input.windowStart.getTime();

  /* -- 1. Horizon clearance ------------------------------------------------ */
  const clearanceValue = 0.62 * clearanceFraction + 0.38 * clamp01(maxAlt / 60);
  const clearanceEvidence =
    curve.length === 0
      ? "No dark window at this latitude and date, so there is nothing to clear."
      : above.length > 0
        ? `Above your ${round(horizon, 0)}° obstruction for ${formatDuration((above.length - 1) * (windowMs / Math.max(1, curve.length - 1)))} of a ${formatDuration(windowMs)} night, peaking at ${round(maxAlt, 0)}°.`
        : `Never clears your ${round(horizon, 0)}° obstruction — trees or a roof line put it out of reach tonight.`;

  /* -- 2. Sky darkness ----------------------------------------------------- */
  const midSample = effective[Math.floor(effective.length / 2)];
  const sunAlt = midSample?.sunAltitudeDeg ?? 0;
  const sunScore = clamp01((-sunAlt - 4) / 14) * 100;

  const bortleLimit = limitingMagnitude(site.bortle, 0, "naked-eye");
  const bortleScore = clamp01((bortleLimit - 4.6) / 3.2) * 100;

  const moon = moonState(midSample ? new Date(midSample.at) : input.windowStart);
  const moonSep = midSample
    ? angularSeparationDeg(object.raDeg, object.decDeg, moon.raDeg, moon.decDeg)
    : 180;
  const proximity = 1 - clamp01((moonSep - 30) / 90);
  const moonScore = 100 * (1 - 0.85 * moon.illumination * proximity);

  const darknessValue = 0.5 * sunScore + 0.2 * bortleScore + 0.3 * moonScore;
  const darknessEvidence =
    `Sun ${round(Math.abs(sunAlt), 0)}° below the horizon at mid-night, class ${site.bortle} sky ` +
    `(naked-eye limit ${bortleLimit.toFixed(1)}), Moon ${Math.round(moon.illumination * 100)}% lit ` +
    `and ${round(moonSep, 0)}° away.`;

  /* -- 3. Instrument reach ------------------------------------------------- */
  const limit = limitingMagnitude(site.bortle, instrument.apertureMm, instrument.type);
  const magnitudeScore = clamp01((limit - object.magnitude) / 12) * 100;
  const sb = surfaceBrightness(object);
  const arcminExtent = object.angularSizeArcmin;
  const extended = arcminExtent !== null && arcminExtent >= 3;
  let reachValue: number;
  let reachEvidence: string;
  if (extended && sb !== null && arcminExtent !== null) {
    // Visual detection of an extended object is limited by surface brightness,
    // not integrated magnitude. The 25 / 9 scale puts the practical ceiling for
    // a modest instrument near 25 mag/arcmin² and full marks around 16, which
    // is where genuinely easy objects such as M31 and M33 sit.
    const sbScore = clamp01((25 - sb) / 9) * 100;
    reachValue = 0.7 * sbScore + 0.3 * magnitudeScore;
    reachEvidence =
      `Surface brightness ${sb.toFixed(1)} mag/arcmin² over ${round(arcminExtent, 0)}′ against a ` +
      `${limit.toFixed(1)} limit for your ${instrument.apertureMm} mm — extended objects need surface brightness, not just magnitude.`;
  } else {
    reachValue = magnitudeScore;
    reachEvidence = `Magnitude ${round(object.magnitude, 1)} against a ${limit.toFixed(1)} limit for your ${instrument.apertureMm} mm ${instrument.type}.`;
  }

  /* -- 4. Transparency ----------------------------------------------------- */
  const transparencyValue = clamp01(conditions.transparency) * 100;
  const transparencyEvidence =
    conditions.status === "live"
      ? `Live from ${conditions.source.label}: ${Math.round(conditions.cloudCoverPct)}% cloud (${Math.round(conditions.cloudLowPct)}% low), ${(conditions.visibilityMeters / 1000).toFixed(1)} km visibility, ${Math.round(conditions.windSpeedKph)} km/h wind.`
      : `Offline sample, not live: ${Math.round(conditions.cloudCoverPct)}% cloud, ${(conditions.visibilityMeters / 1000).toFixed(1)} km visibility. ${conditions.degradedReason ?? ""}`.trim();

  /* -- 5. Seeing tolerance ------------------------------------------------- */
  const arcmin = object.angularSizeArcmin ?? 1;
  const tolerance = toleranceForAngularSize(arcmin);
  const seeingValue = seeingFactorValue(tolerance, conditions.seeing);
  const seeingEvidence =
    `A ${round(arcmin, 1)}′ target tolerates unsteady air better than a pinpoint; live air steadiness is ` +
    `${Math.round(conditions.seeing * 100)}/100, so seeing costs this object ${round(100 - seeingValue, 0)} of its 100-point allowance.`;

  /* -- 6. Culmination ------------------------------------------------------ */
  const culmAlt = culminationAltitudeDeg(site.latitudeDeg, object.decDeg);
  const culminationValue = clamp01((culmAlt - horizon) / 50) * 100;
  const culminationEvidence =
    `Culminates at ${round(culmAlt, 0)}° from latitude ${round(site.latitudeDeg, 2)}° — ` +
    `${culmAlt >= 60 ? "comfortably high" : culmAlt >= 35 ? "moderate" : "low even at best"} on this meridian.`;

  const factors: Factor[] = [
    mk("horizon_clearance", "Horizon clearance", clearanceValue, FACTOR_WEIGHTS.horizon_clearance, clearanceEvidence),
    mk("sky_darkness", "Sky darkness", darknessValue, FACTOR_WEIGHTS.sky_darkness, darknessEvidence),
    mk("instrument_reach", "Instrument reach", reachValue, FACTOR_WEIGHTS.instrument_reach, reachEvidence),
    mk("transparency", "Transparency", transparencyValue, FACTOR_WEIGHTS.transparency, transparencyEvidence),
    mk("seeing_tolerance", "Seeing tolerance", seeingValue, FACTOR_WEIGHTS.seeing_tolerance, seeingEvidence),
    mk("culmination", "Culmination", culminationValue, FACTOR_WEIGHTS.culmination, culminationEvidence),
  ];

  const weighted = factors.reduce((sum, f) => sum + f.value * f.weight, 0);

  /**
   * Hard horizon gate.
   *
   * A target that never rises above the observer's stated obstruction is
   * categorically unobservable, however dark and steady the night is. Left
   * ungated, a beautifully clear night would still score it "fair" on the
   * strength of transparency alone, which is exactly the wrong answer to give
   * someone standing under a tree. Clamping into the blocked band keeps the
   * verdict honest while leaving the factor breakdown intact and readable.
   */
  const gated = curve.length > 0 && above.length === 0;
  const score = round(gated ? Math.min(weighted, HORIZON_GATE_CEILING) : weighted, 1);

  /* Best moment: the highest effective altitude inside the window. */
  let best = effective[0];
  for (const s of effective) {
    if (!best || s.effectiveAltitude > best.effectiveAltitude) best = s;
  }
  const culminationAt = best ? new Date(best.at).toISOString() : null;
  const moonAtBest = best ? moonState(new Date(best.at)) : moon;
  const separationAtBest = best
    ? angularSeparationDeg(object.raDeg, object.decDeg, moonAtBest.raDeg, moonAtBest.decDeg)
    : 180;

  const windowStart = above.length > 0 ? above[0]!.at : null;
  const windowEnd = above.length > 0 ? above[above.length - 1]!.at : null;

  const band = bandFor(score);
  const recommendation = buildRecommendation({
    object,
    band,
    score,
    best,
    aboveCount: above.length,
    curveLength: effective.length,
    windowStart,
    windowEnd,
    maxAlt,
    horizon,
    timeZone: site.timezone,
    seeing: conditions.seeing,
    moonIllumination: moonAtBest.illumination,
  });

  return {
    engineVersion: ENGINE_VERSION,
    objectId: object.id,
    objectName: object.name,
    objectKind: object.kind,
    score,
    band,
    gated,
    recommendation,
    factors,
    altitudeCurve: curve,
    windowStart,
    windowEnd,
    maxAltitudeDeg: round(maxAlt, 2),
    culminationAt,
    moonSeparationDeg: round(separationAtBest, 1),
    moonIllumination: round(moonAtBest.illumination, 3),
    limitingMagnitude: limit,
    seal: "",
  };
}

function mk(id: string, label: string, value: number, weight: number, evidence: string): Factor {
  const v = round(clamp(value, 0, 100), 1);
  return {
    id,
    label,
    value: v,
    weight,
    // Computed from the rounded value so the numbers a reader sees are the
    // numbers that add up. Deriving it from the unrounded figure instead makes
    // the displayed factors appear not to sum to the displayed score.
    contribution: round((v / 100) * weight * 100, 2),
    evidence,
  };
}

interface RecommendationInput {
  object: SkyObject;
  band: ScoreBand;
  score: number;
  best: { at: string; effectiveAltitude: number } | undefined;
  aboveCount: number;
  curveLength: number;
  windowStart: string | null;
  windowEnd: string | null;
  maxAlt: number;
  horizon: number;
  timeZone: string;
  seeing: number;
  moonIllumination: number;
}

function buildRecommendation(r: RecommendationInput): string {
  if (r.curveLength === 0) {
    return `No astronomical night on this date at your latitude, so ${r.object.name} cannot be scored tonight.`;
  }
  if (r.aboveCount === 0) {
    return `Skip tonight: ${r.object.name} never rises above your ${round(r.horizon, 0)}° obstruction between dusk and dawn. It will return as it swings north of your horizon obstruction later in the year.`;
  }

  const peak = formatClock(r.best?.at ?? r.windowStart ?? "", r.timeZone);
  const rise = formatClock(r.windowStart ?? "", r.timeZone);
  const set = formatClock(r.windowEnd ?? "", r.timeZone);

  const base = `${r.object.name} scores ${round(r.score, 0)}/100 — ${describeBand(r.band)}. `;

  if (r.band === "blocked") {
    return `${base}Even at its best it only reaches ${round(r.maxAlt, 0)}° and the sky is against it; put it on the list for another month.`;
  }
  if (r.seeing < 0.35 && r.object.angularSizeArcmin !== null && r.object.angularSizeArcmin < 4) {
    return `${base}Best between ${rise} and ${set}, peaking ${round(r.maxAlt, 0)}° at ${peak} — but the air is unsteady tonight, so expect a soft image on anything smaller than a few arcminutes.`;
  }
  if (r.moonIllumination > 0.75) {
    return `${base}Go between ${rise} and ${set} (peak ${round(r.maxAlt, 0)}° at ${peak}); a ${Math.round(r.moonIllumination * 100)}% Moon means you want the hour furthest from it.`;
  }
  return `${base}Observe between ${rise} and ${set}; it peaks at ${round(r.maxAlt, 0)}° at ${peak}, which is your best ${r.band === "prime" ? "window of the night" : "chance of the night"}.`;
}

function describeBand(band: ScoreBand): string {
  switch (band) {
    case "prime":
      return "a prime target";
    case "good":
      return "worth the set-up";
    case "fair":
      return "worth it if you are already out";
    case "poor":
      return "marginal";
    case "blocked":
      return "not viable tonight";
  }
}

/**
 * Rank many targets at once.
 *
 * Ties are broken by score, then by magnitude (brighter first, because a
 * brighter target is the safer pick when everything else is equal), then by
 * object id so the order is total and stable across runs and processes.
 */
export function rankTargets(inputs: EngineInput[]): ObservabilityScore[] {
  return inputs
    .map((input) => ({ input, score: rankTarget(input) }))
    .sort((a, b) => {
      if (b.score.score !== a.score.score) return b.score.score - a.score.score;
      if (a.input.object.magnitude !== b.input.object.magnitude) {
        return a.input.object.magnitude - b.input.object.magnitude;
      }
      return a.input.object.id < b.input.object.id ? -1 : a.input.object.id > b.input.object.id ? 1 : 0;
    })
    .map((entry) => entry.score);
}