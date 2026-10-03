*This is a submission for the [Hacktoberfest Open-Source AI Challenge: Week 1](https://dev.to/challenges/hacktoberfest-week1-2026-10-05).*

> **A note on timing, because it matters for judging.** Week 1's theme is revealed at launch on **5 October**, and I am publishing ahead of that window. So this post is written against the *standing* prompt that governs all five challenges this month — **"build something with open-source AI at its core"** — and I have deliberately not pretended to know the theme. If the theme turns out to point somewhere nightglass does not reach, I would rather be honest about that than write a post that games a theme I have not seen.

## What I Built

**nightglass** is an observing planner for amateur astronomers. It answers one
question that most people answer badly every clear night:

> *What is actually worth pointing my telescope at tonight — and why?*

It is built for a specific person: the amateur who owns one telescope, has a
Bortle 7 sky, twenty degrees of tree line to the west, and maybe four usable
hours a night. That person is not short of targets. They are short of **arithmetic
nobody did**. The globular cluster never clears the roof. The galaxy is inside
the magnitude limit and still invisible because its surface brightness is too
low. The Moon is 90% lit and quietly ruins everything.

So nightglass does that arithmetic in the open. It fetches the real Bright Star
Catalogue from the CDS, reads live cloud cover and transparency from Open-Meteo
for your exact coordinates, finds your astronomical night by integrating the
Sun's altitude and bisecting onto the exact −18° crossing, samples each target's
true altitude across that window, and ranks the sky against **your** horizon and
**your** aperture. Every score shows the measurement behind it.

It runs in a browser and as a desktop app for macOS, Windows and Linux.

**Live:** https://nightglass-aniruddha-adaks-projects.vercel.app

## Demo

The best demonstration is the thing the product exists to show. On `/tonight`:

1. The top-left control is your **horizon obstruction** — how high your trees or
   roof actually are. Drag it and the entire ranking re-cuts, because that
   number is scored against, not animated around.
2. Select any target and expand a factor. You get the measured quantity in
   plain language, not a percentage with no provenance: *"Never clears your 20°
   obstruction — trees or a roof line put it out of reach tonight."*
3. Save the plan, set **observe** or **skip**, export the session card, then
   replay the audit chain.

![The ranked sky for a real site, with live conditions and the obstruction control](https://raw.githubusercontent.com/aniruddhaadak80/nightglass/main/docs/screenshot-tonight.png)

The altitude frame is the signature interaction. The horizontal bands are 0° to
90° of true altitude. The brass curve is the target's *actual* computed altitude
across the night. Everything below your obstruction is hatched out in red,
because nothing down there is observable — and a target that never clears it is
hard-gated into the "blocked" band no matter how clear the sky is.

## Code

**Repository:** https://github.com/aniruddhaadak80/nightglass

MIT licensed. `npm install && npm run dev` — no API keys, no accounts, no
database to stand up. With no `DATABASE_URL` it runs on an embedded PGlite
database, and the same adapter runs the test suite.

## How I Built It

The honest framing first: **nightglass does not call a hosted LLM, and I did not
want it to.** The open-source AI at its core is the **agent layer**.

**The open agent surface is the product.** nightglass speaks
[MCP](https://modelcontextprotocol.io) — an open protocol — over JSON-RPC 2.0 at
`/api/mcp`, with eight tools: read a night, search the catalogue, score an
object, create a plan, decide a target, log an observation, replay the chain.
Any MCP client can drive it. There is a live console at `/agent` where the
presets are real calls, not mock responses.

```json
{ "mcpServers": { "nightglass": { "type": "http",
  "url": "https://nightglass-aniruddha-adaks-projects.vercel.app/api/mcp" } } }
```

Three of those tools mutate. They go through **the same service functions the
browser buttons call**, so a plan an agent creates and a plan a person creates
land in the same table with the same audit chain. That was a deliberate
constraint: one code path means the agent and the UI cannot drift apart.

**The engine is open, deterministic, and inspectable.** `nightglass-engine
v2026.1.0` is a pure function: same inputs, same numbers, forever. Six weighted
factors summing to exactly 1, so the score reads directly as "this many points
came from that". It uses real ephemerides — the GMST series, the NOAA solar
algorithm, Meeus's truncated ELP lunar series, Bennett refraction — and the
astronomy is tested against *properties* rather than snapshots: that Polaris
sits at your latitude to within its real 0.74° offset from the pole, that a full
synodic month contains both a new and a full moon, that lunar elongation and
illuminated fraction agree with each other across a whole cycle.

Two places where the obvious implementation is wrong, and being able to see *why*
is the payoff of doing it in the open:

- **Seeing is modelled as a floor plus a power law, not a product.** The obvious
  `tolerance × air` gives a large target a higher baseline, so the same gust of
  bad air costs it *more* points than a small one. That is backwards. A globular
  cluster in mediocre seeing is still a globular cluster.
- **Extended objects split the reach factor 0.7 surface brightness / 0.3
  magnitude.** Integrated magnitude alone will happily tell you a mag 9 object
  spread over three degrees is easy. It is not.

**Every score is sealed.** `seal = SHA-384(UTF-8(prevSeal) ‖ canonicalJson(event))`,
chained per entity from a genesis value of 96 zeros, with canonical JSON sorting
keys recursively. The digest is pinned in the test suite against a hand-computed
vector, so a future change to key ordering fails CI instead of silently
invalidating every session card anyone exported. You can replay the chain and get
the first broken link.

**Live data, honestly labelled.** Bright stars come from the CDS Bright Star
Catalogue over the VizieR TAP protocol; conditions from Open-Meteo. Both are
keyless. When an upstream fails the response says `fallback` and gives the
reason — it never passes sample data off as live.

## Why Does Open Innovation Matter?

**Because the closed alternative would have made the product worse, not just
more expensive.** Three specific cases:

**1. A closed API would have replaced the one thing that must not be
hallucinated.** A model asked "what is M31's altitude at 22:14 from latitude
28.6°" will produce a fluent, plausible, wrong number. That is not a cosmetic
problem when the output is a decision about where to point a telescope at night.
Making the engine a closed, un-inspectable service would have made nightglass
strictly worse while looking identical on the surface. Keeping it as 400 lines
of commented TypeScript means a sceptical observer can read the maths and check
it — and my own test suite asserts the astronomy against physical invariants
rather than trusting it.

**2. Open data meant no key, which meant it works for anyone.** VizieR and
Open-Meteo are public and unauthenticated. Anyone can clone nightglass and have
a working planner in under a minute, with no signup wall and no bill. The
alternative — proxying both through a paid scraper API — would have added a key,
a cost, and a dependency on someone's uptime for a data set that is already
free and public domain.

**3. Open protocol meant the agent is not a vendor.** MCP is an open standard.
An agent that can drive nightglass today can drive it whatever model is behind
it, and nightglass does not care what model is behind *your* agent. Because the
mutating tools are scoped to an anonymous session cookie and are idempotent where
that is meaningful, an agent can retry safely without duplicating your log.

There is also the point that made me personally care: I could **check my own
sources**. I originally planned to pull deep-sky positions from VizieR's NGC/IC
table. When I queried it for objects whose positions I already knew, the
`RA1975`/`DEJ20050` columns did not round-trip — NGC 31 and NGC 81 came back with
coordinates that did not belong to them. So I dropped that source, kept the
Bright Star Catalogue (which stores J2000 directly and verified exactly against
reference values for Sirius, Canopus and Arcturus), and shipped a hand-reviewed
J2000 deep-sky sample instead, **labelled as bundled rather than live**. With a
closed API I would never have known to distrust it.

## What Is Not Done

I would rather list this than let a judge find it:

- **No open-weight model in the loop.** `@huggingface/transformers` was briefly a
  dependency and I removed it, because shipping an unused ML dependency that
  advertises local inference the product does not do is worse than not having it.
  The genuinely open-weight piece here is the ephemeris and catalogue data plus
  the open agent protocol, not a neural network.
- **Seeing is estimated** from wind speed and low cloud, not measured. This is
  the largest single source of error in the transparency factors.
- **Light pollution is only as good as the Bortle class you enter.** The UI says
  so on the Settings page.
- **The desktop installers are built by CI, not released yet.** The shell is
  written and the packaging config is committed, but I have only been able to
  verify the web build end to end; I have not run a signed macOS build.

## My Agent Session

This project was built with an open-source coding agent (opencode) working
through the repository. I have kept the session transcript available on request;
the interesting engineering decisions and the four real bugs are described
above, including the inverted bisection bracket and the `Number(null)` paging
bug that silently collapsed every list endpoint to one row.

## Prize Categories

I am **not** entering any partner prize category. nightglass does not use
Render, TabPFN, Tinker, Arduino, DigitalOcean, Gemma, Backboard, ElevenLabs,
Entire, GitHub Copilot, Mastra, MongoDB Atlas, SerpApi, Sentry, Temporal or Tiger
Data in any meaningful way, and listing a category I do not genuinely qualify for
would be a lie dressed up as a strategy.

If a future version adds an open-weight model for natural-language target
search — describing "something colourful and wide that's easy in a small scope"
and matching it against the catalogue — that would be a real use of TabPFN or
Gemma, and I would enter on the evidence.

---

Built with: Next.js 16, TypeScript strict, Tailwind 4, Neon Postgres, PGlite,
Electron, MCP. Data from CDS VizieR and Open-Meteo.

**nightglass is a planning aid, not a substitute for looking up.** Never point
equipment at anything without checking the sky.