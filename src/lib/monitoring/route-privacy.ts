const PRIVATE_STUDY_PROFILE_REPORT_PATH = "/study-profile/report/private";

/**
 * Error reports keep only a stable route shape. Study Profile report URLs
 * contain bearer tokens, so concrete report paths must never enter telemetry.
 */
export function sanitizeProductErrorRoutePath(pathname: string) {
  return pathname.startsWith("/study-profile/report/")
    ? PRIVATE_STUDY_PROFILE_REPORT_PATH
    : pathname;
}
