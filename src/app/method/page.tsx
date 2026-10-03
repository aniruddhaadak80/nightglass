import { FACTOR_WEIGHTS, ENGINE_VERSION } from "@/lib/engine";
import { site } from "@/config/site";

export const dynamic = "force-static";

export const metadata = {
  title: "Method",
  description:
    "Exactly how the nightglass observability score is computed: the astronomy, the six weighted factors, their weights, and the integrity chain.",
};

const FACTORS = [
  {
    id: "horizon_clearance",
    what: "How long, and how high, the target stays above your local obstruction.",
    how: "The altitude curve is sampled every five minutes across the astronomical night. Each sample is lifted by atmospheric refraction, compared against the obstruction you entered, and the fraction of samples that clear it is combined with the peak altitude.",
  },
  {
    id: "sky_darkness",
    what: "Whether the sky is dark enough to see what you are pointing at.",
    how: "Sun altitude at mid-night, the naked-eye limiting magnitude implied by your Bortle class, and the Moon's illuminated fraction weighted by its angular separation from the target.",
  },
  {
    id: "instrument_reach",
    what: "Whether your aperture can actually show it.",
    how: "Limiting magnitude is 7.7 + 5·log₁₀(aperture in cm) under a class-6 sky, adjusted by the light-pollution penalty. Objects larger than three arcminutes are scored on surface brightness instead, weighted 0.7 against 0.3 for magnitude, because that is what actually limits visual detection of extended objects.",
  },
  {
    id: "transparency",
    what: "How clear and clean the air is.",
    how: "Live from Open-Meteo: total and low cloud across the dark window combined with horizontal visibility. A clear hour after three cloudy hours does not make a clear night, so the whole window is averaged.",
  },
  {
    id: "seeing_tolerance",
    what: "Whether the target survives unsteady air.",
    how: "Angular size sets how much seeing costs the target. Modelled as a floor plus a power law rather than a product, because a plain product would make a large target swing harder than a small one, which is backwards.",
  },
  {
    id: "culmination",
    what: "How high it can ever get from your latitude.",
    how: "The closed form 90° − |latitude − declination|. This is the theoretical maximum, independent of the night, so it is a genuinely separate signal from the sampled curve in the first factor.",
  },
];

export default function MethodPage() {
  const totalWeight = Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <header className="gutter">
        <p className="plate-caption">Method</p>
        <h1 className="font-display mt-1 text-4xl text-bone-100">How a score is produced</h1>
        <p className="mt-3 text-sm leading-relaxed text-bone-300">
          Engine <code className="text-brass-300">{ENGINE_VERSION}</code>. One pure function, shared
          by the browser UI, the REST routes and the MCP tools. Same inputs, same numbers, forever.
        </p>
      </header>

      <section className="mt-8" aria-labelledby="astronomy">
        <h2 id="astronomy" className="plate-caption">
          The astronomy first
        </h2>
        <div className="plate mt-3 space-y-3 p-4 text-sm leading-relaxed text-bone-300">
          <p>
            Everything positional is computed from J2000 coordinates with real ephemerides. Sidereal
            time uses the standard GMST series; the Sun uses the NOAA low-precision solar algorithm,
            accurate to about 0.01°; the Moon uses the truncated ELP series from Meeus chapter 47,
            accurate to roughly 0.3° in longitude. Atmospheric refraction follows Bennett&rsquo;s
            formula.
          </p>
          <p>
            The astronomical night is the longest run during which the Sun sits at or below −18°. The
            scan is coarse, then both edges are bisected onto the exact crossing, so the reported
            start and end of night are real twilight times rather than five-minute samples.
          </p>
          <p className="text-bone-400">
            The tests assert properties rather than stored strings: that Polaris sits at your
            latitude to within its real 0.74° offset from the pole, that a full synodic month
            contains both a new and a full moon, and that the lunar elongation and the illuminated
            fraction agree with each other across a whole cycle.
          </p>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="weights">
        <h2 id="weights" className="plate-caption">
          Six factors, weights summing to {totalWeight.toFixed(2)}
        </h2>
        <ol className="mt-3 space-y-3">
          {FACTORS.map((f) => (
            <li key={f.id} className="plate plate-ticked p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-xl text-bone-100">{f.id.replace(/_/g, " ")}</h3>
                <span className="mono-label">weight {(FACTOR_WEIGHTS[f.id as keyof typeof FACTOR_WEIGHTS] * 100).toFixed(0)}%</span>
              </div>
              <p className="mt-2 text-sm text-brass-300">{f.what}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-bone-300">{f.how}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10" aria-labelledby="bands">
        <h2 id="bands" className="plate-caption">
          Bands and the horizon gate
        </h2>
        <div className="plate mt-3 p-4 text-sm leading-relaxed text-bone-300">
          <p>
            Score ≥ 78 prime, ≥ 60 good, ≥ 40 fair, ≥ 20 poor, below that blocked.
          </p>
          <p className="mt-3">
            One hard gate overrides all of it: if a target never rises above your stated obstruction,
            the score is clamped into the blocked band and flagged{" "}
            <code className="text-brass-300">gated</code>. Without that, a beautifully clear night
            would still score a treeless target &ldquo;fair&rdquo; on the strength of transparency
            alone, which is the wrong answer for someone standing under a tree.
          </p>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="integrity">
        <h2 id="integrity" className="plate-caption">
          Integrity
        </h2>
        <div className="plate mt-3 p-4 text-sm leading-relaxed text-bone-300">
          <p>
            Every create, update, decision, ranking, export and delete appends an audit event sealed
            with{" "}
            <code className="text-brass-300">
              seal_n = SHA-384(UTF-8(prevSeal) || canonicalJson(event_n))
            </code>
            , chained per entity from a genesis value of 96 zeros. Canonical JSON sorts object keys
            recursively so the byte representation does not depend on property insertion order.
          </p>
          <p className="mt-3">
            Deletions are soft. A tombstone event is appended and the row is flagged, so the chain
            still replays cleanly after a delete. The{" "}
            <a href="/verify" className="text-brass-300 underline underline-offset-2">
              verify route
            </a>{" "}
            reports the first broken link if one exists.
          </p>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="limits">
        <h2 id="limits" className="plate-caption">
          What this does not do
        </h2>
        <div className="plate mt-3 p-4 text-sm leading-relaxed text-bone-300">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              It does not model local light pollution beyond the Bortle class you enter. Bortle is a
              coarse instrument and yours is the honest input.
            </li>
            <li>
              Seeing is <em>estimated</em> from wind speed and low cloud, not measured. Turbulence at
              your specific site is the single biggest source of error in the transparency factors.
            </li>
            <li>
              It does not know your horizon. It only knows the single obstruction angle you give it,
              which is why that control is the most important one on the page.
            </li>
            <li>
              It is a planning aid. Computed altitudes are not a substitute for looking up, and
              nothing here should be used to aim equipment without checking the sky.
            </li>
          </ul>
        </div>
      </section>

      <p className="mt-8 text-xs text-bone-400">
        Engine version {site.engineVersion} ·{" "}
        <a
          href={`${site.repo.url}/blob/main/src/lib/engine.ts`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brass-300 underline underline-offset-2"
        >
          read the source
        </a>
      </p>
    </div>
  );
}