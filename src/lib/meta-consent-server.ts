import "server-only";

import { cookies, headers } from "next/headers";
import {
  META_CONSENT_COOKIE_NAME,
  parseMetaConsentPreference,
  requiresExplicitMetaConsent,
} from "@/lib/meta-consent";

export async function getMetaConsentRequestContext() {
  const [requestHeaders, cookieStore] = await Promise.all([headers(), cookies()]);
  return {
    requiresExplicitConsent: requiresExplicitMetaConsent(
      requestHeaders.get("x-vercel-ip-country"),
    ),
    storedPreference: parseMetaConsentPreference(
      cookieStore.get(META_CONSENT_COOKIE_NAME)?.value,
    ),
  };
}
