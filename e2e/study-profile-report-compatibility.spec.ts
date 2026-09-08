import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test.describe("YOVA Study Profile private report compatibility", () => {
  test("keeps report credentials server-side until email confirmation", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const email = `report-compatibility-${testInfo.project.name}-${Date.now()}@example.com`;
    await page.goto("/study-profile");
    const origin = new URL(page.url()).origin;
    const submission = await page.request.post("/api/study-profile/responses", {
      headers: {
        Origin: origin,
        Referer: `${origin}/study-profile`,
      },
      data: {
        visitorId: randomUUID(),
        email,
        ageConfirmed: true,
        under18: false,
        answers: Object.fromEntries(
          Array.from({ length: 12 }, (_, index) => [
            `q${index + 1}`,
            ["a", "b", "c", "d"][index % 4],
          ]),
        ),
        metadata: {
          energyWindow: "afternoon",
          schoolLevel: "college",
          studyGoal: "upcoming_exams",
          hardestPart: null,
        },
        marketingConsent: false,
        waitlistConsent: true,
        attribution: {
          source: "playwright-report-compatibility",
          utmCampaign: "study-profile-release-integration",
        },
      },
    });

    expect(submission.status()).toBe(202);
    expect(submission.headers()["cache-control"]).toBe("no-store");
    const created = await submission.json() as Record<string, unknown>;
    expect(created).toEqual({ confirmationPending: true });
    expect(created).not.toHaveProperty("reportToken");
    expect(created).not.toHaveProperty("reportUrl");
    expect(created).not.toHaveProperty("report");
    expect(created).not.toHaveProperty("storedResponse");
    expect(JSON.stringify(created)).not.toContain(email);
  });

  test("keeps unknown-token failures generic through the API and report route", async ({ page, request }) => {
    const unknownToken = "a".repeat(43);
    const apiResponse = await request.get(`/api/study-profile/reports/${unknownToken}`);

    expect(apiResponse.status()).toBe(404);
    await expect(apiResponse.json()).resolves.toEqual({
      error: "This Study Profile report link is invalid or unavailable.",
    });

    const pageResponse = await page.goto(`/study-profile/report/${unknownToken}`);
    expect(pageResponse?.status()).toBe(404);
    await expect(page.getByRole("heading", {
      name: "That report link isn't available.",
    })).toBeVisible();
    await expect(page.getByRole("link", { name: "Take the Study Profile" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(unknownToken);
  });
});
