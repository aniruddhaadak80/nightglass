"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { site } from "@/config/site";
import { GitHubMark } from "./github-mark";

/**
 * Shared header.
 *
 * The repository URL comes from the single site configuration module and is
 * rendered in both the desktop bar and the mobile menu, so a visitor on a phone
 * has the same route to the source as one on a desktop.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-brass-500/25 bg-verdigris-950/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="group flex items-baseline gap-2" aria-label="nightglass home">
          <span className="font-display text-xl tracking-tight text-bone-100">nightglass</span>
          <span className="hidden text-[0.6rem] uppercase tracking-[0.22em] text-brass-400 sm:inline">
            observatory
          </span>
        </Link>

        <nav aria-label="Primary" className="ml-auto hidden items-center gap-1 lg:flex">
          {site.nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`px-2.5 py-1.5 text-[0.7rem] uppercase tracking-[0.12em] transition-colors ${
                  active
                    ? "border-b border-brass-400 text-brass-300"
                    : "text-bone-300 hover:border-b hover:border-brass-500/60 hover:text-bone-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <a
          href={site.repo.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto hidden items-center gap-2 border border-brass-500/40 px-2.5 py-1.5 text-[0.7rem] uppercase tracking-[0.12em] text-brass-300 transition-colors hover:border-brass-400 hover:bg-brass-500/10 lg:ml-0 lg:inline-flex"
        >
          <GitHubMark size={14} />
          {site.repo.cta}
        </a>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="ml-auto inline-flex items-center gap-2 border border-brass-500/40 px-2.5 py-1.5 text-[0.7rem] uppercase tracking-[0.12em] text-brass-300 lg:hidden"
        >
          {open ? <X size={14} aria-hidden="true" /> : <Menu size={14} aria-hidden="true" />}
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          Menu
        </button>
      </div>

      {open ? (
        <nav
          id="mobile-nav"
          aria-label="Primary mobile"
          className="border-t border-brass-500/20 bg-verdigris-950 lg:hidden"
        >
          <ul className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
            {site.nav.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`block border-b border-brass-500/10 py-2.5 text-[0.75rem] uppercase tracking-[0.12em] ${
                      active ? "text-brass-300" : "text-bone-300"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
            <li className="pt-3">
              <a
                href={site.repo.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-2 text-[0.75rem] uppercase tracking-[0.12em] text-brass-300"
              >
                <GitHubMark size={14} />
                {site.repo.cta}
              </a>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}