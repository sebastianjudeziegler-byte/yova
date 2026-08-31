import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/site-url", () => ({
  getSiteUrl: () => new URL(process.env.SITE_URL ?? "http://localhost:3000"),
}));

import robots from "./robots";
import sitemap from "./sitemap";

const originalSiteUrl = process.env.SITE_URL;
const originalVercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;

afterEach(() => {
  if (originalSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = originalSiteUrl;

  if (originalVercelProductionUrl === undefined) {
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  } else {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = originalVercelProductionUrl;
  }
});

describe("public crawler metadata routes", () => {
  it("emits the public pages under the configured customer-facing origin", () => {
    process.env.SITE_URL = "https://www.yovaapp.com";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "yova-roan.vercel.app";

    expect(sitemap().map(({ url }) => url)).toEqual([
      "https://www.yovaapp.com/",
      "https://www.yovaapp.com/study-profile",
      "https://www.yovaapp.com/support",
      "https://www.yovaapp.com/privacy",
      "https://www.yovaapp.com/terms",
    ]);
    expect(robots()).toMatchObject({
      host: "https://www.yovaapp.com",
      sitemap: "https://www.yovaapp.com/sitemap.xml",
      rules: {
        disallow: ["/api/", "/auth/"],
      },
    });
  });
});
