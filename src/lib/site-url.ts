import "server-only";

const LOCAL_SITE_URL = "http://localhost:3000";

export function getSiteUrl() {
  const configuredUrl = process.env.SITE_URL?.trim();
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
    || process.env.VERCEL_URL?.trim();
  const candidate = configuredUrl || (vercelUrl ? `https://${vercelUrl}` : LOCAL_SITE_URL);

  try {
    return new URL(candidate);
  } catch {
    console.warn("YOVA ignored an invalid SITE_URL and used the local metadata URL.");
    return new URL(LOCAL_SITE_URL);
  }
}
