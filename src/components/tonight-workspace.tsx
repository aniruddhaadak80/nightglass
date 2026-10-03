"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Loader2, Save, RefreshCw } from "lucide-react";
import type { InstrumentProfile, NightBriefing, SiteProfile } from "@/lib/types";
import { ScorePlate } from "@/components/score-plate";
import { SETTINGS_INSTRUMENT_KEY, SETTINGS_SITE_KEY, useLocalSetting } from "@/lib/use-local-setting";

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

/**
 * The workspace.
 *
 * Changing the horizon obstruction re-requests the briefing, and the server
 * re-runs the engine over the whole catalogue. The ranking you see is the
 * engine's ranking, not a client-side approximation of it.
 */
export function TonightWorkspace({
  initialSite,
  initialInstrument,
  initialNightOf,
  initialBriefing,
}: {
  initialSite: SiteProfile;
  initialInstrument: InstrumentProfile;
  initialNightOf: string;
  initialBriefing: NightBriefing;
}) {
  // Site and instrument come from the Settings page via local storage, so a change
  // there re-ranks this page without a reload.
  const [storedSite, setStoredSite] = useLocalSetting<SiteProfile>(SETTINGS_SITE_KEY, initialSite);
  const [instrument] = useLocalSetting<InstrumentProfile>(SETTINGS_INSTRUMENT_KEY, initialInstrument);
  const site = storedSite;
  const setSite = setStoredSite;
  const [nightOf, setNightOf] = useState(initialNightOf);
  const [briefing, setBriefing] = useState<NightBriefing>(initialBriefing);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(
    async (next: { site?: SiteProfile; nightOf?: string }) => {
      const s = next.site ?? site;
      const n = next.nightOf ?? nightOf;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          lat: String(s.latitudeDeg),
          lon: String(s.longitudeDeg),
          bortle: String(s.bortle),
          horizon: String(s.horizonDeg),
          siteName: s.name,
          timezone: s.timezone,
          instrumentName: instrument.name,
          aperture: String(instrument.apertureMm),
          magnification: String(instrument.magnification),
          type: instrument.type,
          nightOf: n,
        });
        const response = await fetch(`/api/briefing?${params.toString()}`);
        const body = (await response.json()) as NightBriefing & { error?: { message: string } };
        if (!response.ok || body.error) {
          throw new Error(body.error?.message ?? `Request failed with status ${response.status}`);
        }
        setBriefing(body);
        setSavedId(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load tonight's briefing.");
      } finally {
        setLoading(false);
      }
    },
    [site, nightOf, instrument],
  );

  const ranked = briefing.ranked;
  const visible = useMemo(() => ranked.slice(0, 24), [ranked]);
  const active = useMemo(
    () => visible.find((s) => s.objectId === selected) ?? visible[0] ?? null,
    [visible, selected],
  );

  async function savePlan() {
    setSaving(true);
    setError(null);
    try {
      const targets = ranked.slice(0, 12).map((s) => ({
        objectId: s.objectId,
        name: s.objectName,
        kind: s.objectKind,
        magnitude: 0,
        decision: "pending" as const,
        note: "",
      }));
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `Tonight · ${nightOf}`,
          nightOf,
          site,
          instrument,
          targets,
        }),
      });
      const body = (await response.json()) as { id?: string; error?: { message: string } };
      if (!response.ok || !body.id) {
        throw new Error(body.error?.message ?? `Save failed with status ${response.status}`);
      }
      setSavedId(body.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this plan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="plate-caption">Workspace</p>
          <h1 className="font-display mt-1 text-4xl text-bone-100">Tonight</h1>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="plate-caption">Night of</span>
            <input
              type="date"
              value={nightOf}
              onChange={(e) => {
                const next = e.target.value;
                setNightOf(next);
                void load({ nightOf: next });
              }}
              className="field mt-1 w-40"
              data-testid="night-input"
            />
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => void load({})}
            disabled={loading}
            data-testid="refresh"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw size={14} aria-hidden="true" />
            )}
            Recompute
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void savePlan()}
            disabled={saving || loading}
            data-testid="save-plan"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <Save size={14} aria-hidden="true" />
            )}
            Save plan
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="signal-fallback plate mt-4 p-3 text-sm">
          {error}
        </p>
      ) : null}

      {savedId ? (
        <p className="plate mt-4 border-brass-500/50 p-3 text-sm text-brass-300">
          Plan saved.{" "}
          <Link href={`/plans/${savedId}`} className="underline underline-offset-2" data-testid="saved-plan-link">
            Open it and rank it
          </Link>{" "}
          to persist scores and set decisions.
        </p>
      ) : null}

      {/* The obstruction slider is the control that re-cuts the sky. */}
      <section className="plate mt-6 p-4" aria-labelledby="obstruction">
        <h2 id="obstruction" className="plate-caption">
          Your obstruction
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex-1">
            <span className="sr-only">Horizon obstruction in degrees</span>
            <input
              type="range"
              min={0}
              max={45}
              step={1}
              value={site.horizonDeg}
              onChange={(e) => setSite({ ...site, horizonDeg: Number(e.target.value) })}
              onMouseUp={() => void load({})}
              onTouchEnd={() => void load({})}
              onKeyUp={() => void load({})}
              className="w-full"
              style={{ accentColor: "var(--color-brass-400)" }}
              data-testid="horizon-slider"
              aria-valuetext={`${site.horizonDeg} degrees`}
            />
          </label>
          <output className="w-20 text-right text-lg tabular-nums text-brass-300" data-testid="horizon-value">
            {site.horizonDeg}°
          </output>
        </div>
        <p className="mt-2 text-xs text-bone-400">
          {site.name} · {site.latitudeDeg.toFixed(3)}°, {site.longitudeDeg.toFixed(3)}° · Bortle{" "}
          {site.bortle} ·{" "}
          <Link href="/settings" className="text-brass-300 underline underline-offset-2">
            change site
          </Link>
        </p>
      </section>

      <section className="plate mt-4 p-4" aria-label="Night summary">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Summary label="Dark window" value={`${clock(briefing.darkWindowStart, site.timezone)}–${clock(briefing.darkWindowEnd, site.timezone)}`} />
          <Summary
            label="Cloud"
            value={`${Math.round(briefing.conditions.cloudCoverPct)}%`}
            detail={`low ${Math.round(briefing.conditions.cloudLowPct)}% · vis ${(briefing.conditions.visibilityMeters / 1000).toFixed(0)} km`}
          />
          <Summary
            label="Moon"
            value={`${Math.round(briefing.moonIllumination * 100)}%`}
            detail={`alt ${briefing.moonAltitudeAtMidnightDeg.toFixed(0)}°`}
          />
          <Summary
            label="Feed"
            value={briefing.conditions.status === "live" ? "Live" : "Sample"}
            detail={briefing.conditions.source.label}
            tone={briefing.conditions.status === "live" ? "live" : "fallback"}
          />
        </div>
        {briefing.conditions.status === "fallback" && briefing.conditions.degradedReason ? (
          <p className="signal-fallback mt-3 text-xs leading-relaxed">{briefing.conditions.degradedReason}</p>
        ) : null}
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.35fr]">
        <section aria-labelledby="ranking">
          <h2 id="ranking" className="plate-caption">
            Ranked targets
          </h2>
          {loading && visible.length === 0 ? (
            <p className="plate mt-3 p-4 text-sm text-bone-400">Computing the ranking…</p>
          ) : visible.length === 0 ? (
            <p className="plate mt-3 p-4 text-sm text-bone-400">
              Nothing is observable from this site tonight. Lower the obstruction or pick another date.
            </p>
          ) : (
            <ol className="mt-3 space-y-1.5" data-testid="ranking-list">
              {visible.map((s, i) => (
                <li key={s.objectId}>
                  <button
                    type="button"
                    onClick={() => setSelected(s.objectId)}
                    aria-pressed={active?.objectId === s.objectId}
                    className={`plate flex w-full items-center gap-3 p-2.5 text-left transition-colors hover:border-brass-400 ${
                      active?.objectId === s.objectId ? "border-brass-400 bg-brass-500/10" : ""
                    }`}
                  >
                    <span className="mono-label w-6 shrink-0 tabular-nums">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-bone-100">{s.objectName}</span>
                      <span className="block truncate text-[0.65rem] uppercase tracking-[0.1em] text-bone-400">
                        {s.objectKind}
                        {s.gated ? " · below horizon" : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-lg tabular-nums text-brass-300">{s.score.toFixed(0)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="detail" aria-live="polite">
          <h2 id="detail" className="plate-caption">
            Why this score
          </h2>
          <div className="mt-3" data-testid="score-detail">
            {active ? (
              <ScorePlate
                key={active.objectId}
                score={active}
                name={active.objectName}
                horizonDeg={site.horizonDeg}
              />
            ) : (
              <p className="plate p-4 text-sm text-bone-400">Select a target to see its measurements.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Summary({
  label,
  value,
  detail,
  tone = "plain",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "plain" | "live" | "fallback";
}) {
  return (
    <div className="plate-inset p-3">
      <p className="plate-caption">{label}</p>
      <p
        className={`mt-1 text-xl tabular-nums ${
          tone === "live" ? "signal-live" : tone === "fallback" ? "signal-fallback" : "text-bone-100"
        }`}
      >
        {value}
      </p>
      {detail ? <p className="mt-0.5 text-[0.7rem] leading-snug text-bone-400">{detail}</p> : null}
    </div>
  );
}