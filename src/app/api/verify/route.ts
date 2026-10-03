import { replayAllChains } from "@/lib/integrity";
import { withRepository } from "@/lib/service";
import { withSession, ok, readPaging } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Replay the append-only audit chain.
 *
 * Recomputes every SHA-384 seal from genesis and reports the first broken link,
 * which is the event an operator needs to look at. A clean replay after a delete
 * still works, because deletions are soft and leave a tombstone event behind.
 */
export async function GET(request: Request) {
  const { session, attach } = await withSession();
  const url = new URL(request.url);
  const planId = url.searchParams.get("planId");
  const { limit } = readPaging(url.toString());

  const result = await withRepository(async (repo) => {
    const events = await repo.listAudit(planId ?? undefined);
    const replay = replayAllChains(events);
    const owned = events.filter((e) => e.planId === planId || planId === null);

    return {
      ok: replay.ok,
      scope: planId ? { planId } : { ownerId: session.ownerId },
      chains: replay.chains,
      events: replay.events,
      headSeal: replay.headSeal,
      brokenChains: replay.brokenChains,
      algorithm: "seal_n = SHA-384(UTF-8(prevSeal) || canonicalJson(event_n))",
      genesisSeal: "0".repeat(96),
      recent: owned.slice(-limit).reverse(),
    };
  });

  return attach(ok(result));
}