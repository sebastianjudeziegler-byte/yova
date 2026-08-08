import { describe, expect, it } from "vitest";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";

describe("isDevelopmentPreviewRequest", () => {
  it("allows the explicit local QA preview only during development", () => {
    const request = new Request("http://localhost:3000/api/plans/generate", {
      headers: { referer: "http://localhost:3000/?qa=preview" },
    });

    expect(isDevelopmentPreviewRequest(request, "development")).toBe(true);
    expect(isDevelopmentPreviewRequest(request, "production")).toBe(false);
  });

  it("does not trust the preview query on a non-local referrer", () => {
    const request = new Request("http://localhost:3000/api/plans/generate", {
      headers: { referer: "https://example.com/?qa=preview" },
    });

    expect(isDevelopmentPreviewRequest(request, "development")).toBe(false);
  });

  it("allows the plan creator preview header only during development", () => {
    const request = new Request("http://192.168.1.10:3000/api/plans/activate", {
      headers: { "X-Yova-Development-Preview": "plan-creator" },
    });

    expect(isDevelopmentPreviewRequest(request, "development")).toBe(true);
    expect(isDevelopmentPreviewRequest(request, "production")).toBe(false);
  });
});
