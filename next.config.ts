import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

const localNetworkOrigins = Object.values(networkInterfaces())
  .flat()
  .filter((network): network is NonNullable<typeof network> => Boolean(network))
  .filter((network) => network.family === "IPv4" && !network.internal)
  .map((network) => network.address);

const securityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const privateStudyProfileReportHeaders = [
  {
    key: "Cache-Control",
    value: "private, no-store, max-age=0",
  },
  {
    key: "Referrer-Policy",
    value: "no-referrer",
  },
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow, noarchive, nosnippet",
  },
];

if (process.env.NODE_ENV === "production") {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=31536000",
  });
}

const nextConfig: NextConfig = {
  distDir: process.env.YOVA_E2E === "1" ? ".next-e2e" : ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: ["localhost", "127.0.0.1", ...localNetworkOrigins],
  devIndicators: {
    position: "top-right",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      // The assessment replaces this document's URL with the private report
      // path after saving. Attach no-referrer to the original response so the
      // bearer token can never enter a later request's Referer header.
      {
        source: "/study-profile",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      // These paths contain or return a private bearer-token report. Keep the
      // scoped rules after the global rule so Referrer-Policy is overridden.
      {
        source: "/study-profile/report/:token",
        headers: privateStudyProfileReportHeaders,
      },
      {
        source: "/api/study-profile/reports/:token",
        headers: privateStudyProfileReportHeaders,
      },
      {
        source: "/api/study-profile/interest/:token",
        headers: privateStudyProfileReportHeaders,
      },
      {
        source: "/study-profile/waitlist/confirm",
        headers: privateStudyProfileReportHeaders,
      },
      {
        source: "/api/study-profile/waitlist/confirm",
        headers: privateStudyProfileReportHeaders,
      },
    ];
  },
};

export default nextConfig;
