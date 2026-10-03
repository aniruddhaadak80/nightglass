/**
 * Domain types.
 *
 * These are the shapes that cross every boundary: the catalogue feed, the
 * persistence layer, the engine, the REST API, the MCP tools and the UI.
 * External catalogue rows are normalised into `SkyObject` before anything else
 * in the application is allowed to see them.
 */

export type ObjectKind = "star" | "galaxy" | "nebula" | "cluster" | "double" | "other";

export type BortleClass = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type InstrumentType = "refractor" | "reflector" | "catadioptric" | "binocular" | "naked-eye";

export type TargetDecision = "pending" | "observe" | "skip";

export type ScoreBand = "prime" | "good" | "fair" | "poor" | "blocked";

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                  */
/* -------------------------------------------------------------------------- */

/** A single catalogue entry, normalised from an upstream source. */
export interface SkyObject {
  /** Stable id in this application, derived from the upstream identifier. */
  id: string;
  /** Human name, e.g. "Rigel" or "M31". */
  name: string;
  /** Bayer/Flamsteed or other designation, when the source supplies one. */
  designation: string | null;
  kind: ObjectKind;
  /** J2000 right ascension, degrees. */
  raDeg: number;
  /** J2000 declination, degrees. */
  decDeg: number;
  /** Apparent visual magnitude. Lower is brighter. */
  magnitude: number;
  /** Apparent angular size, arcminutes, when known. */
  angularSizeArcmin: number | null;
  constellation: string | null;
  /** A short natural-language description used by the local matcher. */
  blurb: string;
  /** Upstream identifier as the source spells it, for attribution. */
  sourceId: string;
  /** Which catalogue this came from. */
  catalog: string;
}

/** Where a catalogue response came from. Never guess this. */
export type FeedStatus = "live" | "fallback";

export interface CatalogueSource {
  /** Machine name, e.g. "vizier". */
  id: string;
  label: string;
  /** Canonical page a human can check the data against. */
  attribution: string;
  /** Endpoint actually called. */
  endpoint: string;
}

export interface CatalogueResult {
  status: FeedStatus;
  /** ISO timestamp of when this payload was assembled. */
  fetchedAt: string;
  sources: CatalogueSource[];
  /** Populated when `status === "fallback"`, explains why. */
  degradedReason: string | null;
  objects: SkyObject[];
}

/* -------------------------------------------------------------------------- */
/* Live conditions                                                            */
/* -------------------------------------------------------------------------- */

/** Normalised live weather for a site and night. */
export interface SkyConditions {
  status: FeedStatus;
  fetchedAt: string;
  source: CatalogueSource;
  degradedReason: string | null;
  /** Fraction of the sky blocked, 0..1, averaged across the dark window. */
  cloudCoverPct: number;
  cloudLowPct: number;
  cloudMidPct: number;
  cloudHighPct: number;
  /** Horizontal visibility in metres. */
  visibilityMeters: number;
  /** Wind speed in km/h — drives the seeing proxy. */
  windSpeedKph: number;
  temperatureC: number;
  humidityPct: number;
  /** Derived 0..1: how clear and transparent the air is. */
  transparency: number;
  /** Derived 0..1: how steady the air is, 1 is perfectly steady. */
  seeing: number;
}

/* -------------------------------------------------------------------------- */
/* Site and instrument                                                        */
/* -------------------------------------------------------------------------- */

export interface SiteProfile {
  name: string;
  latitudeDeg: number;
  longitudeDeg: number;
  bortle: BortleClass;
  /** Height of the local obstruction above the true horizon, degrees. */
  horizonDeg: number;
  timezone: string;
}

export interface InstrumentProfile {
  name: string;
  apertureMm: number;
  magnification: number;
  type: InstrumentType;
}

/* -------------------------------------------------------------------------- */
/* Engine                                                                     */
/* -------------------------------------------------------------------------- */

export interface Factor {
  id: string;
  label: string;
  /** Normalised 0..100 measurement. */
  value: number;
  /** Share of the final score, 0..1. Sums to 1 across all factors. */
  weight: number;
  /** value/100 * weight, expressed in score points. */
  contribution: number;
  /** The measured quantity behind `value`, in plain language. */
  evidence: string;
}

export interface AltitudeSample {
  /** Minutes from the start of the dark window. */
  minutes: number;
  /** ISO timestamp of the sample. */
  at: string;
  altitudeDeg: number;
  azimuthDeg: number;
  /** Sun altitude at the same instant, degrees. Negative at night. */
  sunAltitudeDeg: number;
  /** Moon altitude at the same instant, degrees. */
  moonAltitudeDeg: number;
}

export interface ObservabilityScore {
  engineVersion: string;
  /** Catalogue id of the object this score describes. */
  objectId: string;
  /** Human name of that object, carried so every consumer can label the score. */
  objectName: string;
  objectKind: ObjectKind;
  /** 0..100. */
  score: number;
  band: ScoreBand;
  /**
   * True when the target never rose above the stated horizon obstruction. The
   * score is then clamped into the blocked band regardless of how good the
   * other factors look, because the obstruction is categorical.
   */
  gated: boolean;
  /** One actionable sentence: what to do and when. */
  recommendation: string;
  factors: Factor[];
  altitudeCurve: AltitudeSample[];
  /** ISO timestamps bounding the interval the target is above the horizon. */
  windowStart: string | null;
  windowEnd: string | null;
  /** Highest altitude reached during the dark window. */
  maxAltitudeDeg: number;
  /** ISO timestamp of culmination, when it happens inside the window. */
  culminationAt: string | null;
  /** Angular distance from the Moon at the recommended moment. */
  moonSeparationDeg: number;
  /** Moon illuminated fraction at the recommended moment, 0..1. */
  moonIllumination: number;
  /** Limiting magnitude for the instrument at the site, 0..1 scale. */
  limitingMagnitude: number;
  /** SHA-384 over the engine inputs and outputs. */
  seal: string;
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

export interface PlannedTarget {
  objectId: string;
  name: string;
  kind: ObjectKind;
  magnitude: number;
  decision: TargetDecision;
  note: string;
  /** Most recent engine score for this target, when it has been ranked. */
  score: ObservabilityScore | null;
}

export interface ObservingPlan {
  id: string;
  name: string;
  site: SiteProfile;
  instrument: InstrumentProfile;
  /** Night being planned, as an ISO calendar date `YYYY-MM-DD`. */
  nightOf: string;
  targets: PlannedTarget[];
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  idempotencyKey: string | null;
  deleted: boolean;
}

export interface CreatePlanInput {
  name: string;
  site: SiteProfile;
  instrument: InstrumentProfile;
  nightOf: string;
  targets: PlannedTarget[];
  idempotencyKey?: string;
}

export interface UpdatePlanInput {
  name?: string;
  site?: SiteProfile;
  instrument?: InstrumentProfile;
  nightOf?: string;
  targets?: PlannedTarget[];
}

export interface Observation {
  id: string;
  planId: string | null;
  objectId: string;
  objectName: string;
  /** ISO date the observation refers to. */
  seenOn: string;
  /** 1..5, the observer's own confidence the target was actually seen. */
  confidence: number;
  /** Optional free text. */
  notes: string;
  /** ISO timestamp of the session. */
  observedAt: string;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  deleted: boolean;
}

export interface CreateObservationInput {
  planId?: string | null;
  objectId: string;
  objectName: string;
  seenOn: string;
  confidence: number;
  notes?: string;
  observedAt: string;
}

export interface UpdateObservationInput {
  objectName?: string;
  seenOn?: string;
  confidence?: number;
  notes?: string;
  observedAt?: string;
}

/* -------------------------------------------------------------------------- */
/* Integrity                                                                  */
/* -------------------------------------------------------------------------- */

export type AuditAction =
  | "plan.created"
  | "plan.updated"
  | "plan.ranked"
  | "plan.target_decided"
  | "plan.deleted"
  | "plan.exported"
  | "observation.created"
  | "observation.updated"
  | "observation.deleted";

export interface AuditEvent {
  /** Entity the event belongs to; chains are per-entity. */
  planId: string;
  id: string;
  action: AuditAction;
  /** JSON-encoded payload, stored as text so it never needs re-encoding. */
  payload: string;
  prevSeal: string;
  seal: string;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* API envelope                                                               */
/* -------------------------------------------------------------------------- */

export type ApiErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "upstream_unavailable"
  | "internal";

export interface ApiError {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}

/** Everything the UI needs to render one night, in one payload. */
export interface NightBriefing {
  site: SiteProfile;
  instrument: InstrumentProfile;
  nightOf: string;
  conditions: SkyConditions;
  /** Dark window bounded by astronomical twilight, ISO timestamps. */
  darkWindowStart: string;
  darkWindowEnd: string;
  /** Sun altitude at local solar midnight. */
  sunMidnightAltitudeDeg: number;
  moonIllumination: number;
  moonAltitudeAtMidnightDeg: number;
  ranked: ObservabilityScore[];
}