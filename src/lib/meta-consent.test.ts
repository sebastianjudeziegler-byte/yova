import { describe, expect, it } from "vitest";
import {
  META_CONSENT_COOKIE_NAME,
  META_CONSENT_MAX_AGE_SECONDS,
  buildMetaConsentCookie,
  parseMetaConsentPreference,
  readMetaConsentPreference,
  requiresExplicitMetaConsent,
  resolveMetaConsentState,
} from "@/lib/meta-consent";

describe("Meta consent region and preference policy", () => {
  it.each([
    "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR",
    "GB", "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV",
    "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK",
  ])("requires explicit consent in %s", (countryCode) => {
    expect(requiresExplicitMetaConsent(countryCode)).toBe(true);
  });

  it("normalizes lowercase country codes and fails closed when the header is missing", () => {
    expect(requiresExplicitMetaConsent("gb")).toBe(true);
    expect(requiresExplicitMetaConsent(undefined)).toBe(true);
    expect(requiresExplicitMetaConsent(null)).toBe(true);
    expect(requiresExplicitMetaConsent(" ")).toBe(true);
    expect(requiresExplicitMetaConsent("USA")).toBe(true);
    expect(requiresExplicitMetaConsent("XX")).toBe(true);
  });

  it("loads by default outside GB and the EU/EEA", () => {
    expect(requiresExplicitMetaConsent("US")).toBe(false);
    expect(requiresExplicitMetaConsent("CA")).toBe(false);
    expect(requiresExplicitMetaConsent("CH")).toBe(false);
  });

  it("lets an explicit stored choice override the regional default", () => {
    expect(resolveMetaConsentState(true, null)).toBe("pending");
    expect(resolveMetaConsentState(true, "granted")).toBe("granted");
    expect(resolveMetaConsentState(false, "denied")).toBe("denied");
    expect(resolveMetaConsentState(false, "invalid")).toBe("granted");
  });

  it("reads only the exact first-party preference cookie", () => {
    expect(readMetaConsentPreference(
      `another=1; ${META_CONSENT_COOKIE_NAME}=denied; suffix=2`,
    )).toBe("denied");
    expect(readMetaConsentPreference(`${META_CONSENT_COOKIE_NAME}=invalid`)).toBeNull();
    expect(parseMetaConsentPreference("granted")).toBe("granted");
    expect(parseMetaConsentPreference("GRANTED")).toBeNull();
  });

  it("stores choices for exactly 12 months", () => {
    expect(META_CONSENT_MAX_AGE_SECONDS).toBe(31_536_000);
    expect(buildMetaConsentCookie("denied", true)).toBe(
      `${META_CONSENT_COOKIE_NAME}=denied; Max-Age=31536000; Path=/; SameSite=Lax; Secure`,
    );
    expect(buildMetaConsentCookie("granted", false)).not.toContain("Secure");
  });
});
