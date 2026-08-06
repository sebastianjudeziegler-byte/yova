import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/sora/600.css";
import "@fontsource/sora/700.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { getSiteUrl } from "@/lib/site-url";

const title = "YOVA Lite · Know What to Study Next";
const description = "YOVA builds personalized study plans and guided sessions around your goal, materials, schedule, habits, and progress.";

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title,
  description,
  applicationName: "YOVA",
  category: "education",
  keywords: ["personalized study plan", "AI study coach", "guided study sessions", "active recall", "learning planner"],
  alternates: {
    canonical: "/",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: "YOVA",
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: "#0B1020",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
