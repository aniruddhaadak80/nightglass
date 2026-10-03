import { NextResponse } from "next/server";
/**
 * Session card export.
 *
 * Produces a real, downloadable artifact from a saved plan: a Markdown session
 * card carrying the ranked targets, the factor breakdown behind each score,
 * provenance for the live data, and the plan's audit seal.
 *
 * `format=json` returns the same content as structured data for agents.
 */

import { getPlan, isApiError, listObservations, ENGINE_VERSION } from "@/lib/service";
import { getRepository } from "@/lib/repository";
import { replayChain } from "@/lib/integrity";
import { withSession, ok } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clock(iso: string | null, timeZone: string): string {
  if (!iso) return "--";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timeZone && timeZone !== "auto" ? timeZone : "UTC",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(11, 16);
  }
}

export async function GET(request: Request) {
  const { session, attach } = await withSession();
  const url = new URL(request.url);
  const planId = url.searchParams.get("planId");
  const format = url.searchParams.get("format") === "json" ? "json" : "markdown";

  if (!planId) {
    return attach(NextResponse.json({ error: { code: "invalid_request", message: "planId is required." } }, { status: 400 }));
  }

  const plan = await getPlan(session.ownerId, planId);
  if (isApiError(plan)) {
    return attach(NextResponse.json(plan, { status: plan.error.code === "not_found" ? 404 : 400 }));
  }

  const repo = await getRepository();
  await repo.init();
  const audit = await repo.listAudit(plan.id);
  const chain = replayChain(audit);
  const observations = await listObservations(session.ownerId, 100, 0);
  const forPlan = isApiError(observations)
    ? []
    : observations.items.filter((o) => o.planId === plan.id);

  const ranked = [...plan.targets].sort((a, b) => (b.score?.score ?? -1) - (a.score?.score ?? -1));
  const generated = new Date().toISOString();

  if (format === "json") {
    return attach(
      ok({
        generatedAt: generated,
        engineVersion: ENGINE_VERSION,
        plan,
        integrity: { ok: chain.ok, events: chain.checked, headSeal: chain.headSeal },
        observations: forPlan,
      }),
    );
  }

  const lines: string[] = [];
  lines.push(`# ${plan.name}`);
  lines.push("");
  lines.push(`**Night of ${plan.nightOf}** · generated ${generated.slice(0, 19).replace("T", " ")} UTC`);
  lines.push("");
  lines.push(
    `Site: ${plan.site.name} (${plan.site.latitudeDeg.toFixed(4)}°, ${plan.site.longitudeDeg.toFixed(4)}°), ` +
      `Bortle ${plan.site.bortle}, horizon obstruction ${plan.site.horizonDeg}°.`,
  );
  lines.push(
    `Instrument: ${plan.instrument.name}, ${plan.instrument.apertureMm} mm ${plan.instrument.type} ` +
      `at ${plan.instrument.magnification}x.`,
  );
  lines.push("");
  lines.push(`Engine \`${ENGINE_VERSION}\` · plan \`${plan.id}\``);
  lines.push("");

  lines.push("## Targets");
  lines.push("");
  if (ranked.length === 0) {
    lines.push("_No targets on this plan yet. Run the ranking engine to score them._");
    lines.push("");
  } else {
    lines.push("| # | Target | Type | Mag | Score | Band | Window | Decision |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    ranked.forEach((t, i) => {
      const s = t.score;
      lines.push(
        `| ${i + 1} | ${t.name}${t.score?.gated ? " *(below your horizon)*" : ""} | ${t.kind} | ` +
          `${t.magnitude.toFixed(1)} | ${s ? s.score.toFixed(1) : "not scored"} | ${s ? s.band : "--"} | ` +
          `${s && s.windowStart ? `${clock(s.windowStart, plan.site.timezone)}–${clock(s.windowEnd, plan.site.timezone)}` : "--"} | ` +
          `${t.decision} |`,
      );
    });
    lines.push("");
  }

  const scored = ranked.filter((t) => t.score);
  if (scored.length > 0) {
    lines.push("## Why these scores");
    lines.push("");
    for (const t of scored) {
      const s = t.score!;
      lines.push(`### ${t.name} — ${s.score.toFixed(1)}/100 (${s.band})`);
      lines.push("");
      lines.push(`_${s.recommendation}_`);
      lines.push("");
      lines.push("| Factor | Value | Weight | Points | Measured |");
      lines.push("| --- | --- | --- | --- | --- |");
      for (const f of s.factors) {
        lines.push(
          `| ${f.label} | ${f.value.toFixed(1)} | ${(f.weight * 100).toFixed(0)}% | ${f.contribution.toFixed(2)} | ${f.evidence} |`,
        );
      }
      lines.push("");
      lines.push(`Seal \`${s.seal}\``);
      lines.push("");
    }
  }

  if (forPlan.length > 0) {
    lines.push("## Logged observations");
    lines.push("");
    for (const o of forPlan) {
      lines.push(`- **${o.objectName}** on ${o.seenOn}, confidence ${o.confidence}/5${o.notes ? ` — ${o.notes}` : ""}`);
    }
    lines.push("");
  }

  lines.push("## Provenance and integrity");
  lines.push("");
  lines.push(`- Audit chain replay: **${chain.ok ? "clean" : "BROKEN"}** across ${chain.checked} events.`);
  lines.push(`- Head seal: \`${chain.headSeal}\``);
  lines.push(`- Algorithm: \`seal_n = SHA-384(UTF-8(prevSeal) || canonicalJson(event_n))\`, genesis \`${"0".repeat(96)}\`.`);
  lines.push("");
  lines.push(
    "_Live conditions come from Open-Meteo; bright-star positions from the CDS Bright Star Catalogue " +
      "(VizieR V/50). Deep-sky positions ship as a curated J2000 sample. Check the API response for " +
      "whether a given run used live or fallback data._",
  );
  lines.push("");
  lines.push(
    "_Observing times and altitudes are computed from real ephemerides, but they are a planning aid, " +
      "not a substitute for checking the sky. Never point equipment at anything without looking._",
  );

const body = `${lines.join("\n")}\n`;
  const base = plan.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "session";
  // Avoid `card-2026-10-03-2026-10-03.md` when the plan name already ends with
  // the night being planned.
  const slug = base.endsWith(plan.nightOf) ? base : `${base}-${plan.nightOf}`;
  const filename = `${slug}.md`;

  return attach(
    new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    }),
  );
}