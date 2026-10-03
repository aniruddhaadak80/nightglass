import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/config/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["/", "/tonight", "/catalogue", "/log", "/method", "/agent", "/export", "/settings", "/verify"];
  const lastModified = new Date();

  return routes.map((route) => ({
    url: absoluteUrl(route),
    lastModified,
    changeFrequency: route === "/" ? "daily" : "weekly",
    priority: route === "/" ? 1 : route === "/tonight" ? 0.9 : 0.5,
  }));
}