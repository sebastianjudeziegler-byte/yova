import { expect, test } from "@playwright/test";
import { addManual, closeDetail, FIXED_NOW, openCalendar, openPreviewCalendar, quickDraft, seedCalendarAuthority, showWeek, storedManualEvents } from "./helpers/calendar";

test.use({ timezoneId: "Europe/London" });
test.beforeEach(async ({ page }) => openPreviewCalendar(page));

test("a failed browser save keeps the draft and retry creates one event", async ({ page }) => {
  const draft = await quickDraft(page, "Meet tutor Friday at 2pm for 30 minutes");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "yova.calendar.prototype.v1") throw new DOMException("Storage is full", "QuotaExceededError");
      original.call(this, key, value);
    };
    Object.assign(window, { restoreCalendarStorage: () => { Storage.prototype.setItem = original; } });
  });
  await draft.getByRole("button", { name: "Save to calendar", exact: true }).click();
  await expect(draft.getByRole("alert")).toContainText("could not be saved");
  await expect(draft.getByLabel("Title")).toHaveValue("Meet Tutor");
  expect(await storedManualEvents(page)).toHaveLength(0);
  await page.evaluate(() => (window as unknown as {restoreCalendarStorage: () => void}).restoreCalendarStorage());
  await draft.getByRole("button", { name: "Save to calendar", exact: true }).click();
  await expect(page.locator(".calendar-block-detail h2")).toHaveText("Meet Tutor");
  expect(await storedManualEvents(page)).toHaveLength(1);
});

test("an adjustment is rechecked when another tab changes destination availability", async ({ page, context }) => {
  await seedCalendarAuthority(page);
  await page.reload(); await openCalendar(page);
  const adjustment = page.locator(".agenda-adjustment-tools");
  await adjustment.locator("summary").click();
  await adjustment.getByLabel("Minutes available today").fill("0");
  await adjustment.getByRole("button", { name: "Review options" }).click();
  await expect(adjustment).toContainText("To: Thu, Sep 3, 6:00 PM");
  const other = await context.newPage();
  await other.clock.setFixedTime(FIXED_NOW);
  await other.goto("/?qa=preview"); await openCalendar(other);
  // Represents a saved zero-availability setting in the other tab.
  await other.evaluate(() => {
    const key = "yova.calendar.prototype.v1";
    const state = JSON.parse(localStorage.getItem(key)!);
    const account = Object.values(state.accounts)[0] as { availabilityOverrides: unknown[] };
    account.availabilityOverrides.push({dateKey:"2026-09-03", availableMinutes:0, reason:"No study time", updatedAt:new Date().toISOString()});
    localStorage.setItem(key, JSON.stringify(state));
  });
  await adjustment.getByRole("button", { name: "Approve change" }).click();
  await expect(page.locator(".calendar-action-error")).toContainText("calendar changed after this proposal");
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem("yova.preview.v1")!).plans[0].sessions[0].scheduledFor);
  expect(original).toBe("2026-09-02T17:00:00.000Z");
  await adjustment.getByRole("button", { name: "Review options" }).click();
  await expect(adjustment).toContainText("To: Fri, Sep 4, 6:00 PM");
  await other.close();
});

test("completion can be undone without closing the event details", async ({ page }) => {
  await addManual(page, "Read textbook", "2026-09-03T14:00");
  const detail = page.locator(".calendar-block-detail");
  await detail.getByRole("button", { name: "Mark done", exact: true }).click();
  await expect(detail.getByRole("button", { name: "Mark open", exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Undo calendar change" }).click();
  await expect(detail.getByRole("button", { name: "Mark done", exact: true })).toBeVisible();
  expect((await storedManualEvents(page))[0].done).toBe(false);
});

test("visual review of Agenda, event editor and overlapping Week blocks", async ({ page }, testInfo) => {
  await addManual(page, "Chemistry lecture", "2026-09-03T14:00", "60", "class");
  await addManual(page, "Study group with Maya", "2026-09-03T14:30", "45");
  await closeDetail(page);
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(page.locator(".calendar-agenda")).toBeVisible();
  await page.locator(".calendar-board").scrollIntoViewIfNeeded();
  await page.screenshot({ animations: "disabled", path: `docs/audits/2026-09-06-calendar/evidence/${testInfo.project.name}-fixed-agenda.png` });
  await page.getByRole("button", { name: /^Study group with Maya, / }).click();
  await page.locator(".calendar-block-detail").getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeInViewport();
  await page.screenshot({ animations: "disabled", path: `docs/audits/2026-09-06-calendar/evidence/${testInfo.project.name}-fixed-editor.png` });
  await closeDetail(page); await showWeek(page);
  await page.getByRole("button", { name: /^Chemistry lecture, / }).scrollIntoViewIfNeeded();
  await page.screenshot({ animations: "disabled", path: `docs/audits/2026-09-06-calendar/evidence/${testInfo.project.name}-fixed-week.png` });
});
