/**
 * Live data.
 *
 * Two independent, keyless public sources:
 *
 *   1. Open-Meteo forecast API   — cloud by layer, visibility, wind, humidity.
 *   2. CDS VizieR TAP (V/50)     — the Bright Star Catalogue, J2000 positions.
 *
 * Both are fetched through this module only. Both are time-bounded, retried a
 * bounded number of times, and cached. When an upstream fails the response is
 * explicitly marked `fallback` with a reason, never presented as live, and
 * user-created data is never touched by a fallback.
 */

import {
  BRIGHT_STAR_SOURCE,
  SAMPLE_SOURCE,
  mergeCatalogues,
  normaliseObject,
  sampleCatalogue,
} from "./catalogue";
import type { CatalogueResult, SkyConditions, SkyObject } from "./types";

const REQUEST_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 2;

/** Bright stars down to this magnitude make a useful naked-eye working list. */
const BRIGHT_STAR_MAG_LIMIT = 4.2;
const BRIGHT_STAR_ROW_LIMIT = 120;

const CATALOGUE_TTL_MS = 6 * 60 * 60 * 1000;
const CONDITIONS_TTL_MS = 30 * 60 * 1000;

/** Sealed offline conditions used only when Open-Meteo cannot be reached. */
const FALLBACK_CONDITIONS = {
  cloudCoverPct: 55,
  cloudLowPct: 30,
  cloudMidPct: 20,
  cloudHighPct: 15,
  visibilityMeters: 12000,
  windSpeedKph: 14,
  temperatureC: 9,
  humidityPct: 72,
};

/* -------------------------------------------------------------------------- */
/* Fetching                                                                   */
/* -------------------------------------------------------------------------- */

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { "user-agent": "nightglass/1.0 (open-source stargazing planner)", ...init?.headers },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("upstream request failed");
}

/* -------------------------------------------------------------------------- */
/* VizieR Bright Star Catalogue                                               */
/* -------------------------------------------------------------------------- */

interface VizieRRow {
  HR: string;
  Name: string;
  RAJ2000: string;
  DEJ2000: string;
  Vmag: string;
  SpType: string;
}

function parseVizieRStarCsv(csv: string): VizieRRow[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = (lines[0] ?? "").split(",").map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const rows: VizieRRow[] = [];
  for (const line of lines.slice(1)) {
    // VizieR CSV quotes fields containing commas, so a naive split is wrong for
    // star names such as `11 Com` versus spectral types.
    const cells = splitCsvLine(line);
    const get = (name: string) => {
      const i = idx(name);
      return i >= 0 ? (cells[i] ?? "").trim() : "";
    };
    const HR = get("HR");
    if (!HR) continue;
    rows.push({
      HR,
      Name: get("Name"),
      RAJ2000: get("RAJ2000"),
      DEJ2000: get("DEJ2000"),
      Vmag: get("Vmag"),
      SpType: get("SpType"),
    });
  }
  return rows;
}

/** Minimal RFC4180 line splitter: handles quoted fields containing commas. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function cleanStarName(raw: string, hr: string): string {
  // VizieR renders Bayer names as `"  9Alp CMa"`, and HR numbers as `" 16Alp Boo"`.
  // Fold it into something a person would recognise: `9 CMa`, `16 Boo`.
  const text = raw.trim().replace(/\s+/g, " ");
  const greek: Record<string, string> = {
    Alp: "α",
    Bet: "β",
    Gam: "γ",
    Del: "δ",
    Eps: "ε",
    Zet: "ζ",
    Eta: "η",
    The: "θ",
    Iot: "ι",
    Kap: "κ",
    Lam: "λ",
    Mu: "μ",
    Nu: "ν",
    Xi: "ξ",
    Omi: "ο",
    Pi: "π",
    Rho: "ρ",
    Sig: "σ",
    Tau: "τ",
    Ups: "υ",
    Phi: "φ",
    Chi: "χ",
    Psi: "ψ",
    Ome: "ω",
  };
  const match = /^(\d+)?([A-Za-z]{3})?([A-Z][A-Za-z]{1,3})?$/.exec(text);
  if (match) {
    const [, num, abbr, constellation] = match;
    const greekChar = abbr ? greek[abbr] : null;
    const parts = [num, greekChar, constellation].filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
  }
  return text || `HR ${hr}`;
}

function spectralNote(spType: string): string {
  const t = spType.trim();
  return t ? `Spectral type ${t} from the Bright Star Catalogue.` : "";
}

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                  */
/* -------------------------------------------------------------------------- */

interface CatalogueCache {
  at: number;
  value: CatalogueResult;
}

let catalogueCache: CatalogueCache | null = null;
let catalogueInFlight: Promise<CatalogueResult> | null = null;

async function fetchBrightStars(): Promise<SkyObject[]> {
  const adql =
    `SELECT TOP ${BRIGHT_STAR_ROW_LIMIT} "HR","Name","RAJ2000","DEJ2000","Vmag","SpType" ` +
    `FROM "V/50/catalog" WHERE "Vmag" < ${BRIGHT_STAR_MAG_LIMIT} ORDER BY "Vmag"`;

  const body = new URLSearchParams({
    REQUEST: "doQuery",
    LANG: "ADQL",
    FORMAT: "csv",
    MAXREC: String(BRIGHT_STAR_ROW_LIMIT),
    QUERY: adql,
  });

  const response = await fetchWithTimeout(BRIGHT_STAR_SOURCE.endpoint, {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  if (!response.ok) throw new Error(`VizieR responded HTTP ${response.status}`);
  const csv = await response.text();

  const objects: SkyObject[] = [];
  for (const row of parseVizieRStarCsv(csv)) {
    const name = cleanStarName(row.Name, row.HR);
    const normalised = normaliseObject(
      {
        sourceId: row.HR,
        name,
        designation: row.Name.trim() || undefined,
        ra: row.RAJ2000,
        dec: row.DEJ2000,
        magnitude: row.Vmag,
        size: "",
        type: "9",
        blurb: spectralNote(row.SpType),
      },
      {
        catalog: "Bright Star Catalogue",
        epoch: "J2000",
        idPrefix: "vizier-v50",
        fallbackName: (id) => `HR ${id}`,
      },
    );
    if (normalised) objects.push(normalised);
  }
  if (objects.length === 0) throw new Error("VizieR returned no usable rows");
  return objects;
}

async function loadCatalogue(): Promise<CatalogueResult> {
  const now = new Date().toISOString();
  const sample = sampleCatalogue();

  try {
    const live = await fetchBrightStars();
    return {
      status: "live",
      fetchedAt: now,
      sources: [BRIGHT_STAR_SOURCE, SAMPLE_SOURCE],
      degradedReason: null,
      objects: mergeCatalogues(live, sample),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown upstream failure";
    return {
      status: "fallback",
      fetchedAt: now,
      sources: [SAMPLE_SOURCE],
      degradedReason: `Live catalogue unavailable (${reason}). Showing the bundled J2000 sample instead; deep-sky positions are curated, not live.`,
      objects: sample,
    };
  }
}

export async function getCatalogue(): Promise<CatalogueResult> {
  const now = Date.now();
  if (catalogueCache && now - catalogueCache.at < CATALOGUE_TTL_MS) return catalogueCache.value;
  if (catalogueInFlight) return catalogueInFlight;

  catalogueInFlight = loadCatalogue()
    .then((value) => {
      catalogueCache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      catalogueInFlight = null;
    });

  return catalogueInFlight;
}

/** Test seam: drop any cached upstream response. */
export function resetCatalogueCache(): void {
  catalogueCache = null;
  catalogueInFlight = null;
}

export function findObjects(catalogue: SkyObject[], ids: string[]): SkyObject[] {
  const byId = new Map(catalogue.map((o) => [o.id, o]));
  const out: SkyObject[] = [];
  for (const id of ids) {
    const found = byId.get(id);
    if (found) out.push(found);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Conditions                                                                 */
/* -------------------------------------------------------------------------- */

export const OPEN_METEO_SOURCE = {
  id: "open-meteo",
  label: "Open-Meteo forecast",
  attribution: "https://open-meteo.com/",
  endpoint: "https://api.open-meteo.com/v1/forecast",
};

/** Hourly fields that are numeric, and so can be averaged across the window. */
type NumericHourlyKey =
  | "cloud_cover"
  | "cloud_cover_low"
  | "cloud_cover_mid"
  | "cloud_cover_high"
  | "visibility"
  | "wind_speed_10m"
  | "temperature_2m"
  | "relative_humidity_2m";

interface OpenMeteoResponse {
  hourly?: {
    time?: string[];
    cloud_cover?: number[];
    cloud_cover_low?: number[];
    cloud_cover_mid?: number[];
    cloud_cover_high?: number[];
    visibility?: number[];
    wind_speed_10m?: number[];
    temperature_2m?: number[];
    relative_humidity_2m?: number[];
  };
}

/**
 * Conditions averaged across the dark window.
 *
 * Averaging over the window rather than reading a single hourly value matters:
 * a plan is judged on the whole night, and an hour of clear sky after three
 * hours of cloud is not a clear night.
 */
function averageWindow(values: Array<number | undefined> | undefined): number | null {
  const usable = (values ?? []).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => a + b, 0) / usable.length;
}

export function deriveConditions(
  base: Omit<SkyConditions, "transparency" | "seeing">,
): SkyConditions {
  const { cloudCoverPct, cloudLowPct, visibilityMeters, windSpeedKph } = base;

  // Transparency: how much of the sky is blocked, how far you can see, and how
  // much of the blocking is low cloud sitting on the target. The two cloud terms
  // are weighted to sum to 1 so that a genuinely flawless night reaches 1.0
  // rather than being capped at the sum of its weights.
  const clearFraction = 1 - clampPercent(cloudCoverPct) / 100;
  const lowClear = 1 - clampPercent(cloudLowPct) / 100;
  const visibilityTerm = clamp01((visibilityMeters - 2000) / 28000);
  const cloudTerm = 0.6 * clearFraction + 0.4 * lowClear;
  const transparency = round2(clamp01(0.62 * cloudTerm + 0.38 * visibilityTerm));

  // Seeing: atmospheric steadiness is not directly observable, so it is
  // estimated from wind and low cloud. Stated as an estimate in the evidence.
  const windTerm = clamp01(1 - (windSpeedKph - 4) / 34);
  const seeing = round2(clamp01(0.7 * windTerm + 0.3 * lowClear));

  return { ...base, transparency, seeing };
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 100;
  return n < 0 ? 0 : n > 100 ? 100 : n;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function loadConditions(
  latitudeDeg: number,
  longitudeDeg: number,
  windowStart: Date,
  windowEnd: Date,
): Promise<SkyConditions> {
  const now = new Date().toISOString();

  try {
    const params = new URLSearchParams({
      latitude: latitudeDeg.toFixed(4),
      longitude: longitudeDeg.toFixed(4),
      hourly: [
        "cloud_cover",
        "cloud_cover_low",
        "cloud_cover_mid",
        "cloud_cover_high",
        "visibility",
        "wind_speed_10m",
        "temperature_2m",
        "relative_humidity_2m",
      ].join(","),
      wind_speed_unit: "kmh",
      timezone: "UTC",
      forecast_days: "7",
    });

    const data = await fetchJson<OpenMeteoResponse>(`${OPEN_METEO_SOURCE.endpoint}?${params.toString()}`);
    const hourly = data.hourly;
    if (!hourly?.time || hourly.time.length === 0) throw new Error("Open-Meteo returned no hourly series");

    // Select the hours that fall inside the dark window.
    const from = windowStart.getTime();
    const to = windowEnd.getTime();
    const indices: number[] = [];
    for (let i = 0; i < hourly.time.length; i++) {
      const at = hourly.time[i];
      if (!at) continue;
      const ms = Date.parse(`${at}:00Z`);
      if (Number.isFinite(ms) && ms >= from && ms <= to) indices.push(i);
    }
    if (indices.length === 0) throw new Error("forecast does not cover the requested night");

    const pick = (key: NumericHourlyKey) => {
      const series = hourly[key];
      if (!Array.isArray(series)) return undefined;
      return indices.map((i) => series[i]);
    };

    const base = {
      status: "live" as const,
      fetchedAt: now,
      source: OPEN_METEO_SOURCE,
      degradedReason: null,
      cloudCoverPct: averageWindow(pick("cloud_cover")) ?? 100,
      cloudLowPct: averageWindow(pick("cloud_cover_low")) ?? 100,
      cloudMidPct: averageWindow(pick("cloud_cover_mid")) ?? 100,
      cloudHighPct: averageWindow(pick("cloud_cover_high")) ?? 100,
      visibilityMeters: averageWindow(pick("visibility")) ?? 2000,
      windSpeedKph: averageWindow(pick("wind_speed_10m")) ?? 30,
      temperatureC: averageWindow(pick("temperature_2m")) ?? 5,
      humidityPct: averageWindow(pick("relative_humidity_2m")) ?? 80,
    };

    return deriveConditions(base);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown upstream failure";
    return deriveConditions({
      status: "fallback",
      fetchedAt: now,
      source: OPEN_METEO_SOURCE,
      degradedReason: `Live conditions unavailable (${reason}). Showing a sealed offline sample; cloud, visibility and steadiness for this night are estimates, not a forecast.`,
      ...FALLBACK_CONDITIONS,
    });
  }
}

interface ConditionsCache {
  at: number;
  key: string;
  value: SkyConditions;
}

let conditionsCache: ConditionsCache | null = null;

export async function getConditions(
  latitudeDeg: number,
  longitudeDeg: number,
  windowStart: Date,
  windowEnd: Date,
): Promise<SkyConditions> {
  const key = `${latitudeDeg.toFixed(2)}:${longitudeDeg.toFixed(2)}:${windowStart.toISOString().slice(0, 10)}`;
  const now = Date.now();
  if (conditionsCache && conditionsCache.key === key && now - conditionsCache.at < CONDITIONS_TTL_MS) {
    return conditionsCache.value;
  }
  const value = await loadConditions(latitudeDeg, longitudeDeg, windowStart, windowEnd);
  conditionsCache = { at: Date.now(), key, value };
  return value;
}

export function resetConditionsCache(): void {
  conditionsCache = null;
}