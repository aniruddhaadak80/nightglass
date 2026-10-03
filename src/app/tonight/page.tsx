import { buildBriefing } from "@/lib/service";
import { DEFAULT_INSTRUMENT, DEFAULT_SITE, todayFor } from "@/app/api/briefing/route";
import { TonightWorkspace } from "@/components/tonight-workspace";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tonight",
  description:
    "Rank tonight's real catalogue against your site, your instrument and live cloud cover, with every measurement behind every score.",
};

export default async function TonightPage() {
  const nightOf = todayFor(DEFAULT_SITE.longitudeDeg);
  const briefing = await buildBriefing(DEFAULT_SITE, DEFAULT_INSTRUMENT, nightOf, 60);

  return (
    <TonightWorkspace
      initialSite={briefing.site}
      initialInstrument={briefing.instrument}
      initialNightOf={nightOf}
      initialBriefing={briefing}
    />
  );
}