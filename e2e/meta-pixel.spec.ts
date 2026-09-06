import { expect, test, type Page } from "@playwright/test";

const productionPixelMode = process.env.YOVA_E2E_META_PIXEL === "1";
const testPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() ?? "";

test.describe("production Meta Pixel boundary", () => {
  test.skip(!productionPixelMode, "Runs against a production build with a test Pixel ID.");
  test.skip(!/^\d{5,32}$/u.test(testPixelId), "Set a numeric test Pixel ID.");

  test("loads once, sanitizes the page address, and ignores same-route quiz steps", async ({ page }) => {
    const events: unknown[][] = [];
    let libraryRequests = 0;
    await page.exposeFunction("__recordYovaMetaEvent", (...args: unknown[]) => {
      events.push(args);
    });
    await installFakeMetaLibrary(page, () => {
      libraryRequests += 1;
    });

    await page.goto(
      "/study-profile?utm_source=instagram&utm_medium=paid_social&utm_campaign=study_profile_quiz&utm_content=static_v1&utm_term=student_planner&fbclid=meta_click_e2e&customer_email=student%40example.com#private-fragment",
    );

    await expect.poll(() => metaEvents(events, "PageView")).toHaveLength(1);
    expect(libraryRequests).toBe(1);
    expect(events.filter((entry) => entry[0] === "init")).toEqual([
      ["init", testPixelId],
    ]);
    const visibleUrl = new URL(page.url());
    expect(visibleUrl.hash).toBe("");
    expect(visibleUrl.searchParams.get("customer_email")).toBeNull();
    expect(visibleUrl.searchParams.get("utm_source")).toBe("instagram");
    expect(visibleUrl.searchParams.get("fbclid")).toBe("meta_click_e2e");

    await page.getByRole("button", { name: "Get my free study profile" }).first().click();
    await page
      .getByRole("radiogroup", { name: "Answers for question 1" })
      .getByRole("radio")
      .first()
      .click();
    await page.waitForTimeout(100);

    expect(metaEvents(events, "PageView")).toHaveLength(1);
    expect(libraryRequests).toBe(1);

    await page.evaluate(() => {
      window.history.pushState(null, "", "/study-profile/waitlist/confirm");
    });
    await expect.poll(() => metaEvents(events, "PageView")).toHaveLength(2);
    expect(libraryRequests).toBe(1);

    await page.evaluate(() => {
      window.history.pushState(null, "", "/study-profile/waitlist/confirm?ignored=1");
    });
    await page.waitForTimeout(100);
    expect(metaEvents(events, "PageView")).toHaveLength(2);
  });

  test("never initializes on a private report route", async ({ page }) => {
    let libraryRequests = 0;
    await installFakeMetaLibrary(page, () => {
      libraryRequests += 1;
    });

    await page.goto(`/study-profile/report/${"a".repeat(43)}`);
    await page.waitForTimeout(200);

    expect(libraryRequests).toBe(0);
    expect(await page.evaluate(() => window.__yovaMetaPixelConfigured === true))
      .toBe(false);
  });

  test("never initializes outside the explicit public route allowlist", async ({ page }) => {
    let libraryRequests = 0;
    await installFakeMetaLibrary(page, () => {
      libraryRequests += 1;
    });

    for (const pathname of [
      "/",
      "/study-profile/setup",
      "/study-profile/setup/preferences",
      "/study-profile-evil",
    ]) {
      await page.goto(pathname);
      await page.waitForTimeout(100);
      expect(libraryRequests).toBe(0);
      expect(await page.evaluate(() => window.__yovaMetaPixelConfigured === true))
        .toBe(false);
    }
  });

  test("unloads Meta before opening a non-measurement page", async ({ page }) => {
    const events: unknown[][] = [];
    let libraryRequests = 0;
    await page.exposeFunction("__recordYovaMetaEvent", (...args: unknown[]) => {
      events.push(args);
    });
    await installFakeMetaLibrary(page, () => {
      libraryRequests += 1;
    });

    await page.goto("/study-profile");
    await expect.poll(() => metaEvents(events, "PageView")).toHaveLength(1);
    await page.getByRole("link", { name: "Privacy", exact: true }).click();

    await expect(page).toHaveURL(/\/privacy$/u);
    expect(libraryRequests).toBe(1);
    expect(await page.evaluate(() => window.__yovaMetaPixelConfigured === true))
      .toBe(false);
  });

  test("emits Lead after a confirmed save and unloads Meta before the report", async ({ page }) => {
    test.setTimeout(90_000);
    const events: unknown[][] = [];
    const responseVisitorIds: string[] = [];
    const reportViewVisitorIds: string[] = [];
    let libraryRequests = 0;
    await page.exposeFunction("__recordYovaMetaEvent", (...args: unknown[]) => {
      events.push(args);
    });
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      let body: Record<string, unknown>;
      try {
        body = request.postDataJSON() as Record<string, unknown>;
      } catch {
        return;
      }
      const pathname = new URL(request.url()).pathname;
      if (pathname === "/api/study-profile/responses" && typeof body.visitorId === "string") {
        responseVisitorIds.push(body.visitorId);
      }
      if (
        pathname === "/api/study-profile/events"
        && body.eventName === "study_profile_report_viewed"
        && typeof body.visitorId === "string"
      ) {
        reportViewVisitorIds.push(body.visitorId);
      }
    });
    await installFakeMetaLibrary(page, () => {
      libraryRequests += 1;
    });

    await page.goto(
      "/study-profile?utm_source=instagram&utm_medium=paid_social&utm_campaign=study_profile_quiz&utm_content=static_v1&fbclid=meta_click_e2e",
    );
    await expect.poll(() => metaEvents(events, "PageView")).toHaveLength(1);
    await page.getByRole("button", { name: "Get my free study profile" }).first().click();
    for (let question = 1; question <= 12; question += 1) {
      await page
        .getByRole("radiogroup", { name: `Answers for question ${question}` })
        .getByRole("radio")
        .first()
        .click();
    }
    await page.getByRole("button", { name: /^Exams coming up/ }).click();
    await page.getByRole("button", { name: "Morning", exact: true }).click();
    await page.getByRole("button", { name: "High school", exact: true }).click();
    await page.getByRole("button", { name: "Finish and unlock my results" }).click();
    await page.getByLabel("Email for your private report link")
      .fill(`meta-production-${Date.now()}@example.com`);
    await page.getByRole("checkbox", { name: "I confirm I am 13 or older." }).check();
    await page.getByRole("button", { name: "Email my report and see results" }).click();

    await expect(page).toHaveURL(/\/study-profile\/report\/[A-Za-z0-9_-]{32,}$/u);
    await expect.poll(() => metaEvents(events, "Lead")).toHaveLength(1);
    expect(metaEvents(events, "Lead")[0]).toMatchObject([
      "track",
      "Lead",
      { content_name: "study_profile_report" },
      { eventID: expect.stringMatching(/^study_profile_report_[0-9a-f]{48}$/u) },
    ]);
    expect(metaEvents(events, "PageView")).toHaveLength(1);
    expect(libraryRequests).toBe(1);
    await expect.poll(() => reportViewVisitorIds).toHaveLength(1);
    expect(responseVisitorIds).toHaveLength(1);
    expect(reportViewVisitorIds[0]).toBe(responseVisitorIds[0]);
    await expect(page.locator("#report-title")).toBeFocused();
    await expect(page.getByText(
      "We could not send the email copy, so save this private link if you want to return.",
    )).toBeVisible();
  });

  test("emits CompleteRegistration only after confirmation succeeds", async ({ page }) => {
    const events: unknown[][] = [];
    let confirmationAttempts = 0;
    let releaseMetaLibrary: (() => void) | undefined;
    const metaLibraryGate = new Promise<void>((resolve) => {
      releaseMetaLibrary = resolve;
    });
    await page.exposeFunction("__recordYovaMetaEvent", (...args: unknown[]) => {
      events.push(args);
    });
    await installFakeMetaLibrary(page, () => {}, () => metaLibraryGate);
    await page.route("**/api/study-profile/waitlist/confirm", async (route) => {
      confirmationAttempts += 1;
      if (confirmationAttempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Temporary confirmation failure." }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ waitlistJoined: true }),
      });
    });

    await page.goto(
      `/study-profile/waitlist/confirm#token=${"c".repeat(43)}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect.poll(() => new URL(page.url()).hash).toBe("");
    expect(metaEvents(events, "CompleteRegistration")).toHaveLength(0);
    await page.getByRole("button", { name: "Confirm launch emails" }).click();

    await expect(page.getByText("Temporary confirmation failure.", { exact: true })).toBeVisible();
    expect(metaEvents(events, "CompleteRegistration")).toHaveLength(0);
    await page.getByRole("button", { name: "Confirm launch emails" }).click();

    await expect(page.getByRole("heading", {
      name: "You are on the YOVA waitlist.",
    })).toBeVisible();
    expect(metaEvents(events, "CompleteRegistration")).toHaveLength(0);
    releaseMetaLibrary?.();
    await expect.poll(() => metaEvents(events, "PageView")).toHaveLength(1);
    await expect.poll(() => metaEvents(events, "CompleteRegistration")).toHaveLength(1);
    expect(events.findIndex((entry) => entry[1] === "PageView"))
      .toBeLessThan(events.findIndex((entry) => entry[1] === "CompleteRegistration"));
    expect(metaEvents(events, "CompleteRegistration")[0]).toMatchObject([
      "track",
      "CompleteRegistration",
      { content_name: "waitlist" },
      { eventID: expect.stringMatching(/^study_profile_waitlist_[0-9a-f]{48}$/u) },
    ]);
  });
});

async function installFakeMetaLibrary(
  page: Page,
  onRequest: () => void,
  beforeFulfill: () => Promise<void> = () => Promise.resolve(),
) {
  await page.route("https://connect.facebook.net/en_US/fbevents.js", async (route) => {
    onRequest();
    await beforeFulfill();
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
        (() => {
          const queued = Array.isArray(window.fbq && window.fbq.queue)
            ? [...window.fbq.queue]
            : [];
          const deliver = (...args) => window.__recordYovaMetaEvent(...args);
          if (window.fbq) {
            window.fbq.callMethod = deliver;
            window.fbq.queue = [];
          }
          queued.forEach((args) => deliver(...args));
        })();
      `,
    });
  });
}

function metaEvents(events: unknown[][], eventName: string) {
  return events.filter((entry) => entry[0] === "track" && entry[1] === eventName);
}
