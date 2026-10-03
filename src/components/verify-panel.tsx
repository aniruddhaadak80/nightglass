"use client";

import { useState } from "react";
import { Loader2, ShieldCheck, ShieldAlert } from "lucide-react";

interface VerifyResult {
  ok: boolean;
  scope: unknown;
  chains: number;
  events: number;
  headSeal: string;
  brokenChains: Array<{
    planId: string;
    firstBrokenAt: number | null;
    firstBrokenId: string | null;
    reason: string | null;
  }>;
  algorithm: string;
  genesisSeal: string;
  recent: Array<{
    id: string;
    planId: string;
    action: string;
    seal: string;
    prevSeal: string;
    createdAt: string;
  }>;
}

function shortSeal(seal: string): string {
  return `${seal.slice(0, 12)}…${seal.slice(-6)}`;
}

/** Replay the chain on demand, against a real request to the verify route. */
export function VerifyPanel({ initialPlanId }: { initialPlanId: string | null }) {
  const [planId, setPlanId] = useState(initialPlanId ?? "");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const query = planId ? `?planId=${encodeURIComponent(planId)}&limit=100` : "?limit=100";
      const response = await fetch(`/api/verify${query}`);
      const body = (await response.json()) as VerifyResult & { error?: { message: string } };
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? `Request failed with status ${response.status}`);
      }
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replay failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="gutter">
        <p className="plate-caption">Integrity</p>
        <h1 className="font-display mt-1 text-4xl text-bone-100">Replay the chain</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-bone-300">
          Every create, update, decision, ranking, export and delete appends a sealed event to a
          per-entity chain. Replaying recomputes each SHA-384 from genesis and reports the first link
          that does not match. Deletions are soft, so a chain still replays after a delete.
        </p>
      </header>

      <div className="plate mt-6 flex flex-wrap items-end gap-3 p-4">
        <label className="block flex-1">
          <span className="mono-label">Plan id (optional — blank replays everything of yours)</span>
          <input
            className="field mt-1"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            placeholder="all plans in this session"
            data-testid="verify-plan-id"
          />
        </label>
        <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={pending} data-testid="verify-run">
          {pending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <ShieldCheck size={13} aria-hidden="true" />}
          Replay
        </button>
      </div>

      {error ? (
        <p role="alert" className="signal-fallback plate mt-4 p-3 text-sm">
          {error}
        </p>
      ) : null}

      {result ? (
        <section className="mt-6" aria-live="polite" data-testid="verify-result">
          <div
            className={`plate flex flex-wrap items-center gap-3 p-4 ${
              result.ok ? "border-brass-500/60" : "border-oxblood-500"
            }`}
          >
            {result.ok ? (
              <ShieldCheck size={20} className="signal-live" aria-hidden="true" />
            ) : (
              <ShieldAlert size={20} className="signal-fallback" aria-hidden="true" />
            )}
            <p className={`text-lg ${result.ok ? "signal-live" : "signal-fallback"}`}>
              {result.ok ? "Chain intact" : "Chain broken"}
            </p>
            <p className="mono-label ml-auto">
              {result.events} event{result.events === 1 ? "" : "s"} across {result.chains} chain
              {result.chains === 1 ? "" : "s"}
            </p>
          </div>

          <div className="plate mt-3 p-4">
            <p className="plate-caption">Head seal</p>
            <p className="mt-1 break-all text-xs text-bone-200">{result.headSeal}</p>
            <p className="plate-caption mt-4">Algorithm</p>
            <p className="mt-1 break-all text-xs text-bone-300">{result.algorithm}</p>
            <p className="mono-label mt-4">Genesis {shortSeal(result.genesisSeal)}</p>
          </div>

          {result.brokenChains.length > 0 ? (
            <div className="plate mt-3 border-oxblood-500 p-4">
              <p className="plate-caption text-oxblood-400">Broken links</p>
              <ul className="mt-2 space-y-2 text-xs text-bone-300">
                {result.brokenChains.map((b) => (
                  <li key={b.planId}>
                    <span className="text-oxblood-400">{b.planId}</span> — index {b.firstBrokenAt}, event{" "}
                    {b.firstBrokenId}: {b.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.recent.length > 0 ? (
            <div className="mt-6">
              <h2 className="plate-caption">Most recent events</h2>
              <ul className="mt-2 space-y-1.5" data-testid="verify-events">
                {result.recent.map((e) => (
                  <li key={e.id} className="plate-inset p-2.5 text-xs">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-brass-300">{e.action}</span>
                      <span className="mono-label">{e.createdAt.slice(0, 19).replace("T", " ")}</span>
                    </div>
                    <p className="mt-1 break-all text-[0.65rem] text-bone-400">
                      seal {e.seal} ← prev {e.prevSeal}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="plate mt-6 p-4 text-sm text-bone-400">
              No events yet. Create a plan or record an observation and the chain will populate.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}