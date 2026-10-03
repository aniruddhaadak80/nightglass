import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlan, isApiError, rankPlan, listObservations } from "@/lib/service";
import { resolveSession } from "@/lib/session";
import { ScorePlate } from "@/components/score-plate";
import { DecisionButtons } from "@/components/decision-buttons";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Observation plan",
  description: "A saved observation plan: ranked targets, per-target evidence, decisions and the audit seal.",
};

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

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await resolveSession();
  const plan = await getPlan(session.ownerId, id);

  // A plan belonging to another session must look identical to one that does
  // not exist, so this cannot be used to probe for other people's ids.
  if (isApiError(plan) || !plan) notFound();

// Scores are persisted at rank time, so rank before first render. `rankPlan`
  // returns the updated plan plus the seal; a failure falls back to the plan as
  // stored, which then shows its targets as not yet scored.
  const alreadyScored = plan.targets.every((t) => t.score);
  const ranked = alreadyScored ? null : await rankPlan(session.ownerId, id);
  const shown = ranked && !isApiError(ranked) ? ranked.plan : plan;

  const observations = await listObservations(session.ownerId, 100, 0);
  const forPlan = isApiError(observations)
    ? []
    : observations.items.filter((o) => o.planId === shown.id);

  const ordered = [...shown.targets].sort((a, b) => (b.score?.score ?? -1) - (a.score?.score ?? -1));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <nav aria-label="Breadcrumb" className="mono-label">
        <Link href="/tonight" className="text-brass-300 underline underline-offset-2">
          Tonight
        </Link>{" "}
        / plan
      </nav>

      <header className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="plate-caption">{shown.nightOf}</p>
          <h1 className="font-display mt-1 text-4xl text-bone-100" data-testid="plan-name">
            {shown.name}
          </h1>
          <p className="mt-2 text-sm text-bone-300">
            {shown.site.name} · {shown.site.latitudeDeg.toFixed(3)}°, {shown.site.longitudeDeg.toFixed(3)}°
            · Bortle {shown.site.bortle} · obstruction {shown.site.horizonDeg}° · {shown.instrument.apertureMm} mm{" "}
            {shown.instrument.type}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href={`/export?planId=${shown.id}`} className="btn">
            Export session card
          </Link>
          <Link href={`/verify?planId=${shown.id}`} className="btn">
            Verify chain
          </Link>
        </div>
      </header>

      <div className="plate mt-6 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-bone-300">
            {ordered.length} target{ordered.length === 1 ? "" : "s"} ·{" "}
            {forPlan.length} logged observation{forPlan.length === 1 ? "" : "s"}
          </p>
          <p className="mono-label">id {shown.id.slice(0, 8)}</p>
        </div>
      </div>

      {ordered.length === 0 ? (
        <p className="plate mt-6 p-6 text-sm text-bone-400">
          This plan has no targets yet.{" "}
          <Link href="/tonight" className="text-brass-300 underline underline-offset-2">
            Pick some from tonight&rsquo;s ranking
          </Link>
          .
        </p>
      ) : (
        <div className="mt-6 space-y-4" data-testid="plan-targets">
          {ordered.map((target) => (
            <section key={target.objectId} className="plate plate-ticked p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl text-bone-100">{target.name}</h2>
                  <p className="mono-label mt-0.5">
                    {target.kind} · mag {target.magnitude.toFixed(1)} ·{" "}
                    <span className="text-bone-300">{target.objectId}</span>
                  </p>
                </div>
                <DecisionButtons
                  planId={shown.id}
                  objectId={target.objectId}
                  current={target.decision}
                />
              </div>
              {target.score ? (
                <div className="mt-4">
                  <ScorePlate
                    score={target.score}
                    name={target.score.objectName}
                    horizonDeg={shown.site.horizonDeg}
                  />
                </div>
              ) : (
                <p className="mt-3 text-sm text-bone-400">Not scored yet. Run the engine on this plan.</p>
              )}
            </section>
          ))}
        </div>
      )}

      <section className="mt-10" aria-labelledby="log">
        <h2 id="log" className="plate-caption">
          Logged against this plan
        </h2>
        {forPlan.length === 0 ? (
          <p className="plate mt-3 p-4 text-sm text-bone-400">
            Nothing logged yet.{" "}
            <Link href="/log" className="text-brass-300 underline underline-offset-2">
              Record what you actually saw
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {forPlan.map((o) => (
              <li key={o.id} className="plate p-3 text-sm">
                <span className="text-bone-100">{o.objectName}</span>{" "}
                <span className="text-bone-400">
                  on {o.seenOn}, confidence {o.confidence}/5
                  {o.notes ? ` — ${o.notes}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 text-xs text-bone-400">
        Updated {clock(shown.updatedAt, shown.site.timezone)} · engine{" "}
        {ordered.find((t) => t.score)?.score?.engineVersion ?? "not yet scored"}
      </p>
    </div>
  );
}
