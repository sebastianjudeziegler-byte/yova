import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();

  return [
    { url: new URL("/", siteUrl).toString(), changeFrequency: "weekly", priority: 1 },
    { url: new URL("/study-profile", siteUrl).toString(), changeFrequency: "monthly", priority: 0.8 },
    { url: new URL("/support", siteUrl).toString(), changeFrequency: "monthly", priority: 0.6 },
    { url: new URL("/privacy", siteUrl).toString(), changeFrequency: "yearly", priority: 0.4 },
    { url: new URL("/terms", siteUrl).toString(), changeFrequency: "yearly", priority: 0.4 },
  ];
}
