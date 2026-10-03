/**
 * Domain service layer.
 *
 * The UI, the REST routes and the MCP tools all call these functions. There is
 * exactly one code path for create, update, delete, rank, log and export, so
 * the audit chain and the score can never disagree between surfaces.
 */

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { ENGINE_VERSION, rankTargets, type EngineInput } from "./engine";
import {
  darkWindowFor,
  equatorialToHorizontal,
  localSiderealDeg,
  moonState,
} from "./astro";
import { canonicalJson, sha384Hex } from "./integrity";
import { getRepository, type Repository } from "./repository";
import { getCatalogue, getConditions, findObjects } from "./feed";
import type {
  ApiError,
  ApiErrorCode,
  CreateObservationInput,
  CreatePlanInput,
  InstrumentProfile,
  NightBriefing,
  Observation,
  ObservabilityScore,
  ObservingPlan,
  PlannedTarget,
  SiteProfile,
  SkyConditions,
  SkyObject,
  TargetDecision,
  UpdateObservationInput,
  UpdatePlanInput,
} from "./types";

export const NAME_MAX = 100;
export const NOTE_MAX = 2000;

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export const bortleSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(9),
]);

export const instrumentTypeSchema = z.enum([
  "refractor",
  "reflector",
  "catadioptric",
  "binocular",
  "naked-eye",
]);

export const siteSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX),
  latitudeDeg: z.number().min(-90).max(90),
  longitudeDeg: z.number().min(-180).max(180),
  bortle: bortleSchema,
  horizonDeg: z.number().min(0).max(80),
  timezone: z.string().trim().min(1).max(64),
});

export const instrumentSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX),
  apertureMm: z.number().min(0).max(2000),
  magnification: z.number().min(0).max(2000),
  type: instrumentTypeSchema,
});

export const nightOfSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "nightOf must be an ISO calendar date, YYYY-MM-DD")
  .refine((value) => {
    const parsed = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(parsed);
  }, "nightOf is not a real date");

export const decisionSchema = z.enum(["pending", "observe", "skip"]);

/**
 * A target as a client may submit it.
 *
 * `score` is deliberately absent: a score is engine output, never client input.
 * Accepting one from the request body would let a caller write a fabricated
 * observability verdict into their own plan and have it read back as if the
 * engine had produced it. The server sets scores, in `rankPlan`, and nothing
 * else.
 */
export const targetSchema = z.object({
  objectId: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(NAME_MAX),
  kind: z.enum(["star", "galaxy", "nebula", "cluster", "double", "other"]),
  magnitude: z.number().min(-30).max(30),
  decision: decisionSchema,
  note: z.string().max(NOTE_MAX),
});

/** Map validated client targets onto stored targets, forcing scores to null. */
function toPlannedTargets(
  parsed: z.infer<typeof targetSchema>[],
): Array<{ objectId: string; name: string; kind: PlannedTarget["kind"]; magnitude: number; decision: TargetDecision; note: string; score: null }> {
  return parsed.map((t) => ({
    objectId: t.objectId,
    name: t.name,
    kind: t.kind,
    magnitude: t.magnitude,
    decision: t.decision,
    note: t.note,
    score: null,
  }));
}

export const createPlanSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(NAME_MAX),
  site: siteSchema,
  instrument: instrumentSchema,
  nightOf: nightOfSchema,
  targets: z.array(targetSchema).max(200, "a plan may hold at most 200 targets"),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const updatePlanSchema = z
  .object({
    name: z.string().trim().min(1).max(NAME_MAX).optional(),
    site: siteSchema.optional(),
    instrument: instrumentSchema.optional(),
    nightOf: nightOfSchema.optional(),
    targets: z.array(targetSchema).max(200).optional(),
    idempotencyKey: z.string().min(8).max(128).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

export const createObservationSchema = z.object({
  planId: z.string().trim().max(64).nullable().optional(),
  objectId: z.string().trim().min(1).max(120),
  objectName: z.string().trim().min(1).max(NAME_MAX),
  seenOn: nightOfSchema,
  confidence: z.number().int().min(1).max(5),
  notes: z.string().max(NOTE_MAX).optional(),
  observedAt: z.string().datetime({ offset: true }).optional(),
});

export const updateObservationSchema = z
  .object({
    objectName: z.string().trim().min(1).max(NAME_MAX).optional(),
    seenOn: nightOfSchema.optional(),
    confidence: z.number().int().min(1).max(5).optional(),
    notes: z.string().max(NOTE_MAX).optional(),
    observedAt: z.string().datetime({ offset: true }).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

export const decideTargetSchema = z.object({
  objectId: z.string().trim().min(1).max(120),
  decision: decisionSchema,
  note: z.string().max(NOTE_MAX).optional(),
});

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export function fail(code: ApiErrorCode, message: string, details?: unknown): ApiError {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

export function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null && "error" in value;
}

export function statusForError(code: ApiErrorCode): number {
  switch (code) {
    case "invalid_request":
      return 400;
    case "unauthorized":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "rate_limited":
      return 429;
    case "upstream_unavailable":
      return 503;
    case "internal":
      return 500;
  }
}

/**
 * Best-effort per-session write throttle.
 *
 * On serverless this is per-instance and therefore approximate. See the README
 * security section for the hosted rate limiter that a production deployment
 * should put in front of this.
 */
const WINDOW_MS = 60_000;
const MAX_WRITES_PER_WINDOW = 40;
const writeBudget = new Map<string, { count: number; resetAt: number }>();

export function checkWriteBudget(ownerId: string): ApiError | null {
  const now = Date.now();
  const entry = writeBudget.get(ownerId);
  if (!entry || now > entry.resetAt) {
    writeBudget.set(ownerId, { count: 1, resetAt: now + WINDOW_MS });
    if (writeBudget.size > 5000) {
      for (const [key, val] of writeBudget) {
        if (now > val.resetAt) writeBudget.delete(key);
      }
    }
    return null;
  }
  if (entry.count >= MAX_WRITES_PER_WINDOW) {
    return fail("rate_limited", `Too many writes. Try again in ${Math.ceil((entry.resetAt - now) / 1000)}s.`);
  }
  entry.count += 1;
  return null;
}

export async function withRepository<T>(fn: (repo: Repository) => Promise<T>): Promise<T> {
  const repo = await getRepository();
  await repo.init();
  return fn(repo);
}

export function newIdempotencyKey(): string {
  return randomBytes(12).toString("base64url");
}

/* -------------------------------------------------------------------------- */
/* Briefing                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Everything needed to render one night: the dark window, live conditions, and
 * every catalogue target ranked through the engine.
 *
 * Ranking is capped at a bounded number of objects so the payload stays small
 * and the computation stays responsive; the cap is reported, never silent.
 */
export async function buildBriefing(
  site: SiteProfile,
  instrument: InstrumentProfile,
  nightOf: string,
  limit = 60,
): Promise<NightBriefing> {
  const window = darkWindowFor(nightOf, site.latitudeDeg, site.longitudeDeg);
  const [catalogue, conditions] = await Promise.all([
    getCatalogue(),
    getConditions(site.latitudeDeg, site.longitudeDeg, window.start, window.end),
  ]);

  const ranked = rankObjects(
    catalogue.objects,
    site,
    instrument,
    conditions,
    window.start,
    window.end,
    limit,
  );

  const mid = new Date((window.start.getTime() + window.end.getTime()) / 2);
  const moon = moonState(mid);
  const lst = localSiderealDeg(mid, site.longitudeDeg);
  const moonAltitude = equatorialToHorizontal(moon.raDeg, moon.decDeg, site.latitudeDeg, lst).altitudeDeg;

  return {
    site,
    instrument,
    nightOf,
    conditions,
    darkWindowStart: window.start.toISOString(),
    darkWindowEnd: window.end.toISOString(),
    sunMidnightAltitudeDeg: Number(window.sunMidnightAltitudeDeg.toFixed(2)),
    moonIllumination: Number(moon.illumination.toFixed(3)),
    moonAltitudeAtMidnightDeg: Number(moonAltitude.toFixed(2)),
    ranked,
  };
}

/**
 * Rank catalogue objects through the engine and stamp each result with a seal
 * over its own inputs and outputs, so a score can be re-derived and checked
 * later without re-running the whole pipeline.
 */
export function rankObjects(
  objects: SkyObject[],
  site: SiteProfile,
  instrument: InstrumentProfile,
  conditions: SkyConditions,
  windowStart: Date,
  windowEnd: Date,
  limit: number,
): ObservabilityScore[] {
  const inputs: EngineInput[] = objects.map((object) => ({
    object,
    site,
    instrument,
    conditions,
    windowStart,
    windowEnd,
  }));
  return rankTargets(inputs)
    .map((score) => ({ ...score, seal: sealScore(score) }))
    .slice(0, Math.max(1, limit));
}

/** Stable seal over an engine result, independent of when it was computed. */
export function sealScore(score: ObservabilityScore): string {
  return sha384Hex(
    canonicalJson({
      engine: score.engineVersion,
      objectId: score.objectId,
      score: score.score,
      band: score.band,
      gated: score.gated,
      factors: score.factors.map((f) => ({ id: f.id, value: f.value, weight: f.weight })),
      maxAltitudeDeg: score.maxAltitudeDeg,
      windowStart: score.windowStart,
      windowEnd: score.windowEnd,
      moonSeparationDeg: score.moonSeparationDeg,
      moonIllumination: score.moonIllumination,
      limitingMagnitude: score.limitingMagnitude,
      curve: score.altitudeCurve.map((s) => [s.at, s.altitudeDeg, s.azimuthDeg]),
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Plans                                                                      */
/* -------------------------------------------------------------------------- */

export async function createPlan(ownerId: string, raw: unknown): Promise<ObservingPlan | ApiError> {
  const parsed = createPlanSchema.safeParse(raw);
  if (!parsed.success) return fail("invalid_request", "Invalid plan payload.", parsed.error.issues);

  const budget = checkWriteBudget(ownerId);
  if (budget) return budget;

  const input: CreatePlanInput = {
    name: parsed.data.name,
    site: parsed.data.site,
    instrument: parsed.data.instrument,
    nightOf: parsed.data.nightOf,
    targets: toPlannedTargets(parsed.data.targets),
    ...(parsed.data.idempotencyKey ? { idempotencyKey: parsed.data.idempotencyKey } : {}),
  };

  return withRepository(async (repo) => {
    const plan = await repo.createPlan(ownerId, input);
    await repo.appendAudit(plan.id, "plan.created", { plan: { ...plan } }, ownerId);
    return plan;
  });
}

export async function listPlans(
  ownerId: string,
  limit: number,
  offset: number,
): Promise<{ items: ObservingPlan[]; total: number } | ApiError> {
  return withRepository((repo) => repo.listPlans(ownerId, limit, offset));
}

export async function getPlan(ownerId: string, id: string): Promise<ObservingPlan | ApiError> {
  return withRepository(async (repo) => {
    const plan = await repo.getPlan(ownerId, id);
    if (!plan || plan.deleted) return fail("not_found", "Plan not found.");
    return plan;
  });
}

export async function updatePlan(
  ownerId: string,
  id: string,
  raw: unknown,
): Promise<ObservingPlan | ApiError> {
  const parsed = updatePlanSchema.safeParse(raw);
  if (!parsed.success) return fail("invalid_request", "Invalid update payload.", parsed.error.issues);

  const budget = checkWriteBudget(ownerId);
  if (budget) return budget;

  const data = parsed.data;
  const input: UpdatePlanInput = {
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.site !== undefined ? { site: data.site } : {}),
    ...(data.instrument !== undefined ? { instrument: data.instrument } : {}),
    ...(data.nightOf !== undefined ? { nightOf: data.nightOf } : {}),
    ...(data.targets !== undefined ? { targets: toPlannedTargets(data.targets) } : {}),
  };

  return withRepository(async (repo) => {
    const updated = await repo.updatePlan(ownerId, id, input);
    if (!updated) return fail("not_found", "Plan not found.");
    await repo.appendAudit(updated.id, "plan.updated", { plan: { ...updated } }, ownerId);
    return updated;
  });
}

export async function deletePlan(ownerId: string, id: string): Promise<ObservingPlan | ApiError> {
  const budget = checkWriteBudget(ownerId);
  if (budget) return budget;
  return withRepository(async (repo) => {
    const deleted = await repo.deletePlan(ownerId, id);
    if (!deleted) return fail("not_found", "Plan not found.");
    // The tombstone row stays so the chain remains replayable after deletion.
    await repo.appendAudit(deleted.id, "plan.deleted", { tombstone: deleted.id }, ownerId);
    return deleted;
  });
}

/* -------------------------------------------------------------------------- */
/* Ranking a saved plan                                                       */
/* -------------------------------------------------------------------------- */

export async function rankPlan(
  ownerId: string,
  planId: string,
): Promise<{ plan: ObservingPlan; seal: string } | ApiError> {
  return withRepository(async (repo) => {
    const plan = await repo.getPlan(ownerId, planId);
    if (!plan || plan.deleted) return fail("not_found", "Plan not found.");

    const briefing = await buildBriefing(plan.site, plan.instrument, plan.nightOf, 200);

    // Rank exactly the plan's own targets, so the stored scores describe this
    // plan rather than the whole catalogue.
    const objects = findObjects(
      (await getCatalogue()).objects,
      plan.targets.map((t) => t.objectId),
    );
    const inputs: EngineInput[] = objects.map((object) => ({
      object,
      site: plan.site,
      instrument: plan.instrument,
      conditions: briefing.conditions,
      windowStart: new Date(briefing.darkWindowStart),
      windowEnd: new Date(briefing.darkWindowEnd),
    }));
    const ranked = rankTargets(inputs).map((score) => ({ ...score, seal: sealScore(score) }));
    const scoreById = new Map(objects.map((object, i) => [object.id, ranked[i]!]));

    const targets = plan.targets.map((target) => ({
      ...target,
      score: scoreById.get(target.objectId) ?? null,
    }));

    const updated = await repo.updatePlan(ownerId, plan.id, { targets });
    if (!updated) return fail("not_found", "Plan not found.");

    const seal = sha384Hex(
      canonicalJson({ planId: plan.id, engine: ENGINE_VERSION, ranked: ranked.map((r) => r.seal) }),
    );
    await repo.appendAudit(
      plan.id,
      "plan.ranked",
      { engine: ENGINE_VERSION, count: ranked.length, seal },
      ownerId,
    );
    return { plan: updated, seal };
  });
}

export async function decideTarget(
  ownerId: string,
  planId: string,
  raw: unknown,
): Promise<ObservingPlan | ApiError> {
  const parsed = decideTargetSchema.safeParse(raw);
  if (!parsed.success) return fail("invalid_request", "Invalid decision payload.", parsed.error.issues);
  const { objectId, decision, note } = parsed.data;

  return withRepository(async (repo) => {
    const plan = await repo.getPlan(ownerId, planId);
    if (!plan || plan.deleted) return fail("not_found", "Plan not found.");

    const index = plan.targets.findIndex((t) => t.objectId === objectId);
    if (index < 0) return fail("not_found", "That target is not in this plan.");

    const targets = plan.targets.map((target) =>
      target.objectId === objectId
        ? { ...target, decision: decision as TargetDecision, note: note ?? target.note }
        : target,
    );

    const updated = await repo.updatePlan(ownerId, plan.id, { targets });
    if (!updated) return fail("not_found", "Plan not found.");
    await repo.appendAudit(updated.id, "plan.target_decided", { objectId, decision }, ownerId);
    return updated;
  });
}

/* -------------------------------------------------------------------------- */
/* Observations                                                               */
/* -------------------------------------------------------------------------- */

export async function createObservation(
  ownerId: string,
  raw: unknown,
): Promise<Observation | ApiError> {
  const parsed = createObservationSchema.safeParse(raw);
  if (!parsed.success) return fail("invalid_request", "Invalid observation payload.", parsed.error.issues);

  const budget = checkWriteBudget(ownerId);
  if (budget) return budget;

  const input: CreateObservationInput = {
    planId: parsed.data.planId ?? null,
    objectId: parsed.data.objectId,
    objectName: parsed.data.objectName,
    seenOn: parsed.data.seenOn,
    confidence: parsed.data.confidence,
    notes: parsed.data.notes ?? "",
    observedAt: parsed.data.observedAt ?? new Date().toISOString(),
  };

  return withRepository(async (repo) => {
    if (input.planId) {
      const plan = await repo.getPlan(ownerId, input.planId);
      if (!plan || plan.deleted) return fail("not_found", "Plan not found.");
    }
    const observation = await repo.createObservation(ownerId, input);
    await repo.appendAudit(
      observation.id,
      "observation.created",
      { observation: { ...observation } },
      ownerId,
    );
    return observation;
  });
}

export async function listObservations(
  ownerId: string,
  limit: number,
  offset: number,
): Promise<{ items: Observation[]; total: number } | ApiError> {
  return withRepository((repo) => repo.listObservations(ownerId, limit, offset));
}

export async function getObservation(ownerId: string, id: string): Promise<Observation | ApiError> {
  return withRepository(async (repo) => {
    const observation = await repo.getObservation(ownerId, id);
    if (!observation || observation.deleted) return fail("not_found", "Observation not found.");
    return observation;
  });
}

export async function updateObservation(
  ownerId: string,
  id: string,
  raw: unknown,
): Promise<Observation | ApiError> {
  const parsed = updateObservationSchema.safeParse(raw);
  if (!parsed.success) return fail("invalid_request", "Invalid update payload.", parsed.error.issues);

  const budget = checkWriteBudget(ownerId);
  if (budget) return budget;

  const data = parsed.data;
  const input: UpdateObservationInput = {
    ...(data.objectName !== undefined ? { objectName: data.objectName } : {}),
    ...(data.seenOn !== undefined ? { seenOn: data.seenOn } : {}),
    ...(data.confidence !== undefined ? { confidence: data.confidence } : {}),
    ...(data.notes !== undefined ? { notes: data.notes } : {}),
    ...(data.observedAt !== undefined ? { observedAt: data.observedAt } : {}),
  };

  return withRepository(async (repo) => {
    const updated = await repo.updateObservation(ownerId, id, input);
    if (!updated) return fail("not_found", "Observation not found.");
    await repo.appendAudit(updated.id, "observation.updated", { observation: { ...updated } }, ownerId);
    return updated;
  });
}

export async function deleteObservation(ownerId: string, id: string): Promise<Observation | ApiError> {
  const budget = checkWriteBudget(ownerId);
  if (budget) return budget;
  return withRepository(async (repo) => {
    const deleted = await repo.deleteObservation(ownerId, id);
    if (!deleted) return fail("not_found", "Observation not found.");
    await repo.appendAudit(deleted.id, "observation.deleted", { tombstone: deleted.id }, ownerId);
    return deleted;
  });
}

export { ENGINE_VERSION };