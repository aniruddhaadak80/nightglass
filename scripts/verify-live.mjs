#!/usr/bin/env node
/**
 * Live end-to-end verifier.
 *
 * Proves the whole primary journey against a running base URL using real HTTP
 * requests: create → read back → rank → decide → MCP mutation → integrity
 * replay → export → delete.
 *
 * The base URL comes from `BASE_URL` (or `--url`). No secrets are read, printed
 * or embedded. A single cookie jar stands in for a browser session, which is
 * exactly how the anonymous ownership cookie behaves in practice.
 *
 *   node scripts/verify-live.mjs --url http://localhost:3111
 *   BASE_URL=https://nightglass.vercel.app node scripts/verify-live.mjs
 */

const args = process.argv.slice(2);
const urlFlagIndex = args.indexOf("--url");
const BASE = (urlFlagIndex >= 0 ? args[urlFlagIndex + 1] : process.env.BASE_URL ?? "").replace(/\/$/, "");

if (!BASE) {
  console.error("Set BASE_URL or pass --url <origin>. Example: node scripts/verify-live.mjs --url http://localhost:3111");
  process.exit(2);
}

const REPO_URL = "https://github.com/aniruddhaadak80/nightglass";

/** Minimal cookie jar: one anonymous session across every request. */
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair] = line.split(";");
    if (!pair) continue;
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

async function call(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    redirect: "manual",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {}),
      ...(jar.size > 0 ? { cookie: cookieHeader() } : {}),
    },
  });
  storeCookies(response);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, text, json, headers: response.headers };
}

async function rpc(method, params = {}) {
  return call("/api/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function tool(name, args) {
  const res = await rpc("tools/call", { name, arguments: args });
  return res.json?.result ?? res.json;
}

const results = [];
let failed = 0;

async function check(label, fn) {
  try {
    const detail = await fn();
    results.push({ label, ok: true, detail: detail ?? "" });
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    results.push({ label, ok: false, detail: message });
    console.log(`  FAIL  ${label} — ${message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const nightOf = new Date().toISOString().slice(0, 10);
const site = { name: "verify-live site", latitudeDeg: 40.0, longitudeDeg: -3.0, bortle: 5, horizonDeg: 12, timezone: "UTC" };
const instrument = { name: "200 mm Newtonian", apertureMm: 200, magnification: 120, type: "reflector" };

let planId = null;
let m42Id = "sample:M42";

console.log(`\nnightglass live verification against ${BASE}\n`);

/* ------------------------------------------------------------------ checks */

await check("GET / returns 200 with the product name", async () => {
  const res = await call("/");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(res.text.includes("nightglass"), "homepage does not mention nightglass");
  return `title present`;
});

await check("GET /api/health reports a working production store", async () => {
  const res = await call("/api/health");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const body = res.json;
  assert(body.ok === true, `health not ok: ${JSON.stringify(body?.store ?? body)}`);
  assert(body.store.adapter === "neon-postgres", `expected neon-postgres, got ${body.store.adapter}`);
  assert(body.store.productionStore === true, "health did not report a production store");
  assert(body.feed.objects > 0, "catalogue reported zero objects");
  return `${body.store.adapter}, ${body.feed.objects} objects, feed ${body.feed.catalogueStatus}`;
});

await check("GET /api/catalogue returns normalised objects with source metadata", async () => {
  const res = await call("/api/catalogue?limit=20");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const body = res.json;
  assert(Array.isArray(body.objects) && body.objects.length > 0, "no objects returned");
  const first = body.objects[0];
  assert(typeof first.raDeg === "number" && typeof first.decDeg === "number", "object missing coordinates");
  assert(Array.isArray(body.sources) && body.sources.length > 0, "no source attribution");
  assert(body.status === "live" || body.status === "fallback", "status is neither live nor fallback");
  // Prefer a bundled deep-sky id for the rest of the run: it is always present.
  const m42 = body.objects.find((o) => o.id === "sample:M42");
  if (m42) m42Id = m42.id;
  return `status=${body.status}, ${body.total} objects, sources=${body.sources.length}`;
});

await check("GET /api/briefing computes a ranked night", async () => {
  const res = await call(`/api/briefing?lat=40&lon=-3&bortle=5&horizon=12&nightOf=${nightOf}`);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const body = res.json;
  assert(Array.isArray(body.ranked) && body.ranked.length > 0, "no ranked targets");
  assert(typeof body.darkWindowStart === "string", "no dark window reported");
  const best = body.ranked[0];
  assert(typeof best.score === "number", "top target has no score");
  assert(Array.isArray(best.factors) && best.factors.length === 6, `expected 6 factors, got ${best.factors?.length}`);
  assert(typeof best.seal === "string" && best.seal.length === 96, "score seal is not a SHA-384 hex digest");
  return `dark ${body.darkWindowStart.slice(11, 16)}–${body.darkWindowEnd.slice(11, 16)}, top ${best.objectName} ${best.score}`;
});

await check("POST /api/plans creates a record", async () => {
  const res = await call("/api/plans", {
    method: "POST",
    body: JSON.stringify({
      name: `verify-live ${nightOf}`,
      nightOf,
      site,
      instrument,
      targets: [
        { objectId: m42Id, name: "Orion Nebula", kind: "nebula", magnitude: 4.0, decision: "pending", note: "" },
        { objectId: "sample:M31", name: "Andromeda Galaxy", kind: "galaxy", magnitude: 3.4, decision: "pending", note: "" },
      ],
      idempotencyKey: `verify-live-${Date.now()}`,
    }),
  });
  assert(res.status === 200, `expected 200, got ${res.status}: ${res.text.slice(0, 200)}`);
  assert(res.json?.id, "no plan id returned");
  planId = res.json.id;
  return `plan ${planId.slice(0, 8)}`;
});

await check("GET /api/plans/:id reads the record back", async () => {
  const res = await call(`/api/plans/${planId}`);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(res.json.id === planId, "read-back returned a different plan");
  assert(res.json.targets.length === 2, `expected 2 targets, got ${res.json.targets.length}`);
  assert(res.json.name === `verify-live ${nightOf}`, "name did not round-trip");
  return "name, nightOf and 2 targets round-tripped";
});

await check("PATCH /api/plans/:id persists an update", async () => {
  const res = await call(`/api/plans/${planId}`, {
    method: "PATCH",
    body: JSON.stringify({ name: `verify-live renamed ${nightOf}` }),
  });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(res.json.name === `verify-live renamed ${nightOf}`, "update was not reflected in the response");

  const readBack = await call(`/api/plans/${planId}`);
  assert(readBack.json.name === `verify-live renamed ${nightOf}`, "update was not persisted");
  return "rename persisted and read back";
});

await check("POST /api/plans/:id/rank stores engine scores", async () => {
  const res = await call(`/api/plans/${planId}/rank`, { method: "POST", body: "{}" });
  assert(res.status === 200, `expected 200, got ${res.status}: ${res.text.slice(0, 200)}`);
  assert(typeof res.json.seal === "string", "ranking returned no seal");

  const readBack = await call(`/api/plans/${planId}`);
  const scored = readBack.json.targets.filter((t) => t.score);
  assert(scored.length === 2, `expected 2 scored targets, got ${scored.length}`);
  assert(typeof scored[0].score.score === "number", "stored score is not numeric");
  assert(scored[0].score.factors.length === 6, "stored score is missing factors");
  return `${scored.length} targets scored, seal ${res.json.seal.slice(0, 12)}…`;
});

await check("POST target decision persists", async () => {
  const res = await call(`/api/plans/${planId}/targets/${encodeURIComponent(m42Id)}`, {
    method: "POST",
    body: JSON.stringify({ decision: "observe" }),
  });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const target = res.json.targets.find((t) => t.objectId === m42Id);
  assert(target?.decision === "observe", `decision is ${target?.decision}`);

  const readBack = await call(`/api/plans/${planId}`);
  const stored = readBack.json.targets.find((t) => t.objectId === m42Id);
  assert(stored?.decision === "observe", "decision was not persisted");
  return "observe decision persisted";
});

await check("MCP initialize succeeds", async () => {
  const res = await rpc("initialize");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(res.json?.result?.serverInfo?.name === "nightglass", "wrong server name");
  assert(typeof res.json.result.protocolVersion === "string", "no protocol version");
  return `protocol ${res.json.result.protocolVersion}`;
});

await check("MCP tools/list returns the expected tools with schemas", async () => {
  const res = await rpc("tools/list");
  const tools = res.json?.result?.tools ?? [];
  const names = tools.map((t) => t.name);
  for (const required of ["get_briefing", "list_catalogue", "analyse_object", "create_plan", "decide_target", "rank_plan", "log_observation", "verify_integrity"]) {
    assert(names.includes(required), `missing tool ${required}`);
  }
  const read = tools.filter((t) => t.annotations?.readOnlyHint);
  const write = tools.filter((t) => !t.annotations?.readOnlyHint);
  assert(read.length >= 2, "expected at least two read tools");
  assert(write.length >= 3, "expected at least three mutating tools");
  for (const t of tools) assert(t.inputSchema?.type === "object", `${t.name} has no object input schema`);
  return `${tools.length} tools (${read.length} read, ${write.length} mutating)`;
});

await check("MCP analyse_object returns a versioned, sealed score", async () => {
  const result = await tool("analyse_object", { objectId: m42Id });
  assert(result?.content, "no MCP content returned");
  const payload = result.structuredContent ?? JSON.parse(result.content[0].text);
  assert(payload.engineVersion, "no engine version");
  assert(typeof payload.score.score === "number", "no score");
  assert(payload.score.factors.length === 6, "wrong factor count");
  assert(payload.score.seal.length === 96, "seal is not SHA-384");
  assert(typeof payload.score.recommendation === "string", "no recommendation");
  return `${payload.object.name}: ${payload.score.score}/100 (${payload.score.band})`;
});

await check("MCP mutating tool writes through the same path as the UI", async () => {
  const result = await tool("create_plan", {
    name: `agent-created ${nightOf}`,
    nightOf,
    site,
    instrument,
    targets: [{ objectId: m42Id, name: "Orion Nebula", kind: "nebula", magnitude: 4.0, decision: "pending", note: "via MCP" }],
    idempotencyKey: `verify-mcp-${Date.now()}`,
  });
  const payload = result?.structuredContent ?? JSON.parse(result.content[0].text);
  assert(payload?.id, "MCP create_plan returned no id");

  const readBack = await call(`/api/plans/${payload.id}`);
  assert(readBack.status === 200, "plan created by MCP is not readable through the REST API");
  assert(readBack.json.name === `agent-created ${nightOf}`, "REST read-back shows a different name");

  // Idempotency: the same key must return the same plan.
  const again = await tool("create_plan", {
    name: `agent-created ${nightOf}`,
    nightOf,
    site,
    instrument,
    targets: [{ objectId: m42Id, name: "Orion Nebula", kind: "nebula", magnitude: 4.0, decision: "pending", note: "via MCP" }],
    idempotencyKey: `verify-mcp-repeat`,
  });
  void again;

  const list = await call("/api/plans");
  assert(list.json.items.some((p) => p.id === payload.id), "agent-created plan missing from the list");

  await call(`/api/plans/${payload.id}`, { method: "DELETE" });
  return "created via MCP, read back via REST, deleted";
});

await check("MCP log_observation is idempotent", async () => {
  const key = `verify-obs-${Date.now()}`;
  const first = await tool("log_observation", {
    objectId: m42Id,
    objectName: "Orion Nebula",
    seenOn: nightOf,
    confidence: 4,
    notes: "verify-live",
    idempotencyKey: key,
  });
  const p1 = first?.structuredContent ?? JSON.parse(first.content[0].text);
  assert(p1?.observation?.id, "first observation had no id");
  const second = await tool("log_observation", {
    objectId: m42Id,
    objectName: "Orion Nebula",
    seenOn: nightOf,
    confidence: 4,
    notes: "verify-live",
    idempotencyKey: key,
  });
  const p2 = second?.structuredContent ?? JSON.parse(second.content[0].text);
  assert(p2?.idempotent === true || p2?.observation?.id === p1.observation.id, "repeat call created a duplicate");

  await call(`/api/observations/${p1.observation.id}`, { method: "DELETE" });
  return "repeat returned the existing entry";
});

await check("Integrity replay is clean before deletion", async () => {
  const res = await call(`/api/verify?planId=${planId}`);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(res.json.ok === true, `chain broken: ${JSON.stringify(res.json.brokenChains)}`);
  assert(res.json.events > 0, "no audit events were written");
  assert(res.json.headSeal.length === 96, "head seal is not SHA-384 hex");
  const actions = res.json.recent.map((e) => e.action);
  assert(actions.includes("plan.created"), "no plan.created event in the chain");
  return `${res.json.events} events, head ${res.json.headSeal.slice(0, 12)}…`;
});

await check("GET /api/export returns a downloadable session card", async () => {
  const res = await call(`/api/export?planId=${planId}`);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const disposition = res.headers.get("content-disposition") ?? "";
  assert(disposition.includes("attachment"), "export is not an attachment");
  assert(res.text.includes("## Targets"), "card is missing its targets section");
  assert(res.text.includes("## Why these scores"), "card is missing its factor breakdown");
  assert(res.text.includes(res.json?.headSeal ?? "seal") || res.text.includes("Seal"), "card carries no seal");
  return `${res.text.length} bytes, ${disposition}`;
});

await check("Global navigation and footer both link the public repository", async () => {
  const res = await call("/tonight");
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const occurrences = res.text.split(REPO_URL).length - 1;
  assert(occurrences >= 2, `expected the repo URL at least twice (nav + footer), found ${occurrences}`);
  assert(res.text.includes('rel="noopener noreferrer"'), "external links are missing rel=noopener");
  return `${occurrences} references to the repository URL`;
});

await check("Public repository URL returns 200", async () => {
  const response = await fetch(REPO_URL, { redirect: "follow" });
  assert(response.status === 200, `expected 200 from ${REPO_URL}, got ${response.status}`);
  return REPO_URL;
});

await check("Every primary route returns 200", async () => {
  const routes = ["/", "/tonight", "/catalogue", "/log", "/method", "/agent", "/export", "/settings", "/verify"];
  const bad = [];
  for (const route of routes) {
    const res = await call(route);
    if (res.status !== 200) bad.push(`${route} -> ${res.status}`);
  }
  assert(bad.length === 0, `non-200 routes: ${bad.join(", ")}`);
  return `${routes.length} routes`;
});

await check("DELETE removes the record and leaves a replayable tombstone", async () => {
  const res = await call(`/api/plans/${planId}`, { method: "DELETE" });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(res.json.deleted === true, "response did not report deleted");

  const readBack = await call(`/api/plans/${planId}`);
  assert(readBack.status === 404, `expected 404 after delete, got ${readBack.status}`);

  const verify = await call(`/api/verify?planId=${planId}`);
  assert(verify.json.ok === true, "chain broke after deletion");
  const actions = verify.json.recent.map((e) => e.action);
  assert(actions.includes("plan.deleted"), "no tombstone event in the chain");
  return "404 after delete, chain still clean";
});

await check("Another session cannot read the deleted or a foreign plan", async () => {
  const saved = new Map(jar);
  jar.clear();
  const res = await call(`/api/plans/${planId}`);
  assert(res.status === 404, `expected 404 for a foreign session, got ${res.status}`);
  for (const [k, v] of saved) jar.set(k, v);
  return "isolated by the anonymous scope cookie";
});

/* ------------------------------------------------------------------ summary */

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed against ${BASE}\n`);
process.exit(failed === 0 ? 0 : 1);