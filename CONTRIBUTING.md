# Contributing to nightglass

Thanks for considering a contribution. This is a small project with a specific
standard: **every claim in the interface has to be true.**

## The one rule

If a number appears in the UI, a reader must be able to find out where it came
from. If a button exists, it must do the thing it says. If data is labelled
`live`, it was fetched from the upstream this minute; if it is labelled
`fallback`, the UI must say why.

That is why scores carry a `factors` array with the measured quantity behind
each one, and why the feed response carries `status` and `degradedReason`.

## Getting set up

```bash
git clone https://github.com/aniruddhaadak80/nightglass
cd nightglass
npm install
npm run dev
```

No environment variables are required. With no `DATABASE_URL` the app uses an
embedded PGlite database created in memory on first run.

## Before you open a pull request

```bash
npm run check
```

That runs, in order:

| Command | What it proves |
| --- | --- |
| `npm run typecheck` | Strict TypeScript, no `any` escapes |
| `npm run lint` | ESLint, including the React purity rules |
| `npm test` | 116 unit tests, including the astronomy invariants |
| `npm run build` | The production build compiles |

Then run it against a real deployment if your change touches data:

```bash
BASE_URL=https://nightglass.vercel.app npm run verify:live
```

## Where things live

| Path | Responsibility |
| --- | --- |
| `src/lib/astro.ts` | Ephemerides, sidereal time, horizon geometry, twilight |
| `src/lib/engine.ts` | The observability score and its six factors |
| `src/lib/integrity.ts` | Canonical JSON and the SHA-384 chain |
| `src/lib/repository.ts` | Neon and PGlite behind one interface |
| `src/lib/service.ts` | The only code path for create, rank, decide, log |
| `src/lib/feed.ts` | Open-Meteo and VizieR, with honest fallback labelling |
| `src/app/api/mcp/route.ts` | JSON-RPC 2.0 tools |
| `desktop/` | The Electron shell |

If you change the engine, bump `ENGINE_VERSION` in `src/lib/engine.ts`. Scores
carry it, so a stored score always says which rules produced it.

## Tests that matter

The astronomy tests assert properties, not snapshots. They check that Polaris
sits at your latitude to within its real 0.74° offset from the pole, that a full
synodic month contains both a new and a full moon, and that lunar elongation and
illuminated fraction agree with each other across a whole cycle. Please keep them
that way — a hard-coded coordinate is a claim nobody can check.

## Reporting a bug

Open an issue with what you expected, what happened, and your site (latitude,
longitude, Bortle class, obstruction) if the numbers looked wrong. A screenshot
of the score plate with a factor expanded is the most useful thing you can
attach.

## Security

Please read [SECURITY.md](SECURITY.md) before reporting a vulnerability.

## Licence

MIT. See [LICENSE](LICENSE).