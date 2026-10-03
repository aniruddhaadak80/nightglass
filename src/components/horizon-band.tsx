"use client";

import { useId, useMemo } from "react";
import type { AltitudeSample } from "@/lib/types";

/**
 * The signature interaction: an engraved altitude frame.
 *
 * Horizontal bands stand for 0° to 90° of true altitude. The selected target's
 * *actual* computed altitude curve is drawn across the dark window, and
 * everything below the observer's obstruction is hatched out in oxblood because
 * nothing down there is observable.
 *
 * Moving the obstruction slider re-cuts the frame and re-ranks every target,
 * because the frame is a direct readout of the same horizon value the engine
 * scored against. It is not decoration: the curve is the engine's output.
 */
export function HorizonBand({
  curve,
  horizonDeg,
  width = 640,
  height = 200,
  tone = "brass",
  showMoon = true,
}: {
  curve: AltitudeSample[];
  horizonDeg: number;
  width?: number;
  height?: number;
  tone?: "brass" | "oxblood";
  showMoon?: boolean;
}) {
  const clipId = useId();
  const stroke = tone === "brass" ? "var(--color-brass-400)" : "var(--color-oxblood-400)";

  const geometry = useMemo(() => {
    if (curve.length === 0) return null;
    const pad = 6;
    const h = height - pad * 2;
    const w = width - pad * 2;

    const toX = (index: number) => pad + (index / Math.max(1, curve.length - 1)) * w;
    const toY = (altitudeDeg: number) => pad + h - (Math.max(-5, Math.min(90, altitudeDeg)) / 90) * h;

    const altitudePoints = curve.map((s, i) => `${toX(i).toFixed(2)},${toY(s.altitudeDeg).toFixed(2)}`);
    const altitudePath = `M ${altitudePoints.join(" L ")}`;

    // Fill between the horizon line and the curve: the area actually open to
    // you. This is what makes the obstruction slider legible at a glance.
    const baseY = toY(0);
    const fillPath = `${altitudePath} L ${toX(curve.length - 1).toFixed(2)},${baseY.toFixed(2)} L ${toX(0).toFixed(2)},${baseY.toFixed(2)} Z`;

    const horizonY = toY(horizonDeg);

    return {
      altitudePath,
      fillPath,
      horizonY,
      moonPath:
        showMoon && curve.length > 1
          ? `M ${curve
              .map((s, i) => `${toX(i).toFixed(2)},${toY(Math.max(-90, s.moonAltitudeDeg)).toFixed(2)}`)
              .join(" L ")}`
          : null,
      startLabel: curve[0]?.at ?? "",
      endLabel: curve[curve.length - 1]?.at ?? "",
      peak: curve.reduce((m, s) => (s.altitudeDeg > m.altitudeDeg ? s : m), curve[0]!),
    };
  }, [curve, width, height, horizonDeg, showMoon]);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="horizon-frame w-full"
        role="img"
        aria-label={
          geometry
            ? `Altitude trace for the night: peaks at ${geometry.peak.altitudeDeg.toFixed(0)} degrees, obstruction ${horizonDeg.toFixed(0)} degrees.`
            : "No altitude trace available for this night."
        }
        preserveAspectRatio="none"
        style={{ height }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={width} height={height} />
          </clipPath>
        </defs>

        {/* Altitude gridlines every 30 degrees, labelled on the left. */}
        {[0, 30, 60, 90].map((deg) => {
          const y = height - 6 - (deg / 90) * (height - 12);
          return (
            <g key={deg}>
              <line
                x1={0}
                x2={width}
                y1={y}
                y2={y}
                stroke="rgba(192,138,46,0.22)"
                strokeWidth={deg === 0 ? 1.4 : 0.8}
              />
              <text
                x={4}
                y={y - 3}
                fill="rgba(216,204,178,0.7)"
                fontSize={9}
                fontFamily="var(--font-mono)"
              >
                {deg}°
              </text>
            </g>
          );
        })}

        {/* Everything below the obstruction is unobservable: hatch it out. */}
        <rect
          className="horizon-below"
          x={0}
          y={geometry ? geometry.horizonY : height}
          width={width}
          height={geometry ? Math.max(0, height - geometry.horizonY) : 0}
        />

        {geometry ? (
          <g clipPath={`url(#${clipId})`}>
            {/* Open sky: the area above the obstruction the target can use. */}
            <path d={geometry.fillPath} fill="rgba(192,138,46,0.14)" />

            {/* The Moon, so interference is visible not just scored. */}
            {geometry.moonPath ? (
              <path
                d={geometry.moonPath}
                fill="none"
                stroke="rgba(184,204,178,0.5)"
                strokeWidth={1.2}
                strokeDasharray="3 4"
              />
            ) : null}

            <path d={geometry.altitudePath} fill="none" stroke={stroke} strokeWidth={2} />

            <line
              x1={0}
              x2={width}
              y1={geometry.horizonY}
              y2={geometry.horizonY}
              stroke="var(--color-oxblood-400)"
              strokeWidth={1.2}
            />
          </g>
        ) : (
          <text
            x={width / 2}
            y={height / 2}
            textAnchor="middle"
            fill="rgba(216,204,178,0.6)"
            fontSize={11}
            fontFamily="var(--font-mono)"
          >
            no dark window at this latitude and date
          </text>
        )}
      </svg>

      <figcaption className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[0.65rem] uppercase tracking-[0.12em] text-bone-400">
        <span>Altitude 0°–90°</span>
        <span className="text-oxblood-400">— obstruction {horizonDeg.toFixed(0)}°</span>
        {geometry ? (
          <span>
            peak {geometry.peak.altitudeDeg.toFixed(0)}°
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}