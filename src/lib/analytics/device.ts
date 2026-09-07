export const ANALYTICS_DEVICE_TYPES = [
  "mobile",
  "tablet",
  "desktop",
  "unknown",
] as const;

export type AnalyticsDeviceType = (typeof ANALYTICS_DEVICE_TYPES)[number];

/**
 * Reduce request headers to a broad device category. YOVA never stores the
 * raw user agent, browser version, or another fingerprinting identifier.
 */
export function classifyAnalyticsDevice(headers: Headers): AnalyticsDeviceType {
  const mobileHint = headers.get("sec-ch-ua-mobile")?.trim();
  const userAgent = headers.get("user-agent")?.toLowerCase().trim() ?? "";

  if (
    /ipad|tablet|kindle|silk|playbook/.test(userAgent)
    || /android(?!.*mobile)/.test(userAgent)
  ) {
    return "tablet";
  }

  if (
    mobileHint === "?1"
    || /mobi|iphone|ipod|windows phone|android.*mobile/.test(userAgent)
  ) {
    return "mobile";
  }

  if (userAgent || mobileHint === "?0") return "desktop";
  return "unknown";
}
