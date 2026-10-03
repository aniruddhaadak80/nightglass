import Link from "next/link";
import { getCatalogue } from "@/lib/feed";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Catalogue",
  description:
    "The real star and deep-sky catalogue nightglass ranks: live bright stars from the CDS Bright Star Catalogue plus a curated J2000 deep-sky sample.",
};

export default async function CataloguePage() {
  const catalogue = await getCatalogue();
  const live = catalogue.status === "live";

  const stars = catalogue.objects.filter((o) => o.kind === "star").slice(0, 40);
  const deep = catalogue.objects.filter((o) => o.kind !== "star");

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header>
        <p className="plate-caption">Catalogue</p>
        <h1 className="font-display mt-1 text-4xl text-bone-100">What nightglass can point at</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-bone-300">
          {catalogue.objects.length} objects. Bright-star positions are fetched live from the CDS Bright
          Star Catalogue (VizieR V/50) in J2000. Deep-sky positions ship as a curated J2000 sample,
          reviewed by hand.
        </p>
      </header>

      <section className="plate mt-6 p-4" aria-label="Provenance">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`plate-caption ${live ? "signal-live" : "signal-fallback"}`}>
            {live ? "Live" : "Fallback"}
          </span>
          <span className="mono-label">fetched {catalogue.fetchedAt}</span>
        </div>
        <ul className="mt-3 space-y-1.5">
          {catalogue.sources.map((s) => (
            <li key={s.id} className="text-xs text-bone-300">
              <span className="text-brass-300">{s.label}</span>{" "}
              <a
                href={s.attribution}
                target="_blank"
                rel="noopener noreferrer"
                className="text-bone-400 underline underline-offset-2"
              >
                {s.attribution}
              </a>
            </li>
          ))}
        </ul>
        {catalogue.degradedReason ? (
          <p className="signal-fallback mt-3 text-xs leading-relaxed">{catalogue.degradedReason}</p>
        ) : null}
      </section>

      <section className="mt-8" aria-labelledby="deep-sky">
        <h2 id="deep-sky" className="plate-caption">
          Deep sky ({deep.length})
        </h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {deep.map((o) => (
            <li key={o.id} className="plate p-3">
              <p className="flex items-baseline justify-between gap-2">
                <span className="font-display text-lg text-bone-100">{o.name}</span>
                <span className="mono-label shrink-0">{o.kind}</span>
              </p>
              <p className="mono-label mt-0.5">
                {o.designation ?? o.id} · mag {o.magnitude.toFixed(1)}
                {o.angularSizeArcmin ? ` · ${o.angularSizeArcmin}′` : ""}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-bone-300">{o.blurb}</p>
              <p className="mt-1.5 text-[0.65rem] uppercase tracking-[0.1em] text-bone-400">
                J2000 {o.raDeg.toFixed(3)}° {o.decDeg >= 0 ? "+" : ""}
                {o.decDeg.toFixed(3)}°
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10" aria-labelledby="stars">
        <h2 id="stars" className="plate-caption">
          Bright stars (first {stars.length})
        </h2>
        <div className="plate mt-3 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-xs">
            <caption className="sr-only">Bright stars with J2000 coordinates and magnitude</caption>
            <thead>
              <tr className="border-b border-brass-500/25">
                <th scope="col" className="px-3 py-2 font-medium text-brass-300">Name</th>
                <th scope="col" className="px-3 py-2 font-medium text-brass-300">Designation</th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-brass-300">Mag</th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-brass-300">RA</th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-brass-300">Dec</th>
                <th scope="col" className="px-3 py-2 font-medium text-brass-300">Source</th>
              </tr>
            </thead>
            <tbody>
              {stars.map((o) => (
                <tr key={o.id} className="border-b border-brass-500/10">
                  <td className="px-3 py-1.5 text-bone-100">{o.name}</td>
                  <td className="px-3 py-1.5 text-bone-400">{o.designation ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-bone-200">
                    {o.magnitude.toFixed(2)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-bone-400">{o.raDeg.toFixed(4)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-bone-400">
                    {o.decDeg.toFixed(4)}
                  </td>
                  <td className="px-3 py-1.5 text-[0.65rem] text-bone-400">{o.catalog}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-8 text-sm text-bone-400">
        Ready to plan?{" "}
        <Link href="/tonight" className="text-brass-300 underline underline-offset-2">
          Rank tonight&rsquo;s targets
        </Link>
        .
      </p>
    </div>
  );
}