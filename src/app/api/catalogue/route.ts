import { getCatalogue } from "@/lib/feed";
import { withSession, ok } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The catalogue: live bright stars from the Bright Star Catalogue, plus the
 * bundled J2000 deep-sky sample.
 *
 * The response always reports `live` or `fallback` plus the sources and the time
 * of fetch, so a caller can tell a current catalogue from the sealed sample.
 */
export async function GET(request: Request) {
  const { attach } = await withSession();
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const kind = url.searchParams.get("kind");
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.trunc(limitRaw))) : 200;

  const catalogue = await getCatalogue();

  let objects = catalogue.objects;
  if (q) {
    objects = objects.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.designation ?? "").toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q) ||
        o.blurb.toLowerCase().includes(q),
    );
  }
  if (kind && kind !== "all") {
    objects = objects.filter((o) => o.kind === kind);
  }

  return attach(
    ok({
      status: catalogue.status,
      fetchedAt: catalogue.fetchedAt,
      sources: catalogue.sources,
      degradedReason: catalogue.degradedReason,
      total: catalogue.objects.length,
      count: objects.length,
      objects: objects.slice(0, limit),
    }),
  );
}