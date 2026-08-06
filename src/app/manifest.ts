import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "YOVA · Personalized Learning",
    short_name: "YOVA",
    description: "Know exactly what to study next with personalized plans and guided learning sessions.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F6F7FB",
    theme_color: "#0B1020",
    lang: "en-US",
    categories: ["education", "productivity"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
