/**
 * Single site configuration.
 *
 * The repository URL and the production URL are declared here once and read
 * from here everywhere: the shared header, the mobile menu, the landing CTA,
 * the shared footer, the OpenGraph metadata, the sitemap, and `public/mcp.json`.
 * Nothing else in the codebase hard-codes a repository or deployment URL.
 */

export const site = {
  name: "nightglass",
  /** Used in <title> and the masthead. */
  title: "nightglass",
  tagline: "Know what is worth observing tonight, and why.",
  description:
    "nightglass is an observatory plate for amateur astronomers. It pulls the real star and deep-sky catalogue, reads live cloud and transparency for your site, and ranks tonight's targets against your real horizon and your real instrument — every score traceable to a measured quantity.",

  /**
   * Canonical production origin. `SITE_URL` overrides it at build time so a
   * preview deployment does not advertise the production alias.
   */
  url: process.env.SITE_URL?.replace(/\/$/, "") ?? "https://nightglass-aniruddha-adaks-projects.vercel.app",

  repo: {
    owner: "aniruddhaadak80",
    name: "nightglass",
    url: "https://github.com/aniruddhaadak80/nightglass",
    /** Label reused by the header, the landing CTA and the footer. */
    cta: "Star on GitHub",
    issues: "https://github.com/aniruddhaadak80/nightglass/issues",
  },

  nav: [
    { href: "/tonight", label: "Tonight" },
    { href: "/catalogue", label: "Catalogue" },
    { href: "/log", label: "Log" },
    { href: "/method", label: "Method" },
    { href: "/agent", label: "Agent" },
    { href: "/export", label: "Export" },
    { href: "/settings", label: "Settings" },
  ],

  /**
   * Default observing site used by the landing page so the first paint shows a
   * real computed verdict rather than an empty state. A visitor can change it
   * in Settings.
   */
  defaultSite: {
    name: "Your balcony",
    latitudeDeg: 28.6139,
    longitudeDeg: 77.209,
    bortle: 7 as const,
    horizonDeg: 15,
    timezone: "auto",
  },

  defaultInstrument: {
    name: "200 mm Newtonian",
    apertureMm: 200,
    magnification: 120,
    type: "reflector" as const,
  },

  engineVersion: "2026.1.0",

  license: "MIT",
} as const;

export type NavItem = (typeof site.nav)[number];

/** Absolute URL for a site-relative path, honouring the configured origin. */
export function absoluteUrl(path: string): string {
  return `${site.url}${path.startsWith("/") ? path : `/${path}`}`;
}