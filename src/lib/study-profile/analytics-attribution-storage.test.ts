import { afterEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "yova.study-profile.attribution.v1";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Study Profile first-touch attribution storage", () => {
  it("keeps the first campaign for 30 days and does not overwrite it", async () => {
    const values = new Map<string, string>();
    const storage = storageFor(values);
    const location = {
      href: "https://www.yovaapp.com/study-profile?utm_source=instagram&utm_medium=organic_social&utm_campaign=study_profile_quiz&utm_content=static_v1&fbclid=ignored_click_id",
    };
    vi.stubGlobal("window", { location, localStorage: storage });
    vi.stubGlobal("document", { referrer: "" });
    const { captureStudyProfileAttribution } = await import(
      "@/lib/study-profile/analytics-client"
    );

    const first = captureStudyProfileAttribution();
    location.href = "https://www.yovaapp.com/study-profile?utm_source=facebook&utm_campaign=later";
    const second = captureStudyProfileAttribution();

    expect(first).toMatchObject({
      utmSource: "instagram",
      utmMedium: "organic_social",
      utmCampaign: "study_profile_quiz",
      utmContent: "static_v1",
    });
    expect(first).not.toHaveProperty("fbclid");
    expect(second).toEqual(first);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(values.get(STORAGE_KEY) ?? "{}").attribution).toEqual({
      utmSource: "instagram",
      utmMedium: "organic_social",
      utmCampaign: "study_profile_quiz",
      utmContent: "static_v1",
    });
  });

  it("does not let an untagged visit block a later campaign touch", async () => {
    const values = new Map<string, string>();
    const storage = storageFor(values);
    const location = { href: "https://www.yovaapp.com/study-profile" };
    vi.stubGlobal("window", { location, localStorage: storage });
    vi.stubGlobal("document", { referrer: "" });
    const firstModule = await import("@/lib/study-profile/analytics-client");

    expect(firstModule.captureStudyProfileAttribution()).toEqual({
      source: "direct",
      referrer: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
    });
    expect(storage.setItem).not.toHaveBeenCalled();

    location.href = "https://www.yovaapp.com/study-profile?utm_source=instagram&fbclid=ignored_click_id";
    vi.resetModules();
    const secondModule = await import("@/lib/study-profile/analytics-client");
    expect(secondModule.captureStudyProfileAttribution()).toMatchObject({
      source: "instagram",
      utmSource: "instagram",
    });
    expect(secondModule.captureStudyProfileAttribution()).not.toHaveProperty("fbclid");
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it("does not capture or persist Meta click identifiers", async () => {
    const values = new Map<string, string>();
    const storage = storageFor(values);
    vi.stubGlobal("window", {
      location: {
        href: "https://www.yovaapp.com/study-profile?fbclid=ignored_click_id",
      },
      localStorage: storage,
    });
    vi.stubGlobal("document", { referrer: "" });
    const { captureStudyProfileAttribution } = await import(
      "@/lib/study-profile/analytics-client"
    );

    expect(captureStudyProfileAttribution()).toEqual({
      source: "direct",
      referrer: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
    });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("expires a first touch after 30 days", async () => {
    const values = new Map<string, string>([[STORAGE_KEY, JSON.stringify({
      version: 1,
      capturedAt: Date.now() - 31 * 24 * 60 * 60 * 1_000,
      attribution: { source: "old", utmSource: "old" },
    })]]);
    const storage = storageFor(values);
    vi.stubGlobal("window", {
      location: {
        href: "https://www.yovaapp.com/study-profile?utm_source=instagram&utm_campaign=new",
      },
      localStorage: storage,
    });
    vi.stubGlobal("document", { referrer: "" });
    const { captureStudyProfileAttribution } = await import(
      "@/lib/study-profile/analytics-client"
    );

    expect(captureStudyProfileAttribution()).toMatchObject({
      utmSource: "instagram",
      utmCampaign: "new",
    });
    expect(storage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it("expires first-touch attribution without requiring a page reload", async () => {
    vi.useFakeTimers();
    const capturedAt = new Date("2026-09-06T12:00:00.000Z");
    vi.setSystemTime(capturedAt);
    const values = new Map<string, string>();
    const storage = storageFor(values);
    const location = {
      href: "https://www.yovaapp.com/study-profile?utm_source=instagram&utm_campaign=first",
    };
    vi.stubGlobal("window", { location, localStorage: storage });
    vi.stubGlobal("document", { referrer: "" });
    const { captureStudyProfileAttribution } = await import(
      "@/lib/study-profile/analytics-client"
    );

    expect(captureStudyProfileAttribution()).toMatchObject({
      utmSource: "instagram",
      utmCampaign: "first",
    });
    location.href = "https://www.yovaapp.com/study-profile?utm_source=facebook&utm_campaign=second";
    vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1_000);

    expect(captureStudyProfileAttribution()).toMatchObject({
      utmSource: "facebook",
      utmCampaign: "second",
    });
    expect(storage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });
});

function storageFor(values: Map<string, string>) {
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}
