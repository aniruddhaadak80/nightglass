/**
 * Append-only integrity chain.
 *
 * Each audit event is sealed with:
 *     seal_n = SHA-384( UTF-8(prevSeal) || canonicalJson(event_n) )
 *
 * `canonicalJson` recursively sorts object keys so the byte representation is
 * stable regardless of property insertion order, which is what makes replay
 * verification meaningful across processes and machines.
 *
 * Chains are per-entity: every observation plan carries its own history that
 * starts from genesis and is independent of every other plan's.
 */

import { createHash } from "node:crypto";
import type { AuditEvent } from "./types";

/** 384 bits of zero, as hex. */
export const GENESIS_SEAL = "0".repeat(96);

/**
 * Deterministic JSON serialization: object keys sorted, no incidental
 * whitespace, arrays preserved in order, non-finite numbers normalised to
 * null so a NaN can never produce two different byte strings.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "number") {
    if (!Number.isFinite(value as number)) return "null";
    return JSON.stringify(value);
  }
  if (type === "boolean" || type === "string") return JSON.stringify(value);
  if (type === "undefined" || type === "function") return "null";
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(v)}`);
  }
  return `{${parts.join(",")}}`;
}

export function sha384Hex(input: string): string {
  return createHash("sha384").update(input, "utf8").digest("hex");
}

export function computeSeal(prevSeal: string, event: Omit<AuditEvent, "seal">): string {
  return sha384Hex(prevSeal + canonicalJson(event));
}

/** Build a fully sealed event, chaining from the given previous seal. */
export function sealEvent(prevSeal: string, event: Omit<AuditEvent, "seal">): AuditEvent {
  return { ...event, seal: computeSeal(prevSeal, event) };
}

export interface ReplayResult {
  ok: boolean;
  checked: number;
  firstBrokenAt: number | null;
  firstBrokenId: string | null;
  headSeal: string;
  reason: string | null;
}

export interface GroupedReplayResult {
  ok: boolean;
  chains: number;
  events: number;
  brokenChains: Array<{
    planId: string;
    firstBrokenAt: number | null;
    firstBrokenId: string | null;
    reason: string | null;
  }>;
  headSeal: string;
}

/**
 * Walk one chain in order and recompute every seal.
 *
 * Reports the first link that does not match, which is exactly the event an
 * operator needs to look at.
 */
export function replayChain(events: AuditEvent[]): ReplayResult {
  if (events.length === 0) {
    return {
      ok: true,
      checked: 0,
      firstBrokenAt: null,
      firstBrokenId: null,
      headSeal: GENESIS_SEAL,
      reason: null,
    };
  }

  let prev = GENESIS_SEAL;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev) continue;
    if (ev.prevSeal !== prev) {
      return {
        ok: false,
        checked: i,
        firstBrokenAt: i,
        firstBrokenId: ev.id,
        headSeal: prev,
        reason: `prevSeal mismatch at index ${i}: the chain was reordered or an event was removed.`,
      };
    }
    const expected = computeSeal(prev, {
      id: ev.id,
      planId: ev.planId,
      action: ev.action,
      payload: ev.payload,
      prevSeal: ev.prevSeal,
      createdAt: ev.createdAt,
    });
    if (expected !== ev.seal) {
      return {
        ok: false,
        checked: i,
        firstBrokenAt: i,
        firstBrokenId: ev.id,
        headSeal: prev,
        reason: `seal mismatch at index ${i}: this event's contents were altered after it was written.`,
      };
    }
    prev = ev.seal;
  }

  return {
    ok: true,
    checked: events.length,
    firstBrokenAt: null,
    firstBrokenId: null,
    headSeal: prev,
    reason: null,
  };
}

/**
 * Verify every per-entity chain in a mixed event list.
 *
 * Events are grouped by `planId` and each group replayed from genesis
 * independently, which is what per-entity chaining means.
 */
export function replayAllChains(events: AuditEvent[]): GroupedReplayResult {
  const groups = new Map<string, AuditEvent[]>();
  for (const ev of events) {
    const list = groups.get(ev.planId);
    if (list) list.push(ev);
    else groups.set(ev.planId, [ev]);
  }

  const brokenChains: GroupedReplayResult["brokenChains"] = [];
  let ok = true;
  let headSeal = GENESIS_SEAL;
  let total = 0;

  for (const [planId, list] of groups) {
    // Restore arrival order. Ties are broken by id so the ordering is total and
    // a replay is reproducible rather than dependent on database row order.
    const ordered = [...list].sort((a, b) => {
      if (a.createdAt < b.createdAt) return -1;
      if (a.createdAt > b.createdAt) return 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const result = replayChain(ordered);
    total += ordered.length;
    if (!result.ok) {
      ok = false;
      brokenChains.push({
        planId,
        firstBrokenAt: result.firstBrokenAt,
        firstBrokenId: result.firstBrokenId,
        reason: result.reason,
      });
    } else if (ordered.length > 0) {
      headSeal = ordered[ordered.length - 1]!.seal;
    }
  }

  return { ok, chains: groups.size, events: total, brokenChains, headSeal };
}