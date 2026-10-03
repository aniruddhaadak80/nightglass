import Link from "next/link";
import { ArrowRight, Moon, Telescope } from "lucide-react";
import { buildBriefing } from "@/lib/service";
import { DEFAULT_INSTRUMENT, DEFAULT_SITE, todayFor } from "./api/briefing/route";
import { site } from "@/config/site";
import { GitHubMark } from "@/components/github-mark";

export const dynamic = "force-dynamic";

function clock(iso: string | null, timeZone: string): string {
  if (!iso) return "--";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timeZone === "auto" ? "UTC" : timeZone,
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(11, 16);
  }
}

export default async function HomePage() {
  const nightOf = todayFor(DEFAULT_SITE.longitudeDeg);
  // A real computation on first paint: the page's headline verdict is the
  // engine's output for a real site, not a placeholder.
  const briefing = await buildBriefing(DEFAULT_SITE, DEFAULT_INSTRUMENT, nightOf, 6);
  const top = briefing.ranked.slice(0, 3);
  const live = briefing.conditions.status === "live";

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="gutter">
        <p className="plate-caption">
          {site.name} · engine {briefing.ranked[0]?.engineVersion ?? site.engineVersion}
        </p>
        <h1 className="font-display mt-3 max-w-3xl text-4xl leading-[1.1] text-bone-100 sm:text-6xl">
          Know what is worth observing tonight, and why.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-bone-300">
          Most observing plans fail on arithmetic nobody did: the target never clears the trees, or the
          Moon is full behind it, or it is simply too faint for the aperture you own. nightglass does
          that arithmetic in the open, from real ephemerides and a real forecast, and shows every
          measurement behind every score.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/tonight"
            className="btn btn-primary"
            data-testid="landing-cta"
          >
            <Telescope size={14} aria-hidden="true" />
            Plan tonight
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
          <Link href="/method" className="btn">
            How the score works
          </Link>
          <a
            href={site.repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn"
          >
            <GitHubMark size={14} />
            View source
          </a>
        </div>
      </section>

      {/* Tonight's real verdict, computed server-side. */}
      <section className="mt-14" aria-labelledby="tonight-preview">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="tonight-preview" className="font-display text-2xl text-bone-100">
            Tonight, from a default site
          </h2>
          <p className="mono-label">
            {nightOf} · {clock(briefing.darkWindowStart, "UTC")}–{clock(briefing.darkWindowEnd, "UTC")} UTC
          </p>
        </div>

        <div className="plate plate-ticked mt-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Dark window"
              value={`${Math.round((Date.parse(briefing.darkWindowEnd) - Date.parse(briefing.darkWindowStart)) / 3600000)} h`}
              detail={`Sun ${briefing.sunMidnightAltitudeDeg.toFixed(0)}° at mid-night`}
            />
            <Stat
              label="Cloud"
              value={`${Math.round(briefing.conditions.cloudCoverPct)}%`}
              detail={`${Math.round(briefing.conditions.cloudLowPct)}% low`}
            />
            <Stat
              label="Moon"
              value={`${Math.round(briefing.moonIllumination * 100)}%`}
              detail={`${briefing.moonAltitudeAtMidnightDeg.toFixed(0)}° altitude at mid-night`}
            />
            <Stat
              label="Conditions"
              value={live ? "Live" : "Sample"}
              detail={live ? "Open-Meteo" : "Offline sample"}
              tone={live ? "live" : "fallback"}
            />
          </div>

          {!live && briefing.conditions.degradedReason ? (
            <p className="signal-fallback mt-4 text-xs leading-relaxed">{briefing.conditions.degradedReason}</p>
          ) : null}
        </div>

        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {top.map((score, i) => (
            <li key={score.seal} className="plate p-4">
              <p className="plate-caption">
                {String(i + 1).padStart(2, "0")} · {score.objectKind}
              </p>
              <p className="font-display mt-1 text-xl text-bone-100">{score.objectName}</p>
              <p className="mt-2 text-3xl tabular-nums text-brass-300">{score.score.toFixed(0)}</p>
              <p className="plate-caption mt-1">{score.band}</p>
              <p className="mt-3 text-xs leading-relaxed text-bone-300">{score.recommendation}</p>
            </li>
          ))}
        </ol>

        <p className="mt-4 text-xs text-bone-400">
          Scores above are computed for a default site so the first paint is a real verdict.{" "}
          <Link href="/settings" className="text-brass-300 underline underline-offset-2">
            Set your own site
          </Link>{" "}
          and the ranking re-cuts immediately.
        </p>
      </section>

      <section className="mt-16 grid gap-4 md:grid-cols-3">
        <Feature
          title="Real horizon, not an assumption"
          body="You tell nightglass how high your trees or roof are. The altitude curve is integrated across the real astronomical night and anything below that obstruction is hatched out, not quietly ignored."
        />
        <Feature
          title="Surface brightness, not just magnitude"
          body="An extended object at magnitude 9 spread over three degrees is a different night out from a compact magnitude 9 knot. The reach factor splits its weighting on angular size for exactly that reason."
        />
        <Feature
          title="Sealed and replayable"
          body="Every score and every mutation is sealed into a SHA-384 chain. You can replay it and find the first broken link, and the session card you export carries the seal."
        />
      </section>

      <section className="plate mt-16 flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl text-bone-100">Runs in the browser and on your desktop</h2>
          <p className="mt-2 max-w-xl text-sm text-bone-300">
            nightglass ships as a desktop app for macOS, Windows and Linux. Same engine, same API,
            tray notifications when a target reaches its best altitude.
          </p>
        </div>
        <Link href="/agent" className="btn shrink-0">
          <Moon size={14} aria-hidden="true" />
          Agent endpoint
        </Link>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  tone = "plain",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "plain" | "live" | "fallback";
}) {
  return (
    <div className="plate-inset p-3">
      <p className="plate-caption">{label}</p>
      <p
        className={`mt-1 text-2xl tabular-nums ${
          tone === "live" ? "signal-live" : tone === "fallback" ? "signal-fallback" : "text-bone-100"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-[0.7rem] leading-snug text-bone-400">{detail}</p>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="plate p-5">
      <h3 className="font-display text-xl text-bone-100">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-bone-300">{body}</p>
    </div>
  );
}