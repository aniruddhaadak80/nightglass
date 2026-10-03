/**
 * Anonymous session ownership.
 *
 * nightglass has no accounts. Every visitor owns their plans and observations
 * through an HTTP-only, SameSite=Lax cookie holding an unguessable scope id.
 * The cookie is the only thing that decides row ownership, and the server never
 * trusts an owner id supplied in a request body.
 */

import { cookies } from "next/headers";
import { randomBytes, timingSafeEqual } from "node:crypto";

export const OWNER_COOKIE = "ng_scope";
const OWNER_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export const OWNER_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function isValidOwner(value: unknown): value is string {
  return typeof value === "string" && OWNER_PATTERN.test(value);
}

export function newOwnerId(): string {
  return randomBytes(24).toString("base64url");
}

export interface SessionOwner {
  ownerId: string;
  isNew: boolean;
}

/**
 * Read the current session scope, minting one if absent. The caller sets the
 * cookie on first visit.
 */
export async function resolveSession(): Promise<SessionOwner> {
  const jar = await cookies();
  const existing = jar.get(OWNER_COOKIE)?.value;
  if (isValidOwner(existing)) return { ownerId: existing, isNew: false };
  return { ownerId: newOwnerId(), isNew: true };
}

export const OWNER_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: OWNER_TTL_SECONDS,
} as const;

/**
 * Constant-time comparison of an optional client-supplied scope against the
 * real one. Used by the MCP endpoint, where a client may echo its scope.
 */
export function scopeMatches(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}