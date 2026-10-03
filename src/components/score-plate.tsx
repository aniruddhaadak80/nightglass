"use client";

import { useMemo, useState } from "react";
import type { Factor, ObservabilityScore } from "@/lib/types";
import { HorizonBand } from "./horizon-band";

/**
 * The score plate: a score, its band, the recommendation, and every factor that
 * produced it.
 *
 * Selecting a factor expands the evidence for that factor only, so a visitor can
 * find *why* a target scored what it did without reading six paragraphs.
 */
export function ScorePlate({
  score,
  name,
  horizonDeg,
  defaultOpen = false,
}: {
  score: ObservabilityScore;
  name: string;
  horizonDeg: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(defaultOpen ? score.factors[0]?.id ?? null : null);
  const tone =
    score.band === "prime"
      ? "var(--color-brass-300)"
      : score.band === "good"
        ? "var(--color-brass-500)"
        : score.band === "fair"
          ? "var(--color-bone-300)"
          : "var(--color-oxblood-400)";

  const circumference = 2 * Math.PI * 26;

  return (
    <div className="plate plate-ticked p-4">
      <div className="flex flex-wrap items-start gap-4">
        {/* Score dial: the raw number, not a decorative ring. */}
        <svg width={64} height={64} viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
          <circle cx={32} cy={32} r={26} fill="none" stroke="rgba(192,138,46,0.2)" strokeWidth={4} />
          <circle
            cx={32}
            cy={32}
            r={26}
            fill="none"
            stroke={tone}
            strokeWidth={4}
            strokeLinecap="butt"
            strokeDasharray={`${(score.score / 100) * circumference} ${circumference}`}
            transform="rotate(-90 32 32)"
          />
          <text
            x={32}
            y={36}
            textAnchor="middle"
            fill="var(--color-bone-100)"
            fontSize={17}
            fontFamily="var(--font-mono)"
          >
            {Math.round(score.score)}
          </text>
        </svg>

        <div className="min-w-[12rem] flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="font-display text-xl text-bone-100">{name}</h3>
            <span className="plate-caption" style={{ color: tone }}>
              {score.band}
            </span>
            {score.gated ? (
              <span className="mono-label text-oxblood-400">below your horizon</span>
            ) : null}
          </div>
          <p className="mt-1 text-[0.7rem] uppercase tracking-[0.1em] text-bone-400">
            engine {score.engineVersion} · seal {score.seal.slice(0, 12)}…
          </p>
          <p className="mt-2 text-sm leading-relaxed text-bone-200">{score.recommendation}</p>
        </div>
      </div>

      {/* Factor bars: width is the factor's real weight, fill is its real value. */}
      <ul className="mt-4 space-y-1.5">
        {score.factors.map((f) => (
          <FactorRow
            key={f.id}
            factor={f}
            open={open === f.id}
            onToggle={() => setOpen((cur) => (cur === f.id ? null : f.id))}
          />
        ))}
      </ul>

      <div className="mt-4">
        <HorizonBand curve={score.altitudeCurve} horizonDeg={horizonDeg} height={150} />
      </div>
    </div>
  );
}

function FactorRow({
  factor,
  open,
  onToggle,
}: {
  factor: Factor;
  open: boolean;
  onToggle: () => void;
}) {
  const width = useMemo(
    () => (factor.weight * 100).toFixed(1),
    [factor.weight],
  );

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-left"
      >
        <span className="flex items-center gap-3">
          {/* The track's own width encodes the factor's weight, so the six bars
              together read as the scoring weights. */}
          <span
            className="inline-block h-2.5 shrink-0 border border-brass-500/30"
            style={{ width: `${Math.max(6, Number(width) * 3)}px` }}
            aria-hidden="true"
          />
          <span className="flex-1 truncate text-[0.7rem] uppercase tracking-[0.1em] text-bone-300">
            {factor.label}
          </span>
          <span className="w-10 shrink-0 text-right text-[0.7rem] tabular-nums text-brass-300">
            {factor.value.toFixed(0)}
          </span>
          <span className="w-14 shrink-0 text-right text-[0.65rem] tabular-nums text-bone-400">
            +{factor.contribution.toFixed(1)}
          </span>
          <span aria-hidden="true" className="shrink-0 text-bone-400">
            {open ? "−" : "+"}
          </span>
        </span>
        <span className="mt-1 block h-1 w-full bg-verdigris-950/70" aria-hidden="true">
          <span
            className="block h-full bg-brass-500/70"
            style={{ width: `${factor.value}%` }}
          />
        </span>
      </button>
      {open ? (
        <p className="mt-2 border-l-2 border-brass-500/40 pl-3 text-xs leading-relaxed text-bone-300">
          {factor.evidence}
        </p>
      ) : null}
    </li>
  );
}