import { SiteSettings } from "@/components/site-settings";
import { DEFAULT_INSTRUMENT, DEFAULT_SITE } from "@/app/api/briefing/route";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Settings",
  description: "Set your observing site, horizon obstruction and instrument. The ranking re-cuts immediately.",
};

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header className="gutter">
        <p className="plate-caption">Settings</p>
        <h1 className="font-display mt-1 text-4xl text-bone-100">Your sky, your glass</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-bone-300">
          These two profiles drive every score. Nothing is sent anywhere except to this
          application&rsquo;s own API, and they are stored only in this browser so the app has no
          accounts and no tracking.
        </p>
      </header>

      <SiteSettings defaultSite={DEFAULT_SITE} defaultInstrument={DEFAULT_INSTRUMENT} />
    </div>
  );
}