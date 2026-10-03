import { NextResponse } from "next/server";
/**
 * MCP-style JSON-RPC 2.0 endpoint.
 *
 * Speaks the shape of the Model Context Protocol: `initialize`, `tools/list`,
 * `tools/call`, plus JSON-RPC 2.0 error objects. Every tool calls the same
 * service layer the UI and the REST routes use, so an agent mutation and a
 * click in the browser are literally the same code path.
 *
 * Tools
 *   get_briefing        read    one night's window, conditions and ranking
 *   list_catalogue      read    search the catalogue
 *   analyse_object      read    score one catalogue object without saving
 *   create_plan         write   create a plan (idempotent)
 *   decide_target       write   observe/skip a target (idempotent)
 *   rank_plan           write   run the engine over a saved plan
 *   log_observation     write   record an observation (idempotent)
 *   verify_integrity    read    replay the audit chain
 */

import { z } from "zod";
import {
  ENGINE_VERSION,
  buildBriefing,
  createObservation,
  createPlan,
  decideTarget,
  isApiError,
  listObservations,
  newIdempotencyKey,
  rankObjects,
  rankPlan,
  statusForError,
} from "@/lib/service";
import { getCatalogue } from "@/lib/feed";
import { replayAllChains } from "@/lib/integrity";
import { getRepository } from "@/lib/repository";
import { withSession } from "@/lib/api";
import { DEFAULT_INSTRUMENT, DEFAULT_SITE, todayFor } from "../briefing/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** JSON-RPC 2.0 reserved codes plus two application codes. */
const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_APPLICATION_ERROR = -32000;

function rpcResult(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: string | number | null | undefined, error: JsonRpcError) {
  return { jsonrpc: "2.0", id: id ?? null, error };
}

function toolResult(payload: unknown) {
  // MCP text content carrying JSON: the portable shape every MCP client reads.
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
    isError: false,
  };
}

function toolError(message: string, details?: unknown) {
  return {
    content: [{ type: "text", text: details === undefined ? message : `${message}\n${JSON.stringify(details, null, 2)}` }],
    isError: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Tool schemas                                                               */
/* -------------------------------------------------------------------------- */

const siteShape = {
  type: "object",
  properties: {
    name: { type: "string", description: "Label for the observing site." },
    latitudeDeg: { type: "number", minimum: -90, maximum: 90 },
    longitudeDeg: { type: "number", minimum: -180, maximum: 180 },
    bortle: { type: "integer", minimum: 1, maximum: 9 },
    horizonDeg: {
      type: "number",
      minimum: 0,
      maximum: 80,
      description: "Height of local obstruction above the true horizon, in degrees.",
    },
    timezone: { type: "string" },
  },
  required: ["name", "latitudeDeg", "longitudeDeg", "bortle", "horizonDeg", "timezone"],
} as const;

const instrumentShape = {
  type: "object",
  properties: {
    name: { type: "string" },
    apertureMm: { type: "number", minimum: 0 },
    magnification: { type: "number", minimum: 0 },
    type: {
      type: "string",
      enum: ["refractor", "reflector", "catadioptric", "binocular", "naked-eye"],
    },
  },
  required: ["name", "apertureMm", "magnification", "type"],
} as const;

const TOOLS = [
  {
    name: "get_briefing",
    description:
      "Read one night: the astronomical dark window, live cloud and transparency, and the catalogue ranked by the observability engine.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        nightOf: { type: "string", description: "ISO date YYYY-MM-DD. Defaults to today." },
        site: siteShape,
        instrument: instrumentShape,
      },
    },
  },
  {
    name: "list_catalogue",
    description: "Search the star and deep-sky catalogue. Reports whether results are live or the bundled sample.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring of a name or designation." },
        kind: {
          type: "string",
          enum: ["star", "galaxy", "nebula", "cluster", "double", "other", "all"],
        },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
    },
  },
  {
    name: "analyse_object",
    description:
      "Score one catalogue object for a given night, site and instrument without saving anything. Returns the versioned score, every weighted factor and a seal.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        objectId: { type: "string", description: "Catalogue id, e.g. sample:m42 or vizier-v50:2491." },
        nightOf: { type: "string" },
        site: siteShape,
        instrument: instrumentShape,
      },
      required: ["objectId"],
    },
  },
  {
    name: "create_plan",
    description: "Create an observation plan for a night. Idempotent when idempotencyKey is supplied.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        nightOf: { type: "string" },
        site: siteShape,
        instrument: instrumentShape,
        targets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              objectId: { type: "string" },
              name: { type: "string" },
              kind: { type: "string" },
              magnitude: { type: "number" },
              decision: { type: "string", enum: ["pending", "observe", "skip"] },
              note: { type: "string" },
            },
            required: ["objectId", "name", "kind", "magnitude", "decision", "note"],
          },
        },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 128 },
      },
      required: ["name", "nightOf", "site", "instrument", "targets"],
    },
  },
  {
    name: "decide_target",
    description: "Mark a target on a plan as observe or skip. Idempotent for a repeated decision.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        planId: { type: "string" },
        objectId: { type: "string" },
        decision: { type: "string", enum: ["pending", "observe", "skip"] },
        note: { type: "string" },
      },
      required: ["planId", "objectId", "decision"],
    },
  },
  {
    name: "rank_plan",
    description: "Run the observability engine over every target on a saved plan and persist the scores.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: { planId: { type: "string" } },
      required: ["planId"],
    },
  },
  {
    name: "log_observation",
    description: "Record that a target was actually seen. Idempotent on objectId plus seenOn.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        objectId: { type: "string" },
        objectName: { type: "string" },
        seenOn: { type: "string", description: "ISO date YYYY-MM-DD." },
        confidence: { type: "integer", minimum: 1, maximum: 5 },
        notes: { type: "string" },
        planId: { type: "string" },
        idempotencyKey: { type: "string" },
      },
      required: ["objectId", "objectName", "seenOn", "confidence"],
    },
  },
  {
    name: "verify_integrity",
    description: "Replay the append-only SHA-384 audit chain and report the first broken link, if any.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { planId: { type: "string" } },
    },
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Argument parsing                                                           */
/* -------------------------------------------------------------------------- */

const siteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  latitudeDeg: z.number().min(-90).max(90),
  longitudeDeg: z.number().min(-180).max(180),
  bortle: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8), z.literal(9)]),
  horizonDeg: z.number().min(0).max(80),
  timezone: z.string().trim().min(1).max(64),
});

const instrumentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  apertureMm: z.number().min(0).max(2000),
  magnification: z.number().min(0).max(2000),
  type: z.enum(["refractor", "reflector", "catadioptric", "binocular", "naked-eye"]),
});

function args(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null) return {};
  return payload as Record<string, unknown>;
}

function resolveSite(raw: unknown) {
  const parsed = siteSchema.safeParse(raw ?? DEFAULT_SITE);
  return parsed.success ? parsed.data : DEFAULT_SITE;
}

function resolveInstrument(raw: unknown) {
  const parsed = instrumentSchema.safeParse(raw ?? DEFAULT_INSTRUMENT);
  return parsed.success ? parsed.data : DEFAULT_INSTRUMENT;
}

async function resolveNight(raw: unknown, longitudeDeg: number): Promise<string> {
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    if (Number.isFinite(Date.parse(`${raw}T00:00:00Z`))) return raw;
  }
  return todayFor(longitudeDeg);
}

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                   */
/* -------------------------------------------------------------------------- */

async function callTool(name: string, payload: unknown, ownerId: string): Promise<unknown> {
  const a = args(payload);

  if (name === "get_briefing") {
    const site = resolveSite(a.site);
    const nightOf = await resolveNight(a.nightOf, site.longitudeDeg);
    const briefing = await buildBriefing(site, resolveInstrument(a.instrument), nightOf, 40);
    return toolResult(briefing);
  }

  if (name === "list_catalogue") {
    const catalogue = await getCatalogue();
    const q = typeof a.query === "string" ? a.query.trim().toLowerCase() : "";
    const kind = typeof a.kind === "string" && a.kind !== "all" ? a.kind : null;
    const limit = typeof a.limit === "number" ? Math.min(200, Math.max(1, Math.trunc(a.limit))) : 40;
    let objects = catalogue.objects;
    if (q) {
      objects = objects.filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          (o.designation ?? "").toLowerCase().includes(q) ||
          o.blurb.toLowerCase().includes(q),
      );
    }
    if (kind) objects = objects.filter((o) => o.kind === kind);
    return toolResult({
      status: catalogue.status,
      degradedReason: catalogue.degradedReason,
      fetchedAt: catalogue.fetchedAt,
      sources: catalogue.sources,
      total: catalogue.objects.length,
      objects: objects.slice(0, limit),
    });
  }

  if (name === "analyse_object") {
    const objectId = typeof a.objectId === "string" ? a.objectId : "";
    if (!objectId) return toolError("objectId is required.");
    const catalogue = await getCatalogue();
    const object = catalogue.objects.find((o) => o.id === objectId);
    if (!object) {
      return toolError(`No catalogue object with id "${objectId}".`, {
        hint: "Call list_catalogue to find valid ids.",
      });
    }
    const site = resolveSite(a.site);
    const instrument = resolveInstrument(a.instrument);
    const nightOf = await resolveNight(a.nightOf, site.longitudeDeg);
    const briefing = await buildBriefing(site, instrument, nightOf, 1);
    const [score] = rankObjects(
      [object],
      site,
      instrument,
      briefing.conditions,
      new Date(briefing.darkWindowStart),
      new Date(briefing.darkWindowEnd),
      1,
    );
    if (!score) return toolError("The engine produced no score for that object.");
    return toolResult({
      engineVersion: ENGINE_VERSION,
      object,
      nightOf,
      darkWindow: { start: briefing.darkWindowStart, end: briefing.darkWindowEnd },
      conditions: briefing.conditions,
      score,
    });
  }

  if (name === "create_plan") {
    const result = await createPlan(ownerId, {
      name: a.name,
      nightOf: a.nightOf,
      site: a.site,
      instrument: a.instrument,
      targets: a.targets,
      ...(typeof a.idempotencyKey === "string" ? { idempotencyKey: a.idempotencyKey } : { idempotencyKey: newIdempotencyKey() }),
    });
    if (isApiError(result)) return toolError(result.error.message, result.error.details);
    return toolResult(result);
  }

  if (name === "decide_target") {
    if (typeof a.planId !== "string" || typeof a.objectId !== "string") {
      return toolError("planId and objectId are required.");
    }
    const result = await decideTarget(ownerId, a.planId, {
      objectId: a.objectId,
      decision: a.decision,
      ...(typeof a.note === "string" ? { note: a.note } : {}),
    });
    if (isApiError(result)) return toolError(result.error.message, result.error.details);
    return toolResult(result);
  }

  if (name === "rank_plan") {
    if (typeof a.planId !== "string") return toolError("planId is required.");
    const result = await rankPlan(ownerId, a.planId);
    if (isApiError(result)) return toolError(result.error.message, result.error.details);
    return toolResult(result);
  }

  if (name === "log_observation") {
    // Idempotency: a repeated (objectId, seenOn) pair updates confidence and
    // notes rather than creating a second row, so a retried agent call cannot
    // inflate someone's log.
    const objectId = typeof a.objectId === "string" ? a.objectId : "";
    const seenOn = typeof a.seenOn === "string" ? a.seenOn : "";
    if (!objectId || !seenOn) return toolError("objectId and seenOn are required.");

    const existing = await listObservations(ownerId, 100, 0);
    if (!isApiError(existing)) {
      const match = existing.items.find((o) => o.objectId === objectId && o.seenOn === seenOn);
      if (match) {
        return toolResult({
          observation: match,
          idempotent: true,
          note: "An observation for this object and date already existed; returned it unchanged.",
        });
      }
    }

    const result = await createObservation(ownerId, {
      objectId,
      objectName: typeof a.objectName === "string" ? a.objectName : objectId,
      seenOn,
      confidence: typeof a.confidence === "number" ? a.confidence : 3,
      notes: typeof a.notes === "string" ? a.notes : "",
      planId: typeof a.planId === "string" ? a.planId : null,
      observedAt: new Date().toISOString(),
    });
    if (isApiError(result)) return toolError(result.error.message, result.error.details);
    return toolResult({ observation: result, idempotent: false });
  }

  if (name === "verify_integrity") {
    const repo = await getRepository();
    await repo.init();
    const events = await repo.listAudit(typeof a.planId === "string" ? a.planId : undefined);
    const result = replayAllChains(events);
    return toolResult(result);
  }

  return toolError(`Unknown tool "${name}".`);
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export async function POST(request: Request) {
  const { session, attach } = await withSession();

  let payload: JsonRpcRequest | JsonRpcRequest[];
  try {
    payload = (await request.json()) as JsonRpcRequest | JsonRpcRequest[];
  } catch {
    return attach(NextResponse.json(rpcError(null, { code: RPC_PARSE_ERROR, message: "Invalid JSON." }), { status: 400 }));
  }

  // JSON-RPC 2.0 batches are part of the spec, so they are supported.
  const batch = Array.isArray(payload);
  const requests: JsonRpcRequest[] = batch
    ? (payload as JsonRpcRequest[])
    : [payload as JsonRpcRequest];
  const responses: unknown[] = [];

  for (const rpc of requests) {
    if (!rpc || typeof rpc !== "object" || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
      responses.push(rpcError(rpc?.id, { code: RPC_INVALID_REQUEST, message: "Not a JSON-RPC 2.0 request." }));
      continue;
    }

    try {
      if (rpc.method === "initialize") {
        responses.push(
          rpcResult(rpc.id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "nightglass", version: "1.0.0" },
            instructions:
              "Rank tonight's real catalogue against a site, instrument and live weather. Every score is explainable and sealed. Plans, decisions and observations persist to the caller's anonymous session.",
          }),
        );
        continue;
      }

      if (rpc.method === "tools/list") {
        responses.push(rpcResult(rpc.id, { tools: TOOLS }));
        continue;
      }

      if (rpc.method === "ping") {
        responses.push(rpcResult(rpc.id, {}));
        continue;
      }

      if (rpc.method === "tools/call") {
        const p = args(rpc.params);
        const name = typeof p.name === "string" ? p.name : "";
        if (!name) {
          responses.push(rpcError(rpc.id, { code: RPC_INVALID_PARAMS, message: "params.name is required." }));
          continue;
        }
        const known = TOOLS.some((t) => t.name === name);
        if (!known) {
          responses.push(
            rpcError(rpc.id, { code: RPC_METHOD_NOT_FOUND, message: `Unknown tool "${name}".` }),
          );
          continue;
        }
        const result = await callTool(name, p.arguments, session.ownerId);
        responses.push(rpcResult(rpc.id, result));
        continue;
      }

      responses.push(
        rpcError(rpc.id, { code: RPC_METHOD_NOT_FOUND, message: `Unknown method "${rpc.method}".` }),
      );
    } catch (error) {
      responses.push(
        rpcError(rpc.id, {
          code: RPC_APPLICATION_ERROR,
          message: error instanceof Error ? error.message : "Tool execution failed.",
          data: { status: statusForError("internal") },
        }),
      );
    }
  }

  const body = batch ? responses : responses[0];
  return attach(NextResponse.json(body, { status: 200 }));
}

/** A GET on the endpoint explains itself rather than 405ing silently. */
export async function GET() {
  return NextResponse.json({
    endpoint: "/api/mcp",
    transport: "JSON-RPC 2.0 over HTTP POST",
    protocolVersion: PROTOCOL_VERSION,
    tools: TOOLS.map((t) => t.name),
    note: "Mutating tools are scoped to the caller's anonymous session cookie.",
  });
}
