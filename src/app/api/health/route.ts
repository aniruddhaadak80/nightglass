import { getRepository } from "@/lib/repository";
import { getCatalogue } from "@/lib/feed";
import { resolveDatabaseUrl } from "@/lib/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Health check.
 *
 * This verifies the *real* persistence path rather than returning a static
 * success object: it runs `SELECT 1` through the same adapter the application
 * uses and reports which adapter answered. A deploy wired to the wrong database
 * shows up here instead of as mysteriously empty lists in the UI.
 */
export async function GET() {
  const startedAt = Date.now();
  let store: {
    ok: boolean;
    adapter: string;
    detail: string;
    latencyMs: number;
    productionStore: boolean;
  };
  let feed: { ok: boolean; catalogueStatus: string; objects: number; latencyMs: number; sources: string[] };

  try {
    const repo = await getRepository();
    const t0 = Date.now();
    const health = await repo.health();
    store = {
      ok: health.ok,
      adapter: repo.kind,
      detail: health.detail,
      latencyMs: Date.now() - t0,
      productionStore: repo.kind === "neon-postgres",
    };
  } catch (error) {
    store = {
      ok: false,
      adapter: "unavailable",
      detail: error instanceof Error ? error.message : "repository could not be constructed",
      latencyMs: 0,
      productionStore: false,
    };
  }

  try {
    const t1 = Date.now();
    const catalogue = await getCatalogue();
    feed = {
      ok: catalogue.objects.length > 0,
      catalogueStatus: catalogue.status,
      objects: catalogue.objects.length,
      latencyMs: Date.now() - t1,
      sources: catalogue.sources.map((s) => s.label),
    };
  } catch (error) {
    feed = {
      ok: false,
      catalogueStatus: "error",
      objects: 0,
      latencyMs: 0,
      sources: [error instanceof Error ? error.message : "catalogue failed"],
    };
  }

  const ok = store.ok && feed.ok;
  return Response.json(
    {
      ok,
      service: "nightglass",
      checkedAt: new Date().toISOString(),
      totalMs: Date.now() - startedAt,
      store,
      feed,
      environment: {
        nodeEnv: process.env.NODE_ENV ?? "development",
        databaseConfigured: Boolean(resolveDatabaseUrl()),
      },
    },
    { status: ok ? 200 : 503 },
  );
}