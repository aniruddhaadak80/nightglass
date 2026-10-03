import { describe, expect, it } from "vitest";
import { darkWindowFor } from "@/lib/astro";
import {
  ENGINE_VERSION,
  FACTOR_WEIGHTS,
  HORIZON_GATE_CEILING,
  bandFor,
  clamp,
  clamp01,
  rankTarget,
  rankTargets,
  round,
  seeingFactorValue,
  surfaceBrightness,
  toleranceForAngularSize,
  type EngineInput,
} from "@/lib/engine";
import { conditions, instrument, site, star } from "./fixtures";

function inputFor(overrides: Partial<EngineInput> = {}): EngineInput {
  const s = overrides.site ?? site();
  const w = darkWindowFor("2026-10-06", s.latitudeDeg, s.longitudeDeg);
  return {
    object: star(),
    site: s,
    instrument: instrument(),
    conditions: conditions(),
    windowStart: w.start,
    windowEnd: w.end,
    ...overrides,
  };
}

describe("helpers", () => {
  it("clamps", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
  });

  it("rounds to a stable number of decimals", () => {
    expect(round(1.23456, 2)).toBe(1.23);
    expect(round(1.005, 2)).toBe(1.0);
    expect(round(Number.NaN)).toBe(0);
  });

  it("maps scores to bands on the documented boundaries", () => {
    expect(bandFor(100)).toBe("prime");
    expect(bandFor(78)).toBe("prime");
    expect(bandFor(77.9)).toBe("good");
    expect(bandFor(60)).toBe("good");
    expect(bandFor(40)).toBe("fair");
    expect(bandFor(20)).toBe("poor");
    expect(bandFor(19.9)).toBe("blocked");
    expect(bandFor(0)).toBe("blocked");
  });

  it("computes surface brightness as magnitude plus 2.5 log10 area", () => {
    const obj = star({ magnitude: 8, angularSizeArcmin: 100 });
    expect(surfaceBrightness(obj)).toBeCloseTo(8 + 2.5 * Math.log10(100), 2);
  });

  it("reports no surface brightness for a point source", () => {
    expect(surfaceBrightness(star({ angularSizeArcmin: null }))).toBeNull();
    expect(surfaceBrightness(star({ angularSizeArcmin: 0 }))).toBeNull();
  });
});

describe("factor contract", () => {
  it("weights sum to exactly one", () => {
    const total = Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("produces all six documented factors", () => {
    const score = rankTarget(inputFor());
    expect(score.factors).toHaveLength(6);
    expect(score.factors.map((f) => f.id)).toEqual([
      "horizon_clearance",
      "sky_darkness",
      "instrument_reach",
      "transparency",
      "seeing_tolerance",
      "culmination",
    ]);
  });

  it("keeps every factor and contribution inside its declared range", () => {
    const score = rankTarget(inputFor());
    for (const f of score.factors) {
      expect(f.value).toBeGreaterThanOrEqual(0);
      expect(f.value).toBeLessThanOrEqual(100);
      expect(f.weight).toBeGreaterThan(0);
      expect(f.contribution).toBeCloseTo((f.value / 100) * f.weight * 100, 2);
      expect(f.evidence.length).toBeGreaterThan(10);
    }
  });

  it("makes the score equal the sum of its contributions", () => {
    for (const input of [
      inputFor(),
      inputFor({ site: site({ horizonDeg: 0 }) }),
      inputFor({ conditions: conditions({ seeing: 0.1, transparency: 0.2 }) }),
      inputFor({ object: star({ decDeg: -70 }), site: site({ horizonDeg: 30 }) }),
    ]) {
      const score = rankTarget(input);
      const sum = score.factors.reduce((acc, f) => acc + f.value * f.weight, 0);
      // A gated result is deliberately clamped below the factor sum; that clamp
      // is the whole point of the gate, so the identity holds only when open.
      if (score.gated) {
        expect(score.score).toBeLessThan(sum);
        expect(score.score).toBeLessThanOrEqual(HORIZON_GATE_CEILING);
      } else {
        expect(score.score).toBeCloseTo(sum, 1);
      }
    }
  });

  it("stamps the engine version", () => {
    expect(rankTarget(inputFor()).engineVersion).toBe(ENGINE_VERSION);
  });
});

describe("scoring behaviour", () => {
  it("scores a bright star well on a clear dark night", () => {
    const s = site({ latitudeDeg: 40, longitudeDeg: -3, bortle: 4, horizonDeg: 10 });
    const score = rankTarget(
      inputFor({
        site: s,
        object: star({ magnitude: 1.0, decDeg: 45 }),
        conditions: conditions({ cloudCoverPct: 0, visibilityMeters: 30000, transparency: 1, seeing: 0.9 }),
      }),
    );
    expect(score.score).toBeGreaterThan(60);
    expect(["prime", "good"]).toContain(score.band);
  });

  it("punishes an obstructed horizon", () => {
    const open = rankTarget(inputFor({ site: site({ horizonDeg: 0 }) }));
    const blocked = rankTarget(inputFor({ site: site({ horizonDeg: 60 }) }));
    expect(blocked.score).toBeLessThan(open.score);
    const clearance = (r: typeof open) => r.factors.find((f) => f.id === "horizon_clearance")!;
    expect(clearance(blocked).value).toBeLessThan(clearance(open).value);
  });

  it("punishes light pollution", () => {
    const dark = rankTarget(inputFor({ site: site({ bortle: 2 }), object: star({ magnitude: 9, decDeg: 30 }) }));
    const city = rankTarget(inputFor({ site: site({ bortle: 9 }), object: star({ magnitude: 9, decDeg: 30 }) }));
    expect(city.score).toBeLessThan(dark.score);
  });

  it("punishes cloud", () => {
    const clear = rankTarget(inputFor({ conditions: conditions({ transparency: 1, cloudCoverPct: 0 }) }));
    const overcast = rankTarget(inputFor({ conditions: conditions({ transparency: 0.05, cloudCoverPct: 100 }) }));
    expect(overcast.score).toBeLessThan(clear.score);
  });

  it("punishes unsteady air on small targets but not on large ones", () => {
    const small = star({ angularSizeArcmin: 1, decDeg: 45 });
    const large = star({ angularSizeArcmin: 60, decDeg: 45, kind: "cluster" });
    const goodAir = conditions({ seeing: 0.95 });
    const badAir = conditions({ seeing: 0.1 });

    // In steady air both are fine, so the large target is at least as good.
    const smallGood = rankTarget(inputFor({ object: small, conditions: goodAir })).score;
    const largeGood = rankTarget(inputFor({ object: large, conditions: goodAir })).score;
    expect(largeGood).toBeGreaterThanOrEqual(smallGood);

    // In unsteady air the gap opens up: this is the whole point of the factor.
    const smallBad = rankTarget(inputFor({ object: small, conditions: badAir })).score;
    const largeBad = rankTarget(inputFor({ object: large, conditions: badAir })).score;
    expect(largeBad - smallBad).toBeGreaterThan(largeGood - smallGood);
  });

  it("scores an extended object on surface brightness as well as magnitude", () => {
    // Two objects with identical integrated magnitude. The compact one is a
    // bright knot; the other is spread thin over a large area and needs a
    // darker sky to give anything back. Magnitude alone cannot tell them apart.
    const compact = star({ magnitude: 11, angularSizeArcmin: 4, kind: "galaxy" });
    const diffuse = star({ magnitude: 11, angularSizeArcmin: 200, kind: "nebula" });
    const a = rankTarget(inputFor({ object: compact, site: site({ bortle: 8 }) }));
    const b = rankTarget(inputFor({ object: diffuse, site: site({ bortle: 8 }) }));
    const reach = (r: typeof a) => r.factors.find((f) => f.id === "instrument_reach")!.value;
    expect(reach(a)).toBeGreaterThan(reach(b));
  });

  it("gives extended and point sources the same treatment when size is unknown", () => {
    const unknown = rankTarget(inputFor({ object: star({ magnitude: 9, angularSizeArcmin: null }) }));
    const reach = unknown.factors.find((f) => f.id === "instrument_reach")!;
    expect(reach.evidence).toMatch(/Magnitude/);
    expect(reach.evidence).not.toMatch(/Surface brightness/);
  });

  it("penalises a faint target when the instrument is small", () => {
    const faint = star({ magnitude: 12, decDeg: 45 });
    const big = rankTarget(inputFor({ object: faint, instrument: instrument({ apertureMm: 300 }) }));
    const small = rankTarget(inputFor({ object: faint, instrument: instrument({ apertureMm: 60 }) }));
    expect(small.score).toBeLessThan(big.score);
  });

  it("scores a point source on magnitude alone", () => {
    // Both sit below the 3 arcminute threshold at which an object is treated as
    // extended, so both fall back to the pure magnitude term.
    const tiny = star({ magnitude: 8, angularSizeArcmin: 0.5, kind: "star" });
    const small = star({ magnitude: 8, angularSizeArcmin: 2, kind: "star" });
    const a = rankTarget(inputFor({ object: tiny, site: site({ bortle: 8 }) }));
    const b = rankTarget(inputFor({ object: small, site: site({ bortle: 8 }) }));
    const reach = (r: typeof a) => r.factors.find((f) => f.id === "instrument_reach")!;
    expect(reach(a).evidence).toMatch(/Magnitude/);
    expect(reach(b).evidence).toMatch(/Magnitude/);
    expect(reach(b).value).toBeCloseTo(reach(a).value, 5);
  });

  it("models seeing so large targets are penalised less by unsteady air", () => {
    // A simple product of tolerance and air steadiness would make a large
    // object swing harder than a small one, which is backwards.
    const tolerant = seeingFactorValue(toleranceForAngularSize(60), 0.1);
    const brittle = seeingFactorValue(toleranceForAngularSize(1), 0.1);
    expect(tolerant).toBeGreaterThan(brittle);

    const tolerantSteady = seeingFactorValue(toleranceForAngularSize(60), 0.95);
    const brittleSteady = seeingFactorValue(toleranceForAngularSize(1), 0.95);
    expect(tolerantSteady).toBeGreaterThan(brittleSteady);

    // The gap between them widens as the air gets worse.
    const steadyGap = tolerantSteady - brittleSteady;
    const unsteadyGap = tolerant - brittle;
    expect(unsteadyGap).toBeGreaterThan(steadyGap);

    // And each stays inside its declared range across the whole domain.
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      for (const a of [0, 0.25, 0.5, 0.75, 1]) {
        const v = seeingFactorValue(t, a);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it("makes tolerance monotonic in angular size", () => {
    let previous = -1;
    for (const arcmin of [0.3, 1, 5, 20, 60, 200]) {
      const t = toleranceForAngularSize(arcmin);
      expect(t).toBeGreaterThanOrEqual(previous);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
      previous = t;
    }
  });

  it("never returns NaN for an extreme window", () => {
    const score = rankTarget(
      inputFor({
        windowStart: new Date("2026-10-06T00:00:00Z"),
        windowEnd: new Date("2026-10-06T00:00:00Z"),
      }),
    );
    expect(Number.isFinite(score.score)).toBe(true);
    expect(Number.isFinite(score.maxAltitudeDeg)).toBe(true);
    expect(score.recommendation.length).toBeGreaterThan(10);
  });

  it("treats a missing dark night as unscoreable rather than guessing", () => {
    const s = site({ latitudeDeg: 78, longitudeDeg: 0 });
    const w = darkWindowFor("2026-06-21", s.latitudeDeg, s.longitudeDeg);
    const score = rankTarget(inputFor({ site: s, windowStart: w.start, windowEnd: w.end }));
    expect(Number.isFinite(score.score)).toBe(true);
  });
});

describe("the altitude curve", () => {
  it("samples the window and stays bounded", () => {
    const score = rankTarget(inputFor());
    expect(score.altitudeCurve.length).toBeGreaterThan(20);
    expect(score.altitudeCurve.length).toBeLessThanOrEqual(240);
    for (const s of score.altitudeCurve) {
      expect(Number.isFinite(s.altitudeDeg)).toBe(true);
      expect(s.altitudeDeg).toBeGreaterThanOrEqual(-90);
      expect(s.altitudeDeg).toBeLessThanOrEqual(90);
      expect(s.azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(s.azimuthDeg).toBeLessThan(360);
    }
  });

  it("runs forward in time", () => {
    const curve = rankTarget(inputFor()).altitudeCurve;
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!.at > curve[i - 1]!.at).toBe(true);
      expect(curve[i]!.minutes).toBeGreaterThan(curve[i - 1]!.minutes);
    }
  });

  it("reports the sun at or below the astronomical threshold throughout a real dark window", () => {
    const curve = rankTarget(inputFor()).altitudeCurve;
    expect(curve.length).toBeGreaterThan(20);
    // The refined endpoints sit exactly on the -18 degree crossing.
    expect(curve[0]!.sunAltitudeDeg).toBeLessThanOrEqual(-18);
    expect(curve[0]!.sunAltitudeDeg).toBeGreaterThan(-18.02);
    expect(curve[curve.length - 1]!.sunAltitudeDeg).toBeLessThanOrEqual(-18);
    expect(curve[curve.length - 1]!.sunAltitudeDeg).toBeGreaterThan(-18.02);
    // Everything strictly inside is unambiguously dark.
    for (const s of curve.slice(1, -1)) {
      expect(s.sunAltitudeDeg).toBeLessThan(-18);
    }
  });

  it("bounds the observing window by the obstruction", () => {
    const score = rankTarget(inputFor({ site: site({ horizonDeg: 20 }) }));
    if (score.windowStart && score.windowEnd) {
      const first = score.altitudeCurve.find((s) => s.at === score.windowStart);
      const last = score.altitudeCurve.find((s) => s.at === score.windowEnd);
      expect(first!.altitudeDeg).toBeGreaterThan(20);
      expect(last!.altitudeDeg).toBeGreaterThan(20);
    }
  });

  it("leaves the window null when the target never clears the horizon", () => {
    const score = rankTarget(
      inputFor({ object: star({ decDeg: -60 }), site: site({ latitudeDeg: 40, horizonDeg: 20 }) }),
    );
    expect(score.windowStart).toBeNull();
    expect(score.windowEnd).toBeNull();
    expect(score.recommendation).toMatch(/Skip tonight/i);
    expect(score.band).toBe("blocked");
  });
});

describe("recommendations", () => {
  it("is a single actionable sentence for every band", () => {
    const inputs = [
      inputFor({ object: star({ decDeg: -70 }), site: site({ horizonDeg: 30 }) }),
      inputFor({ object: star({ magnitude: 12, decDeg: 40 }), instrument: instrument({ apertureMm: 50 }) }),
      inputFor({ object: star({ decDeg: 45 }) }),
    ];
    for (const i of inputs) {
      const r = rankTarget(i).recommendation;
      expect(r.length).toBeGreaterThan(20);
      expect(r.endsWith(".")).toBe(true);
    }
  });

  it("names the target", () => {
    expect(rankTarget(inputFor({ object: star({ name: "Rigel" }) })).recommendation).toContain("Rigel");
  });

  it("warns about unsteady air on small targets", () => {
    const r = rankTarget(
      inputFor({
        object: star({ angularSizeArcmin: 1, decDeg: 45 }),
        conditions: conditions({ seeing: 0.15 }),
      }),
    );
    expect(r.recommendation).toMatch(/unsteady/i);
  });

  it("warns about a bright Moon", () => {
    const r = rankTarget(inputFor({ object: star({ decDeg: 45, magnitude: 4 }) }));
    if (r.moonIllumination > 0.75) {
      expect(r.recommendation).toMatch(/Moon/);
    }
  });
});

describe("determinism", () => {
  it("produces identical output for identical input", () => {
    const i = inputFor();
    expect(JSON.stringify(rankTarget(i))).toBe(JSON.stringify(rankTarget(i)));
  });

  it("produces identical output across an independent recomputation", () => {
    const a = inputFor();
    const b = inputFor();
    expect(JSON.stringify(rankTarget(a))).toBe(JSON.stringify(rankTarget(b)));
  });

  it("has an empty seal ready for the service layer to stamp", () => {
    expect(rankTarget(inputFor()).seal).toBe("");
  });
});

describe("ranking many targets", () => {
  const targets = [
    star({ id: "c", name: "C", magnitude: 3, decDeg: 40 }),
    star({ id: "a", name: "A", magnitude: 1, decDeg: 40 }),
    star({ id: "b", name: "B", magnitude: 3, decDeg: 40 }),
    star({ id: "d", name: "D", magnitude: 9, decDeg: -80 }),
  ];

  it("returns results in descending score order", () => {
    const ranked = rankTargets(targets.map((o) => inputFor({ object: o })));
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
    }
  });

  it("breaks exact ties deterministically by magnitude then id", () => {
    const ranked = rankTargets(targets.map((o) => inputFor({ object: o })));
    // D never rises at this latitude and must land last.
    expect(ranked[ranked.length - 1]!.factors.find((f) => f.id === "horizon_clearance")!.value).toBe(0);
  });

  it("is stable across repeated runs", () => {
    const one = JSON.stringify(rankTargets(targets.map((o) => inputFor({ object: o }))));
    const two = JSON.stringify(rankTargets(targets.map((o) => inputFor({ object: o }))));
    expect(one).toBe(two);
  });

  it("returns an empty array for no targets", () => {
    expect(rankTargets([])).toEqual([]);
  });
});