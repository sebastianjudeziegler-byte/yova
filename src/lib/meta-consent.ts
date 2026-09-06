export const META_CONSENT_COOKIE_NAME = "yova_meta_consent";
export const META_CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
export const META_CONSENT_CHANGED_EVENT = "yova:meta-consent-changed";

export type MetaConsentPreference = "granted" | "denied";
export type MetaConsentState = MetaConsentPreference | "pending";

const META_EXPLICIT_CONSENT_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GB",
  "GR",
  "HR",
  "HU",
  "IE",
  "IS",
  "IT",
  "LI",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
]);

export function requiresExplicitMetaConsent(countryCode: string | null | undefined) {
  const normalized = countryCode?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{2}$/u.test(normalized) || normalized === "XX") return true;
  return META_EXPLICIT_CONSENT_COUNTRIES.has(normalized);
}

export function parseMetaConsentPreference(
  value: string | null | undefined,
): MetaConsentPreference | null {
  return value === "granted" || value === "denied" ? value : null;
}

export function resolveMetaConsentState(
  requiresExplicitConsent: boolean,
  storedPreference: string | null | undefined,
): MetaConsentState {
  const preference = parseMetaConsentPreference(storedPreference);
  if (preference) return preference;
  return requiresExplicitConsent ? "pending" : "granted";
}

export function readMetaConsentPreference(
  cookieString: string,
): MetaConsentPreference | null {
  for (const entry of cookieString.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    const name = entry.slice(0, separator).trim();
    if (name !== META_CONSENT_COOKIE_NAME) continue;
    return parseMetaConsentPreference(entry.slice(separator + 1).trim());
  }
  return null;
}

export function storeMetaConsentPreference(preference: MetaConsentPreference) {
  if (typeof document === "undefined") return false;
  document.cookie = buildMetaConsentCookie(
    preference,
    window.location.protocol === "https:",
  );

  window.dispatchEvent(new CustomEvent<MetaConsentPreference>(
    META_CONSENT_CHANGED_EVENT,
    { detail: preference },
  ));
  return true;
}

export function buildMetaConsentCookie(
  preference: MetaConsentPreference,
  secure: boolean,
) {
  return [
    `${META_CONSENT_COOKIE_NAME}=${preference}`,
    `Max-Age=${META_CONSENT_MAX_AGE_SECONDS}`,
    "Path=/",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
