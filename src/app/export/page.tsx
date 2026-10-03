import Link from "next/link";
import { getPlan, isApiError, listPlans } from "@/lib/service";
import { resolveSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Export",
  description:
    "Export a printable session card for a saved plan: ranked targets, every factor's evidence, provenance and the audit seal.",
};

export default async function ExportPage({
  searchParams,
}: {
  searchParams: Promise<{ planId?: string }>;
}) {
  const { planId } = await searchParams;
  const session = await resolveSession();
  const plans = await listPlans(session.ownerId, 50, 0);
  const items = isApiError(plans) ? [] : plans.items;

  const selected = planId && !isApiError(plans) ? await getPlan(session.ownerId, planId) : null;
  const plan = selected && !isApiError(selected) ? selected : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <header className="gutter">
        <p className="plate-caption">Export</p>
        <h1 className="font-display mt-1 text-4xl text-bone-100">Take the plan with you</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-bone-300">
          A Markdown session card with the ranked targets, the measured quantity behind every factor,
          the provenance of the live data, and the plan&rsquo;s audit seal. It renders as plain text,
          so it works on a phone in the dark.
        </p>
      </header>

      {items.length === 0 ? (
        <p className="plate mt-8 p-5 text-sm text-bone-400">
          No saved plans to export.{" "}
          <Link href="/tonight" className="text-brass-300 underline underline-offset-2">
            Save one from tonight&rsquo;s ranking
          </Link>
          .
        </p>
      ) : (
        <>
          <ul className="mt-8 space-y-2" data-testid="export-plans">
            {items.map((p) => (
              <li key={p.id} className="plate p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-xl text-bone-100">{p.name}</p>
                    <p className="mono-label mt-0.5">
                      {p.nightOf} · {p.targets.length} targets · {p.site.name}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`/api/export?planId=${encodeURIComponent(p.id)}`}
                      className="btn btn-primary"
                      data-testid={`download-${p.id}`}
                    >
                      Download card
                    </a>
                    <a
                      href={`/api/export?planId=${encodeURIComponent(p.id)}&format=json`}
                      className="btn"
                    >
                      JSON
                    </a>
                    <Link href={`/plans/${p.id}`} className="btn">
                      Open plan
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {plan ? (
            <section className="mt-10" aria-labelledby="preview">
              <h2 id="preview" className="plate-caption">
                What the card contains
              </h2>
              <div className="plate mt-3 space-y-2 p-4 text-sm text-bone-300">
                <p>
                  <span className="text-brass-300">Targets</span> — every target with its score, band,
                  observing window in your own timezone, and your decision.
                </p>
                <p>
                  <span className="text-brass-300">Why these scores</span> — for each target, the six
                  factors with their values, weights, point contributions and the measured quantity
                  behind each one.
                </p>
                <p>
                  <span className="text-brass-300">Provenance</span> — the chain replay result, the
                  head seal, and which sources supplied the data.
                </p>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}