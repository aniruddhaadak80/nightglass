/**
 * Route handler helpers.
 *
 * One place that turns a service result into an HTTP response, so every route
 * reports the same error envelope and the same status codes.
 */

import { NextResponse } from "next/server";
import { isApiError, statusForError } from "./service";
import { OWNER_COOKIE, OWNER_COOKIE_OPTIONS, resolveSession, type SessionOwner } from "./session";
import type { ApiError } from "./types";

export const PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/**
 * Resolve the anonymous session and make sure the scope cookie is set on the
 * outgoing response.
 *
 * The cookie is what decides row ownership. It is minted on the first request
 * that needs it and never accepted from a request body or query string.
 *
 * `attach` returns the response it was given so a handler can pass a
 * `NextResponse` through and still set the cookie. Plain `Response` objects
 * cannot carry cookies, so handlers that need a session must build their
 * response with `NextResponse`.
 */
export async function withSession(): Promise<{
  session: SessionOwner;
  attach: <R extends NextResponse>(res: R) => R;
}> {
  const session = await resolveSession();
  const attach = <R extends NextResponse>(res: R): R => {
    if (session.isNew) {
      res.cookies.set(OWNER_COOKIE, session.ownerId, OWNER_COOKIE_OPTIONS);
    }
    return res;
  };
  return { session, attach };
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data as object, { status });
}

export function fromResult<T>(result: T | ApiError, attach?: <R extends NextResponse>(res: R) => R): NextResponse {
  if (isApiError(result)) {
    const res = NextResponse.json(result, { status: statusForError(result.error.code) });
    return attach ? attach(res) : res;
  }
  const res = ok(result);
  return attach ? attach(res) : res;
}

export function failResult(code: Parameters<typeof statusForError>[0], message: string): NextResponse {
  const error: ApiError = { error: { code, message } };
  return NextResponse.json(error, { status: statusForError(code) });
}

/**
 * Read `limit`/`offset` from a URL, clamped to a sane range.
 *
 * `Number(null)` is `0`, not `NaN`, so a missing parameter would otherwise sail
 * past an `isFinite` guard and clamp down to a single row. An absent or blank
 * value therefore has to be detected explicitly, or every endpoint without an
 * explicit limit silently returns one record.
 */
export function readPaging(url: string): { limit: number; offset: number } {
  const params = new URL(url).searchParams;

  const limitParam = params.get("limit");
  const limitParsed = limitParam === null || limitParam.trim() === "" ? Number.NaN : Number(limitParam);
  const limit = Number.isFinite(limitParsed)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(limitParsed)))
    : PAGE_SIZE;

  const offsetParam = params.get("offset");
  const offsetParsed = offsetParam === null || offsetParam.trim() === "" ? Number.NaN : Number(offsetParam);
  const offset = Number.isFinite(offsetParsed) ? Math.max(0, Math.trunc(offsetParsed)) : 0;

  return { limit, offset };
}

/** Parse a JSON body, returning null when it is absent or unparseable. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    const text = await request.text();
    if (!text) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}