import Link from "next/link";
import { site } from "@/config/site";
import { GitHubMark } from "./github-mark";

/** Shared footer. The repository link comes from the same config as the header. */
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-20 border-t border-brass-500/25 bg-verdigris-950/60">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <p className="font-display text-2xl text-bone-100">nightglass</p>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-bone-400">{site.tagline}</p>
            <p className="mt-3 text-[0.7rem] uppercase tracking-[0.16em] text-brass-400">
              Engine {site.engineVersion}
            </p>
          </div>

          <nav aria-label="Footer routes">
            <p className="plate-caption">Routes</p>
            <ul className="mt-3 space-y-1.5">
              {site.nav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm text-bone-300 transition-colors hover:text-brass-300"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <p className="plate-caption">Project</p>
            <ul className="mt-3 space-y-1.5">
              <li>
                <a
                  href={site.repo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-brass-300 transition-colors hover:text-brass-200"
                >
                  <GitHubMark size={13} />
                  View source
                </a>
              </li>
              <li>
                <a
                  href={site.repo.issues}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-bone-300 transition-colors hover:text-brass-300"
                >
                  Issues
                </a>
              </li>
              <li>
                <a
                  href={`${site.url}/api/mcp`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-bone-300 transition-colors hover:text-brass-300"
                >
                  Agent endpoint
                </a>
              </li>
              <li>
                <a
                  href={`${site.url}/api/health`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-bone-300 transition-colors hover:text-brass-300"
                >
                  Health
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-brass-500/15 pt-5 text-[0.7rem] uppercase tracking-[0.12em] text-bone-400 sm:flex-row sm:items-center sm:justify-between">
          <p>
            MIT licensed · {year}
          </p>
          <p>
            Ephemerides: NOAA/Meeus · Data:{" "}
            <a
              href="https://open-meteo.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brass-400 hover:text-brass-300"
            >
              Open-Meteo
            </a>{" "}
            &amp;{" "}
            <a
              href="https://cdsarc.cds.unistra.fr/ftp/cats/V/50/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brass-400 hover:text-brass-300"
            >
              CDS VizieR
            </a>
          </p>
        </div>

        <p className="mt-4 max-w-3xl text-xs leading-relaxed text-bone-400/80">
          nightglass is a planning aid. Times and altitudes come from real ephemerides, but they do
          not replace looking up. Never point equipment at anything without checking the sky first.
        </p>
      </div>
    </footer>
  );
}