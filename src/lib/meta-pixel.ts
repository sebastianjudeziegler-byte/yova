import {
  sanitizeStudyProfileAttributionValue,
  sanitizeStudyProfileMetaClickId,
} from "@/lib/study-profile/attribution-privacy";

export type MetaPixelEventName = "Lead" | "CompleteRegistration";

export type MetaPixelParameters = {
  content_name: "study_profile_report" | "waitlist";
};

type MetaPixelFunction = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[][];
  loaded?: boolean;
  version?: string;
  push?: MetaPixelFunction;
};

declare global {
  interface Window {
    fbq?: MetaPixelFunction;
    _fbq?: MetaPixelFunction;
    __yovaMetaLastPageView?: string | null;
    __yovaMetaConversionEventIds?: Set<string>;
    __yovaMetaPixelConfigured?: boolean;
    __yovaMetaPixelReady?: boolean;
    __yovaMetaPixelFailed?: boolean;
    __yovaMetaPixelId?: string;
  }
}

// Keep this as an exact opt-in list. Prefix matching would expose future,
// authenticated, setup, or private bearer-token routes to Meta by default.
const META_PIXEL_ALLOWED_PATHNAMES = new Set([
  "/study-profile",
  "/study-profile/waitlist/confirm",
]);
const META_PIXEL_READY_EVENT = "yova:meta-pixel-ready";
const META_PIXEL_FAILED_EVENT = "yova:meta-pixel-failed";

function normalizeMetaPathname(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
}

export function isValidMetaPixelId(value: string | null | undefined) {
  return typeof value === "string" && /^\d{5,32}$/.test(value);
}

export function shouldLoadMetaPixel(
  vercelEnvironment: string | null | undefined,
  pixelId: string | null | undefined,
  nodeEnvironment: string | null | undefined,
) {
  return vercelEnvironment === "production"
    && nodeEnvironment === "production"
    && isValidMetaPixelId(pixelId);
}

/** Only explicitly approved public Study Profile pathnames initialize Meta. */
export function isMetaPixelRouteAllowed(pathname: string) {
  return META_PIXEL_ALLOWED_PATHNAMES.has(normalizeMetaPathname(pathname));
}

/** Installs Meta's standard queue stub and initializes exactly one configured ID. */
export function initializeMetaPixel(pixelId: string) {
  if (typeof window === "undefined" || !isValidMetaPixelId(pixelId)) return false;

  if (!window.fbq) {
    const queueFunction = ((...args: unknown[]) => {
      if (queueFunction.callMethod) queueFunction.callMethod(...args);
      else queueFunction.queue?.push(args);
    }) as MetaPixelFunction;
    queueFunction.push = queueFunction;
    queueFunction.loaded = true;
    queueFunction.version = "2.0";
    queueFunction.queue = [];
    window.fbq = queueFunction;
    window._fbq = queueFunction;
  }

  if (
    window.__yovaMetaPixelConfigured === true
    && window.__yovaMetaPixelId === pixelId
  ) {
    return true;
  }

  try {
    window.fbq("set", "autoConfig", false, pixelId);
    window.fbq("init", pixelId);
    window.__yovaMetaPixelId = pixelId;
    window.__yovaMetaPixelConfigured = true;
    window.__yovaMetaPixelFailed = false;
    return true;
  } catch {
    window.__yovaMetaPixelConfigured = false;
    window.__yovaMetaPixelId = undefined;
    return false;
  }
}

/** Marks the external Meta library ready only after it has executed. */
export function markMetaPixelReady() {
  if (
    typeof window === "undefined"
    || window.__yovaMetaPixelConfigured !== true
    || !window.fbq
  ) {
    return false;
  }
  window.__yovaMetaPixelReady = true;
  window.__yovaMetaPixelFailed = false;
  if (typeof window.dispatchEvent === "function" && typeof Event === "function") {
    window.dispatchEvent(new Event(META_PIXEL_READY_EVENT));
  }
  return true;
}

/** Releases any bounded navigation wait when the external script cannot load. */
export function markMetaPixelFailed() {
  if (typeof window === "undefined") return;
  window.__yovaMetaPixelReady = false;
  window.__yovaMetaPixelFailed = true;
  if (typeof window.dispatchEvent === "function" && typeof Event === "function") {
    window.dispatchEvent(new Event(META_PIXEL_FAILED_EVENT));
  }
}

/** Waits briefly for a queued conversion to be drained before a hard navigation. */
export function waitForMetaPixelReady(timeoutMs = 1_500): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.__yovaMetaPixelReady === true) return Promise.resolve(true);
  if (window.__yovaMetaPixelFailed === true) return Promise.resolve(false);
  if (
    typeof window.addEventListener !== "function"
    || typeof window.removeEventListener !== "function"
  ) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(META_PIXEL_READY_EVENT, handleReady);
      window.removeEventListener(META_PIXEL_FAILED_EVENT, handleFailed);
      window.clearTimeout(timer);
      resolve(ready);
    };
    const handleReady = () => finish(true);
    const handleFailed = () => finish(false);
    const timer = window.setTimeout(() => finish(false), Math.max(0, timeoutMs));
    window.addEventListener(META_PIXEL_READY_EVENT, handleReady, { once: true });
    window.addEventListener(META_PIXEL_FAILED_EVENT, handleFailed, { once: true });
  });
}

/**
 * Page views are keyed only by pathname. Query changes and the quiz's internal
 * state transitions therefore cannot produce duplicate PageView events.
 */
export function trackMetaPageViewOnce(pathname: string) {
  const normalizedPathname = normalizeMetaPathname(pathname);
  if (
    typeof window === "undefined"
    || window.__yovaMetaPixelConfigured !== true
    || !window.fbq
    || !isMetaPixelRouteAllowed(normalizedPathname)
  ) {
    return false;
  }
  if (window.__yovaMetaLastPageView === normalizedPathname) return false;
  window.__yovaMetaLastPageView = normalizedPathname;
  try {
    window.fbq("track", "PageView");
    return true;
  } catch {
    window.__yovaMetaLastPageView = null;
    return false;
  }
}

export function resetMetaPageViewRoute() {
  if (typeof window !== "undefined") window.__yovaMetaLastPageView = null;
}

/** Emits a conversion at most once per stable event ID for the current document. */
export function trackMetaConversionOnce(
  eventName: MetaPixelEventName,
  parameters: MetaPixelParameters,
  eventId: string,
) {
  if (
    typeof window === "undefined"
    || window.__yovaMetaPixelConfigured !== true
    || !window.fbq
    || !isMetaPixelRouteAllowed(window.location.pathname)
    || !/^[A-Za-z0-9_-]{1,100}$/.test(eventId)
  ) {
    return false;
  }
  window.__yovaMetaConversionEventIds ??= new Set<string>();
  if (window.__yovaMetaConversionEventIds.has(eventId)) return false;
  window.__yovaMetaConversionEventIds.add(eventId);
  try {
    window.fbq("track", eventName, parameters, { eventID: eventId });
    return true;
  } catch {
    window.__yovaMetaConversionEventIds.delete(eventId);
    return false;
  }
}

export function isMetaPixelConfigured() {
  return typeof window !== "undefined"
    && window.__yovaMetaPixelConfigured === true
    && isValidMetaPixelId(window.__yovaMetaPixelId)
    && Boolean(window.fbq);
}

/**
 * Retains only bounded campaign parameters before Meta can read the address.
 * First-touch capture must run before this path replaces the visible URL.
 */
export function metaSafeStudyProfilePath(pageUrl: string) {
  const url = new URL(pageUrl);
  const pathname = url.pathname.length > 1
    ? url.pathname.replace(/\/+$/u, "")
    : url.pathname;
  const safeParameters = new URLSearchParams();

  if (pathname === "/study-profile") {
    const limits: ReadonlyArray<[string, number]> = [
      ["source", 100],
      ["utm_source", 100],
      ["utm_medium", 100],
      ["utm_campaign", 160],
      ["utm_content", 160],
      ["utm_term", 160],
    ];
    for (const [name, maxLength] of limits) {
      const value = sanitizeStudyProfileAttributionValue(
        url.searchParams.get(name),
        maxLength,
      );
      if (value) safeParameters.set(name, value);
    }
    const fbclid = sanitizeStudyProfileMetaClickId(url.searchParams.get("fbclid"));
    if (fbclid) safeParameters.set("fbclid", fbclid);
    if (url.searchParams.get("retake") === "1") safeParameters.set("retake", "1");
  }

  const search = safeParameters.toString();
  return `${pathname}${search ? `?${search}` : ""}`;
}

/** Creates a stable, non-reversible event ID without exposing its source value. */
export async function createMetaEventId(namespace: string, stableValue: string) {
  const safeNamespace = namespace.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32) || "event";
  const bytes = new TextEncoder().encode(`${safeNamespace}:${stableValue}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => (
    byte.toString(16).padStart(2, "0")
  )).join("");
  return `${safeNamespace}_${hash.slice(0, 48)}`;
}
