import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMetaEventId,
  initializeMetaPixel,
  isMetaPixelRouteAllowed,
  isValidMetaPixelId,
  markMetaPixelFailed,
  markMetaPixelReady,
  metaSafeStudyProfilePath,
  shouldLoadMetaPixel,
  trackMetaConversionOnce,
  trackMetaPageViewOnce,
  waitForMetaPixelReady,
} from "@/lib/meta-pixel";

describe("Meta Pixel environment and route boundary", () => {
  it("loads only for a valid numeric ID in Vercel Production", () => {
    expect(isValidMetaPixelId("123456789012345")).toBe(true);
    expect(isValidMetaPixelId("[PASTE PIXEL ID]")).toBe(false);
    expect(shouldLoadMetaPixel("production", "123456789012345", "production")).toBe(true);
    expect(shouldLoadMetaPixel("preview", "123456789012345", "production")).toBe(false);
    expect(shouldLoadMetaPixel("production", "123456789012345", "development")).toBe(false);
    expect(shouldLoadMetaPixel("production", " 123456789012345 ", "production")).toBe(false);
    expect(shouldLoadMetaPixel(undefined, "123456789012345", "production")).toBe(false);
  });

  it("excludes private report and operational routes", () => {
    expect(isMetaPixelRouteAllowed("/study-profile")).toBe(true);
    expect(isMetaPixelRouteAllowed("/study-profile/")).toBe(true);
    expect(isMetaPixelRouteAllowed("/study-profile/waitlist/confirm")).toBe(true);
    expect(isMetaPixelRouteAllowed("/")).toBe(false);
    expect(isMetaPixelRouteAllowed("/support")).toBe(false);
    expect(isMetaPixelRouteAllowed("/study-profile/setup")).toBe(false);
    expect(isMetaPixelRouteAllowed("/study-profile/report/private-token")).toBe(false);
    expect(isMetaPixelRouteAllowed("/auth/callback")).toBe(false);
    expect(isMetaPixelRouteAllowed("/api/system/status")).toBe(false);
  });
});

describe("Meta Pixel client events", () => {
  const fbq = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("window", {
      fbq,
      location: { pathname: "/study-profile" },
      __yovaMetaPixelConfigured: true,
      __yovaMetaPixelReady: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("emits one PageView per pathname and ignores quiz state changes", () => {
    expect(trackMetaPageViewOnce("/study-profile")).toBe(true);
    expect(trackMetaPageViewOnce("/study-profile")).toBe(false);

    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq).toHaveBeenCalledWith("track", "PageView");
  });

  it("does not emit a PageView on a private report route", () => {
    expect(trackMetaPageViewOnce("/study-profile/report/private-token")).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });

  it("refuses conversions outside the public measurement routes", () => {
    window.location.pathname = "/study-profile/report/private-token";
    expect(trackMetaConversionOnce(
      "Lead",
      { content_name: "study_profile_report" },
      "study_profile_report_abc123",
    )).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });

  it("emits each confirmed conversion exactly once with its safe content name", () => {
    const eventId = "study_profile_report_abc123";
    expect(trackMetaConversionOnce(
      "Lead",
      { content_name: "study_profile_report" },
      eventId,
    )).toBe(true);
    expect(trackMetaConversionOnce(
      "Lead",
      { content_name: "study_profile_report" },
      eventId,
    )).toBe(false);

    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq).toHaveBeenCalledWith(
      "track",
      "Lead",
      { content_name: "study_profile_report" },
      { eventID: eventId },
    );
  });

  it("queues a confirmed conversion while the external library is still loading", () => {
    window.__yovaMetaPixelReady = false;
    expect(trackMetaConversionOnce(
      "Lead",
      { content_name: "study_profile_report" },
      "study_profile_report_slow_library",
    )).toBe(true);
    expect(fbq).toHaveBeenCalledWith(
      "track",
      "Lead",
      { content_name: "study_profile_report" },
      { eventID: "study_profile_report_slow_library" },
    );
  });

  it("hashes stable source values instead of putting tokens in event IDs", async () => {
    const token = "sensitive-confirmation-token";
    const first = await createMetaEventId("study_profile_waitlist", token);
    const second = await createMetaEventId("study_profile_waitlist", token);

    expect(first).toBe(second);
    expect(first).toMatch(/^study_profile_waitlist_[0-9a-f]{48}$/u);
    expect(first).not.toContain(token);
  });
});

describe("Meta Pixel bootstrap and URL privacy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("initializes one numeric pixel ID before marking the library ready", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/study-profile" },
    });

    expect(initializeMetaPixel("123456789012345")).toBe(true);
    expect(window.__yovaMetaPixelConfigured).toBe(true);
    expect(window.__yovaMetaPixelReady).not.toBe(true);
    expect(window.fbq?.queue).toEqual([
      ["set", "autoConfig", false, "123456789012345"],
      ["init", "123456789012345"],
    ]);
    expect(initializeMetaPixel("123456789012345")).toBe(true);
    expect(window.fbq?.queue).toHaveLength(2);

    expect(markMetaPixelReady()).toBe(true);
    expect(window.__yovaMetaPixelReady).toBe(true);
  });

  it("resolves a bounded readiness wait when the external library executes", async () => {
    const target = new EventTarget();
    vi.stubGlobal("window", Object.assign(target, {
      location: { pathname: "/study-profile" },
      fbq: vi.fn(),
      __yovaMetaPixelConfigured: true,
      __yovaMetaPixelReady: false,
      setTimeout,
      clearTimeout,
    }));

    const ready = waitForMetaPixelReady(100);
    expect(markMetaPixelReady()).toBe(true);
    await expect(ready).resolves.toBe(true);
  });

  it("releases a readiness wait immediately when the external library fails", async () => {
    const target = new EventTarget();
    vi.stubGlobal("window", Object.assign(target, {
      location: { pathname: "/study-profile" },
      fbq: vi.fn(),
      __yovaMetaPixelConfigured: true,
      __yovaMetaPixelReady: false,
      setTimeout,
      clearTimeout,
    }));

    const ready = waitForMetaPixelReady(10_000);
    markMetaPixelFailed();
    await expect(ready).resolves.toBe(false);
  });

  it("does not wait when the external library already failed", async () => {
    vi.stubGlobal("window", {
      __yovaMetaPixelConfigured: true,
      __yovaMetaPixelReady: false,
      __yovaMetaPixelFailed: true,
    });

    await expect(waitForMetaPixelReady(10_000)).resolves.toBe(false);
  });

  it("keeps only bounded campaign data in the URL Meta can read", () => {
    expect(metaSafeStudyProfilePath(
      "https://www.yovaapp.com/study-profile?utm_source=instagram&utm_medium=paid_social&utm_term=student%40example.com&token=private-value&fbclid=meta.click_123#private-fragment",
    )).toBe(
      "/study-profile?utm_source=instagram&utm_medium=paid_social&fbclid=meta.click_123",
    );
    expect(metaSafeStudyProfilePath(
      "https://www.yovaapp.com/study-profile/waitlist/confirm?email=student%40example.com#token=private-token",
    )).toBe("/study-profile/waitlist/confirm");
  });
});
