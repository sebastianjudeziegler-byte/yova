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
  trackMetaPageViewOnce,
} from "@/lib/meta-pixel";
import { captureStudyProfileAttribution } from "@/lib/study-profile/analytics-client";

type MetaPixelProps = {
  pixelId: string;
};

const WAITLIST_CONFIRMATION_PATH = "/study-profile/waitlist/confirm";

export function MetaPixel({ pixelId }: MetaPixelProps) {
  const pathname = usePathname();
  const routeAllowed = isMetaPixelRouteAllowed(pathname);

  useEffect(() => {
    if (routeAllowed) return;
    resetMetaPageViewRoute();

    // A hard document boundary unloads Meta before any private or signed-in
    // route is allowed to remain visible after client-side navigation.
    if (isMetaPixelConfigured()) window.location.reload();
  }, [routeAllowed]);

  if (!routeAllowed) return null;
  return (
    <MetaSafeLocation
      key={pathname}
      pixelId={pixelId}
      pathname={pathname}
    />
  );
}

function MetaSafeLocation({
  pixelId,
  pathname,
}: MetaPixelProps & { pathname: string }) {
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
}: MetaPixelProps & { pathname: string }) {
  const [bootstrapReady, setBootstrapReady] = useState(false);

  useEffect(() => {
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
