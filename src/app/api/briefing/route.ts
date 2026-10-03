import { NextResponse } from "next/server";
import { buildBriefing, fail, instrumentSchema, nightOfSchema, siteSchema, statusForError } from "@/lib/service";
import { fromResult, withSession } from "@/lib/api";
import type { BortleClass, InstrumentProfile, InstrumentType, SiteProfile } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const DEFAULT_SITE: SiteProfile = {
  name: "Your balcony",
  latitudeDeg: 28.6139,
  longitudeDeg: 77.209,
  bortle: 7,
  horizonDeg: 15,
  timezone: "auto",
};

export const DEFAULT_INSTRUMENT: InstrumentProfile = {
  name: "200 mm Newtonian",
  apertureMm: 200,
  magnification: 120,
  type: "reflector",
};

/** Today at the site's longitude, as `YYYY-MM-DD`. */
export function todayFor(longitudeDeg: number): string {
  const now = new Date();
  const local = new Date(now.getTime() + longitudeDeg * 60000);
  return local.toISOString().slice(0, 10);
}

/**
 * Coerce query-string values into the domain types and validate them.
 *
 * Query parameters arrive as strings, so they are parsed before hitting the
 * schemas. Invalid input produces a normal 400 rather than a NaN reaching the
 * astronomy code.
 */
export function parseBriefingParams(url: string): {
  site: SiteProfile;
  instrument: InstrumentProfile;
  nightOf: string;
} | ReturnType<typeof fail> {
  const p = new URL(url).searchParams;

  const bortleRaw = Number(p.get("bortle"));
  const siteResult = siteSchema.safeParse({
    name: p.get("siteName") || DEFAULT_SITE.name,
    latitudeDeg: p.get("lat") === null ? DEFAULT_SITE.latitudeDeg : Number(p.get("lat")),
    longitudeDeg: p.get("lon") === null ? DEFAULT_SITE.longitudeDeg : Number(p.get("lon")),
    bortle: Number.isFinite(bortleRaw) ? (bortleRaw as BortleClass) : DEFAULT_SITE.bortle,
    horizonDeg: p.get("horizon") === null ? DEFAULT_SITE.horizonDeg : Number(p.get("horizon")),
    timezone: p.get("timezone") || DEFAULT_SITE.timezone,
  });
  if (!siteResult.success) return fail("invalid_request", "Invalid site parameters.", siteResult.error.issues);

  const typeRaw = p.get("type") as InstrumentType | null;
  const instrumentResult = instrumentSchema.safeParse({
    name: p.get("instrumentName") || DEFAULT_INSTRUMENT.name,
    apertureMm: p.get("aperture") === null ? DEFAULT_INSTRUMENT.apertureMm : Number(p.get("aperture")),
    magnification:
      p.get("magnification") === null ? DEFAULT_INSTRUMENT.magnification : Number(p.get("magnification")),
    type: typeRaw ?? DEFAULT_INSTRUMENT.type,
  });
  if (!instrumentResult.success) {
    return fail("invalid_request", "Invalid instrument parameters.", instrumentResult.error.issues);
  }

  const nightRaw = p.get("nightOf") ?? todayFor(siteResult.data.longitudeDeg);
  const nightResult = nightOfSchema.safeParse(nightRaw);
  if (!nightResult.success) return fail("invalid_request", "Invalid nightOf; expected YYYY-MM-DD.");

  return { site: siteResult.data, instrument: instrumentResult.data, nightOf: nightResult.data };
}

/**
 * One night, fully worked out: the astronomical dark window, live conditions,
 * and every catalogue target ranked through the engine.
 */
export async function GET(request: Request) {
  const { attach } = await withSession();
  const params = parseBriefingParams(request.url);
  if ("error" in params) {
    return attach(
      NextResponse.json(params, { status: statusForError(params.error.code) }),
    );
  }
  const briefing = await buildBriefing(params.site, params.instrument, params.nightOf, 80);
  return fromResult(briefing, attach);
}