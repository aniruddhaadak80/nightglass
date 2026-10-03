import { getPlan, isApiError, listObservations, listPlans } from "@/lib/service";
import { resolveSession } from "@/lib/session";
import { ObservationLog } from "@/components/observation-log";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Observing log",
  description:
    "Record what you actually saw, with a confidence rating, against any of your saved plans. Every entry is sealed into the audit chain.",
};

export default async function LogPage() {
  const session = await resolveSession();
  const observations = await listObservations(session.ownerId, 100, 0);
  const plans = await listPlans(session.ownerId, 50, 0);

  const items = isApiError(observations) ? [] : observations.items;
  const planItems = isApiError(plans) ? [] : plans.items;

  // Offer the plan targets as suggestions so logging does not require typing
  // object ids by hand.
  const suggestions: Array<{ objectId: string; name: string; planId: string }> = [];
  for (const plan of planItems.slice(0, 8)) {
    const full = await getPlan(session.ownerId, plan.id);
    if (isApiError(full)) continue;
    for (const t of full.targets) {
      suggestions.push({ objectId: t.objectId, name: t.name, planId: full.id });
      if (suggestions.length >= 40) break;
    }
    if (suggestions.length >= 40) break;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <header>
        <p className="plate-caption">Log</p>
        <h1 className="font-display mt-1 text-4xl text-bone-100">What you actually saw</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-bone-300">
          A plan says what should be visible. The log says what was. Entries carry a confidence rating
          and are sealed into the same append-only chain as the plan itself.
        </p>
      </header>

      <ObservationLog initial={items} suggestions={suggestions} />

      {planItems.length === 0 ? (
        <p className="plate mt-6 p-4 text-sm text-bone-400">
          You have no saved plans yet, so there is nothing to attach an observation to.{" "}
          <a href="/tonight" className="text-brass-300 underline underline-offset-2">
            Save a plan first
          </a>
          .
        </p>
      ) : null}
    </div>
  );
}