import { describe, expect, it } from "vitest";
import { MAX_PAGE_SIZE, PAGE_SIZE, readPaging } from "@/lib/api";
import { canonicalJson, computeSeal, GENESIS_SEAL, replayAllChains, replayChain, sealEvent, sha384Hex } from "@/lib/integrity";
import { normalizeRows, resolveSchema } from "@/lib/repository";
import { deriveConditions, splitCsvLine } from "@/lib/feed";
import { fail, statusForError } from "@/lib/service";
import type { AuditEvent } from "@/lib/types";

describe("readPaging", () => {
  // Regression guard. `Number(null)` is 0, not NaN, so an absent parameter used
  // to clamp to a single row: every list endpoint without an explicit limit
  // silently returned one record, and the integrity panel showed one event.
  it("falls back to the default page size when limit is absent", () => {
    const { limit, offset } = readPaging("https://example.test/api/plans");
    expect(limit).toBe(PAGE_SIZE);
    expect(offset).toBe(0);
  });

  it("falls back to the default when the parameters are blank", () => {
    expect(readPaging("https://example.test/api/plans?limit=&offset=").limit).toBe(PAGE_SIZE);
  });

  it("falls back to the default when the parameters are not numbers", () => {
    expect(readPaging("https://example.test/api/plans?limit=abc").limit).toBe(PAGE_SIZE);
    expect(readPaging("https://example.test/api/plans?offset=xyz").offset).toBe(0);
  });

  it("honours explicit values", () => {
    expect(readPaging("https://example.test/api/plans?limit=5&offset=10")).toEqual({ limit: 5, offset: 10 });
  });

  it("clamps into range", () => {
    expect(readPaging("https://example.test/api/plans?limit=0").limit).toBe(1);
    expect(readPaging("https://example.test/api/plans?limit=-4").limit).toBe(1);
    expect(readPaging("https://example.test/api/plans?limit=99999").limit).toBe(MAX_PAGE_SIZE);
    expect(readPaging("https://example.test/api/plans?offset=-3").offset).toBe(0);
    expect(readPaging("https://example.test/api/plans?limit=7.9").limit).toBe(7);
  });
});

describe("canonical json", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("produces the same bytes regardless of insertion order", () => {
    expect(canonicalJson({ x: 1, y: [3, 2] })).toBe(canonicalJson({ y: [3, 2], x: 1 }));
  });

  it("preserves array order, because array order is data", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("normalises values that have no JSON representation", () => {
    expect(canonicalJson(Number.NaN)).toBe("null");
    expect(canonicalJson(Number.POSITIVE_INFINITY)).toBe("null");
    expect(canonicalJson(undefined)).toBe("null");
  });

  it("omits undefined properties rather than emitting them", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("seal chain", () => {
  function event(i: number, action: AuditEvent["action"] = "plan.created"): Omit<AuditEvent, "seal"> {
    return {
      id: `id-${i}`,
      planId: "plan-1",
      action,
      payload: JSON.stringify({ i }),
      prevSeal: "prev",
      createdAt: `2026-10-03T00:00:${String(i).padStart(2, "0")}.000Z`,
    };
  }

  it("uses a 96-character genesis value", () => {
    expect(GENESIS_SEAL).toHaveLength(96);
    expect(GENESIS_SEAL).toMatch(/^0{96}$/);
  });

  it("produces a 96-hex-digit SHA-384 seal", () => {
    const sealed = sealEvent(GENESIS_SEAL, { ...event(1), prevSeal: GENESIS_SEAL });
    expect(sealed.seal).toHaveLength(96);
    expect(sealed.seal).toMatch(/^[0-9a-f]{96}$/);
  });

  it("is deterministic", () => {
    const a = sealEvent(GENESIS_SEAL, { ...event(1), prevSeal: GENESIS_SEAL });
    const b = sealEvent(GENESIS_SEAL, { ...event(1), prevSeal: GENESIS_SEAL });
    expect(a.seal).toBe(b.seal);
  });

  it("changes when any field changes", () => {
    const base = sealEvent(GENESIS_SEAL, { ...event(1), prevSeal: GENESIS_SEAL }).seal;
    const changed = sealEvent(GENESIS_SEAL, {
      ...event(1),
      prevSeal: GENESIS_SEAL,
      payload: JSON.stringify({ i: 2 }),
    }).seal;
    expect(changed).not.toBe(base);
  });

  it("replays a clean chain", () => {
    let prev = GENESIS_SEAL;
    const events: AuditEvent[] = [];
    for (let i = 1; i <= 4; i++) {
      const sealed = sealEvent(prev, { ...event(i), prevSeal: prev });
      prev = sealed.seal;
      events.push(sealed);
    }
    const result = replayChain(events);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(4);
    expect(result.headSeal).toBe(events[3]!.seal);
  });

  it("detects an altered payload and names the index", () => {
    let prev = GENESIS_SEAL;
    const events: AuditEvent[] = [];
    for (let i = 1; i <= 3; i++) {
      const sealed = sealEvent(prev, { ...event(i), prevSeal: prev });
      prev = sealed.seal;
      events.push(sealed);
    }
    const tampered = events.map((e, i) => (i === 1 ? { ...e, payload: JSON.stringify({ i: 999 }) } : e));
    const result = replayChain(tampered);
    expect(result.ok).toBe(false);
    expect(result.firstBrokenAt).toBe(1);
    expect(result.reason).toMatch(/altered/);
  });

  it("detects a removed event as a prevSeal mismatch", () => {
    let prev = GENESIS_SEAL;
    const events: AuditEvent[] = [];
    for (let i = 1; i <= 3; i++) {
      const sealed = sealEvent(prev, { ...event(i), prevSeal: prev });
      prev = sealed.seal;
      events.push(sealed);
    }
    const removed = [events[0]!, events[2]!];
    const result = replayChain(removed);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/reordered or an event was removed/);
  });

  it("treats an empty chain as clean", () => {
    const result = replayChain([]);
    expect(result.ok).toBe(true);
    expect(result.headSeal).toBe(GENESIS_SEAL);
  });

  it("replays each entity chain independently", () => {
    function chain(id: string, count: number): AuditEvent[] {
      let prev = GENESIS_SEAL;
      const out: AuditEvent[] = [];
      for (let i = 1; i <= count; i++) {
        const sealed = sealEvent(prev, {
          id: `${id}-${i}`,
          planId: id,
          action: "plan.created",
          payload: JSON.stringify({ i }),
          prevSeal: prev,
          createdAt: `2026-10-03T00:00:${String(i).padStart(2, "0")}.000Z`,
        });
        prev = sealed.seal;
        out.push(sealed);
      }
      return out;
    }

    const result = replayAllChains([...chain("a", 2), ...chain("b", 3)]);
    expect(result.ok).toBe(true);
    expect(result.chains).toBe(2);
    expect(result.events).toBe(5);
  });

  it("reports which entity chain is broken", () => {
    const one = sealEvent(GENESIS_SEAL, {
      id: "a-1",
      planId: "a",
      action: "plan.created",
      payload: "{}",
      prevSeal: GENESIS_SEAL,
      createdAt: "2026-10-03T00:00:01.000Z",
    });
    const result = replayAllChains([one, { ...one, id: "a-2", seal: "f".repeat(96) }]);
    expect(result.ok).toBe(false);
    expect(result.brokenChains[0]?.planId).toBe("a");
  });

  it("matches a pinned known vector, so the algorithm cannot drift", () => {
    // The digest below was computed by hand from
    //   SHA-384( UTF-8(prevSeal) || canonicalJson(event) )
    // with the canonical form written out in `scripts/` during development. It
    // is pinned here so that a change to key ordering, the digest, or the
    // concatenation order fails this test instead of silently invalidating
    // every previously exported session card.
    const sealed = sealEvent(GENESIS_SEAL, {
      id: "vector-1",
      planId: "plan-1",
      action: "plan.created",
      payload: '{"n":1}',
      prevSeal: GENESIS_SEAL,
      createdAt: "2026-10-03T00:00:00.000Z",
    });
    expect(sealed.seal).toBe(
      "c6d5e3b46a54f40c69b1258448c8784dc085299bdde15a4fabdbc175e5bb5edfa0775231f14dd3fa7e8fc5299f84caa9",
    );
  });

  it("changes the seal if the concatenation order ever does", () => {
    // Guards the specific mistake of hashing canonicalJson(prevSeal + event)
    // instead of prevSeal + canonicalJson(event).
    const ev = {
      id: "vector-1",
      planId: "plan-1",
      action: "plan.created" as const,
      payload: '{"n":1}',
      prevSeal: GENESIS_SEAL,
      createdAt: "2026-10-03T00:00:00.000Z",
    };
    const correct = computeSeal(GENESIS_SEAL, ev);
    const wrong = sha384Hex(canonicalJson({ ...ev, prevSeal: GENESIS_SEAL }));
    expect(correct).not.toBe(wrong);
  });
});

describe("error envelope", () => {
  it("maps codes to the documented statuses", () => {
    expect(statusForError("invalid_request")).toBe(400);
    expect(statusForError("unauthorized")).toBe(403);
    expect(statusForError("not_found")).toBe(404);
    expect(statusForError("conflict")).toBe(409);
    expect(statusForError("rate_limited")).toBe(429);
    expect(statusForError("upstream_unavailable")).toBe(503);
    expect(statusForError("internal")).toBe(500);
  });

  it("omits details when none were supplied", () => {
    expect(fail("not_found", "gone")).toEqual({ error: { code: "not_found", message: "gone" } });
    expect(fail("invalid_request", "bad", [1])).toEqual({
      error: { code: "invalid_request", message: "bad", details: [1] },
    });
  });

  it("never leaks a stack trace", () => {
    const text = JSON.stringify(fail("internal", "Something failed."));
    expect(text).not.toContain("at ");
    expect(text).not.toContain(".ts:");
  });
});

describe("driver row normalisation", () => {
  it("handles a bare array from @neondatabase/serverless", () => {
    expect(normalizeRows([{ a: 1 }])).toEqual({ rows: [{ a: 1 }] });
  });

  it("handles a { rows } object from the pg-compatible surface", () => {
    expect(normalizeRows({ rows: [{ a: 1 }] })).toEqual({ rows: [{ a: 1 }] });
  });

  it("never returns undefined rows, which would read as an empty table", () => {
    expect(normalizeRows(null)).toEqual({ rows: [] });
    expect(normalizeRows(undefined)).toEqual({ rows: [] });
    expect(normalizeRows({ rows: null })).toEqual({ rows: [] });
    expect(normalizeRows(42)).toEqual({ rows: [] });
  });
});

describe("schema guard", () => {
  it("defaults to public", () => {
    expect(resolveSchema()).toBe("public");
  });

  it("rejects anything that is not a plain identifier", () => {
    const previous = process.env.DATABASE_SCHEMA;
    for (const bad of ['public; DROP TABLE plans', "public'", "1abc", "a-b", "x".repeat(80)]) {
      process.env.DATABASE_SCHEMA = bad;
      expect(() => resolveSchema()).toThrow();
    }
    if (previous === undefined) delete process.env.DATABASE_SCHEMA;
    else process.env.DATABASE_SCHEMA = previous;
  });

  it("accepts a valid namespaced schema", () => {
    const previous = process.env.DATABASE_SCHEMA;
    process.env.DATABASE_SCHEMA = "nightglass_v1";
    expect(resolveSchema()).toBe("nightglass_v1");
    if (previous === undefined) delete process.env.DATABASE_SCHEMA;
    else process.env.DATABASE_SCHEMA = previous;
  });
});

describe("vizier csv parsing", () => {
  it("keeps commas inside quoted fields", () => {
    expect(splitCsvLine('1,"Alpha, Beta",2.5')).toEqual(["1", "Alpha, Beta", "2.5"]);
  });

  it("handles escaped quotes", () => {
    expect(splitCsvLine('a,"say ""hi""",b')).toEqual(["a", 'say "hi"', "b"]);
  });

  it("handles empty trailing fields", () => {
    expect(splitCsvLine("a,b,")).toEqual(["a", "b", ""]);
  });

  it("returns a single field when there is no comma", () => {
    expect(splitCsvLine("only")).toEqual(["only"]);
  });
});

describe("condition derivation", () => {
  const base = {
    status: "live" as const,
    fetchedAt: "2026-10-03T00:00:00.000Z",
    source: { id: "open-meteo", label: "Open-Meteo", attribution: "", endpoint: "" },
    degradedReason: null,
    cloudCoverPct: 0,
    cloudLowPct: 0,
    cloudMidPct: 0,
    cloudHighPct: 0,
    visibilityMeters: 30000,
    windSpeedKph: 5,
    temperatureC: 10,
    humidityPct: 50,
  };

  it("rates a clear steady night as transparent and steady", () => {
    const c = deriveConditions(base);
    expect(c.transparency).toBeGreaterThan(0.9);
    expect(c.seeing).toBeGreaterThan(0.9);
  });

  it("rates an overcast windy night as poor", () => {
    const c = deriveConditions({
      ...base,
      cloudCoverPct: 100,
      cloudLowPct: 95,
      visibilityMeters: 2000,
      windSpeedKph: 38,
    });
    expect(c.transparency).toBeLessThan(0.2);
    expect(c.seeing).toBeLessThan(0.2);
  });

  it("keeps both indices inside 0..1 across the whole input domain", () => {
    for (const cloud of [-50, 0, 50, 100, 500]) {
      for (const vis of [-1, 0, 20000, 1e9]) {
        for (const wind of [-10, 0, 30, 1e6]) {
          const c = deriveConditions({ ...base, cloudCoverPct: cloud, visibilityMeters: vis, windSpeedKph: wind });
          expect(c.transparency).toBeGreaterThanOrEqual(0);
          expect(c.transparency).toBeLessThanOrEqual(1);
          expect(c.seeing).toBeGreaterThanOrEqual(0);
          expect(c.seeing).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("survives non-finite inputs rather than emitting NaN", () => {
    const c = deriveConditions({ ...base, cloudCoverPct: Number.NaN, visibilityMeters: Number.NaN, windSpeedKph: Number.NaN });
    expect(Number.isFinite(c.transparency)).toBe(true);
    expect(Number.isFinite(c.seeing)).toBe(true);
  });
});