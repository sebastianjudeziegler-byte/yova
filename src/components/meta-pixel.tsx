"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  initializeMetaPixel,
  isMetaPixelConfigured,
  isMetaPixelRouteAllowed,
  markMetaPixelFailed,
  markMetaPixelReady,
  metaSafeStudyProfilePath,
  resetMetaPageViewRoute,
  setMetaPixelConsent,
  trackMetaPageViewOnce,
} from "@/lib/meta-pixel";
import {
  META_CONSENT_CHANGED_EVENT,
  readMetaConsentPreference,
  resolveMetaConsentState,
  storeMetaConsentPreference,
  type MetaConsentPreference,
  type MetaConsentState,
} from "@/lib/meta-consent";
import { captureStudyProfileAttribution } from "@/lib/study-profile/analytics-client";
import styles from "./meta-consent.module.css";

type MetaPixelProps = {
  pixelId: string;
  requiresExplicitConsent: boolean;
  storedPreference: MetaConsentPreference | null;
};

const WAITLIST_CONFIRMATION_PATH = "/study-profile/waitlist/confirm";

export function MetaPixel({
  pixelId,
  requiresExplicitConsent,
  storedPreference,
}: MetaPixelProps) {
  const pathname = usePathname();
  const routeAllowed = isMetaPixelRouteAllowed(pathname);
  const [consent, setConsent] = useState<MetaConsentState>(() => (
    resolveMetaConsentState(requiresExplicitConsent, storedPreference)
  ));

  useEffect(() => {
    const syncPreference = (preference?: MetaConsentPreference | null) => {
      const resolved = resolveMetaConsentState(
        requiresExplicitConsent,
        preference ?? readMetaConsentPreference(document.cookie),
      );
      setMetaPixelConsent(resolved === "granted");
      setConsent(resolved);
    };
    const handlePreference = (event: Event) => {
      const preference = event instanceof CustomEvent
        ? event.detail as MetaConsentPreference
        : null;
      syncPreference(preference);
    };
    const handleFocus = () => syncPreference();

    syncPreference(storedPreference);
    window.addEventListener(META_CONSENT_CHANGED_EVENT, handlePreference);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handleFocus);
    return () => {
      window.removeEventListener(META_CONSENT_CHANGED_EVENT, handlePreference);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handleFocus);
    };
  }, [requiresExplicitConsent, storedPreference]);

  useEffect(() => {
    if (routeAllowed) return;
    resetMetaPageViewRoute();

    // A hard document boundary unloads Meta before any private or signed-in
    // route is allowed to remain visible after client-side navigation.
    if (isMetaPixelConfigured()) window.location.reload();
  }, [routeAllowed]);

  if (!routeAllowed) return null;
  return (
    <>
      {consent === "granted" ? (
        <MetaSafeLocation
          key={pathname}
          pixelId={pixelId}
          pathname={pathname}
        />
      ) : null}
      {consent === "pending" && pathname === "/study-profile" ? (
        <MetaConsentBanner onChoose={(preference) => {
          storeMetaConsentPreference(preference);
          setMetaPixelConsent(preference === "granted");
          setConsent(preference);
        }} />
      ) : null}
    </>
  );
}

function MetaConsentBanner({
  onChoose,
}: {
  onChoose: (preference: MetaConsentPreference) => void;
}) {
  return (
    <aside className={styles.banner} aria-label="Advertising measurement choice">
      <div>
        <strong>Advertising measurement</strong>
        <p>YOVA uses Meta Pixel on this page to measure ad results. No email or quiz answers are sent to Meta. <a href="/privacy">Privacy Notice</a></p>
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={() => onChoose("denied")}>Decline</button>
        <button type="button" className={styles.accept} onClick={() => onChoose("granted")}>Accept</button>
      </div>
    </aside>
  );
}

function MetaSafeLocation({
  pixelId,
  pathname,
}: Pick<MetaPixelProps, "pixelId"> & { pathname: string }) {
  const [urlReady, setUrlReady] = useState(false);

  useEffect(() => {
    let frame = 0;
    const prepareUrl = () => {
      // The confirmation component must hash the one-time fragment before the
      // third-party library is allowed to initialize.
      if (pathname === WAITLIST_CONFIRMATION_PATH && window.location.hash) {
        frame = window.requestAnimationFrame(prepareUrl);
        return;
      }

      captureStudyProfileAttribution();
      const safePath = metaSafeStudyProfilePath(window.location.href);
      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (safePath !== currentPath) {
        window.history.replaceState(window.history.state, "", safePath);
      }
      setUrlReady(true);
    };

    frame = window.requestAnimationFrame(prepareUrl);
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  return urlReady
    ? <MetaPixelRuntime pixelId={pixelId} pathname={pathname} />
    : null;
}

function MetaPixelRuntime({
  pixelId,
  pathname,
}: Pick<MetaPixelProps, "pixelId"> & { pathname: string }) {
  const [bootstrapReady, setBootstrapReady] = useState(false);

  useEffect(() => {
    setMetaPixelConsent(true);
    const initialized = initializeMetaPixel(pixelId);
    if (initialized) trackMetaPageViewOnce(pathname);
    const frame = window.requestAnimationFrame(() => {
      setBootstrapReady(initialized);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname, pixelId]);

  if (!bootstrapReady) return null;
  return (
    <Script
      id="yova-meta-pixel-library"
      src="https://connect.facebook.net/en_US/fbevents.js"
      strategy="afterInteractive"
      onReady={() => {
        markMetaPixelReady();
      }}
      onError={() => {
        markMetaPixelFailed();
      }}
    />
  );
}
