import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test.describe("YOVA Study Profile private report compatibility", () => {
  test("keeps a saved token report available through the direct route and API", async ({ page }, testInfo) => {
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

    expect(submission.status()).toBe(201);
    const created = await submission.json() as {
      reportToken: string;
      reportUrl: string;
    };
    expect(created.reportToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);

    const reportUrl = new URL(created.reportUrl);
    expect(reportUrl.search).toBe("");
    expect(reportUrl.hash).toBe("");
    expect(decodeURIComponent(reportUrl.href)).not.toContain(email);

    const apiResponse = await page.request.get(
      `/api/study-profile/reports/${created.reportToken}`,
    );
    expect(apiResponse.status()).toBe(200);

    await page.goto(reportUrl.pathname);
    await expect(page.locator("#report-title")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(email);

    await page.reload();
    await expect(page).toHaveURL(reportUrl.pathname);
    await expect(page.locator("#report-title")).toBeVisible();

    await page.getByRole("link", { name: "Retake" }).click();
    await expect(page.getByRole("heading", {
      name: "Find out how you actually study.",
    })).toBeVisible();
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
