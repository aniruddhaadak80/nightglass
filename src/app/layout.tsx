import type { Metadata, Viewport } from "next";
import { Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import { absoluteUrl, site } from "@/config/site";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument-serif",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — ${site.tagline}`,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  keywords: [
    "astronomy",
    "stargazing",
    "observing planner",
    "limiting magnitude",
    "dark sky",
    "Bortle scale",
    "Messier",
    "star catalogue",
    "MCP agent",
  ],
  authors: [{ name: "aniruddhaadak80", url: site.repo.url }],
  creator: "aniruddhaadak80",
  alternates: { canonical: absoluteUrl("/") },
  openGraph: {
    type: "website",
    url: site.url,
    siteName: site.name,
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    creator: "@aniruddhaadak80",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  category: "science",
};

export const viewport: Viewport = {
  themeColor: "#0b2b2a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="flex min-h-screen flex-col">
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}