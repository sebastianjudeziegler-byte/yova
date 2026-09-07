import type { Page } from "@playwright/test";

/**
 * Canonical frozen instant for plan-scheduling browser tests.
 *
 * Wednesday 2 Sep 2026, 10:00 UTC (11:00 BST). Chosen so that:
 *  - "today" still has every default availability window ahead of it,
 *  - "next Friday" / "in two weeks" style goals resolve to stable dates,
 *  - the same value the calendar specs already freeze to (see helpers/calendar).
 *
 * Plan generation happens on the SERVER, so freezing `page.clock` alone is not
 * enough: the server would still schedule against real wall-clock time and the
 * session count would drift with the time of day CI runs. `freezePlanClock`
 * therefore also sends the instant as `X-Yova-Test-Now`, which the server
 * honours only for development-preview requests (NODE_ENV=development).
 */
export const PLAN_FIXED_NOW = new Date("2026-09-02T10:00:00.000Z");

export async function freezePlanClock(page: Page, at: Date = PLAN_FIXED_NOW) {
  await page.clock.setFixedTime(at);
  await page.context().setExtraHTTPHeaders({ "X-Yova-Test-Now": at.toISOString() });
}
