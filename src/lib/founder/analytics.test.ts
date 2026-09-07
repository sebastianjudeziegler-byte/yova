import { describe, expect, it } from "vitest";
import {
  FOUNDER_ANALYTICS_WINDOWS,
  parseFounderAnalyticsWindow,
  safeRate,
} from "@/lib/founder/analytics";

describe("founder analytics helpers", () => {
  it("accepts only the dashboard's bounded date windows", () => {
    for (const days of FOUNDER_ANALYTICS_WINDOWS) {
      expect(parseFounderAnalyticsWindow(String(days))).toBe(days);
    }
    expect(parseFounderAnalyticsWindow("365")).toBe(30);
    expect(parseFounderAnalyticsWindow("anything")).toBe(30);
    expect(parseFounderAnalyticsWindow(undefined)).toBe(30);
  });

  it("uses the first value when a query parameter repeats", () => {
    expect(parseFounderAnalyticsWindow(["7", "90"])).toBe(7);
  });

  it("returns stable one-decimal conversion rates", () => {
    expect(safeRate(2, 3)).toBe(66.7);
    expect(safeRate(0, 0)).toBe(0);
  });
});
