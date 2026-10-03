# Security Policy

## Scope

nightglass stores very little: anonymous observation plans and an observing log,
owned by an unguessable scope id held in an HTTP-only cookie. There are no
accounts, no passwords and no personal data beyond the site coordinates a visitor
chooses to enter.

## Reporting a vulnerability

Email the maintainer or open a private security advisory on
[the repository](https://github.com/aniruddhaadak80/nightglass/security/advisories/new).

Please include what an attacker could achieve, and a reproduction if you have
one. You can expect an acknowledgement within a few days.

## What is already handled

| Concern | Handling |
| --- | --- |
| Row ownership | An HTTP-only, `SameSite=Lax` cookie holding 24 random bytes. The server never trusts an owner id from a request body or query string. |
| Cross-session reads | A plan belonging to another session returns `404`, not `403`, so ids cannot be probed for existence. |
| SQL injection | Every query is parameterised. The one interpolated value, the schema name, is validated against `^[a-z_][a-z0-9_]{0,62}$` before use. |
| XSS | React escapes by default. There is no `dangerouslySetInnerHTML` anywhere in the project, and no rendering of untrusted HTML. |
| Secrets in the client | No secret is ever sent to the browser. `DATABASE_URL` is read server-side only. |
| Secret leakage in errors | API errors carry a code and a message. Stack traces and environment variables are never returned. |
| Anonymous write abuse | Per-session write budget, 40 writes per 60 s. **This is best-effort on serverless** — it is per instance and resets on cold start. A production deployment that cares should put a hosted rate limiter in front of `/api/plans` and `/api/observations`. |
| Request size | Every collection is capped (200 targets per plan) and every string has a maximum length in the zod schemas. |
| Upstream requests | Both external calls are time-bounded (8 s) and retried at most once. |
| Desktop bridge | The Electron renderer runs with `contextIsolation`, `sandbox` and `nodeIntegration: false`. The preload exposes exactly three methods and no arbitrary channel. External links open in the system browser. |

## Deliberate limitations

- **The integrity chain is tamper-evident, not tamper-proof.** Anyone who can
  write to the database can rewrite the chain. It proves the history has not
  changed unexpectedly; it is not a signature.
- **Bortle class is self-reported.** It drives the light-pollution factor
  directly, so an optimistic entry produces optimistic scores. The UI states this
  on the Settings page.
- **Seeing is estimated** from wind speed and low cloud, not measured.
- **The desktop app loads a remote origin.** It trusts that deployment exactly as
  a browser would. The window does not grant the page any extra privilege beyond
  the three documented bridge methods.

## Observability safety

nightglass is a planning aid. It computes real ephemerides, but it is not a
substitute for looking up, and it must never be used to aim equipment without
direct observation. The footer and every exported session card carry this
warning.