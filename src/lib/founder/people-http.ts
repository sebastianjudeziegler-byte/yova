import "server-only";

import type { FounderPeopleDirectoryRow } from "@/lib/founder/people";

export const FOUNDER_PEOPLE_REQUEST_MAX_BYTES = 4_096;
export const FOUNDER_PEOPLE_CSV_MAX_BYTES = 5 * 1024 * 1024;

export const FOUNDER_PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
} as const;

export type FounderPeopleRequestGuard =
  | { ok: true }
  | { ok: false; status: 403 | 415; message: string };

export function validateFounderPeopleRequest(request: Request): FounderPeopleRequestGuard {
  const mediaType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return { ok: false, status: 415, message: "Founder directory requests must use application/json." };
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") {
    return { ok: false, status: 403, message: "Cross-origin founder directory requests are not allowed." };
  }

  const origin = request.headers.get("origin")?.trim();
  if (!origin) {
    return { ok: false, status: 403, message: "Founder directory requests require same-origin browser verification." };
  }

  try {
    if (new URL(origin).origin === new URL(request.url).origin) return { ok: true };
  } catch {
    // Invalid and opaque origins are not accepted for a PII-bearing request.
  }

  return { ok: false, status: 403, message: "Cross-origin founder directory requests are not allowed." };
}

export async function readBoundedFounderPeopleJson(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: "invalid_json" | "too_large" }> {
  if (!request.body) return { ok: false, reason: "invalid_json" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > FOUNDER_PEOPLE_REQUEST_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "invalid_json" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

const CSV_COLUMNS = [
  "Email",
  "Display name",
  "Record type",
  "Matched by",
  "First seen",
  "Most recent activity",
  "YOVA account",
  "Account created",
  "Email confirmed",
  "Onboarding completed",
  "Last sign-in",
  "Last product activity",
  "Tester access",
  "Plans",
  "Completed sessions",
  "Study minutes",
  "Study Profile lead",
  "Profile status",
  "Reports unlocked",
  "Latest report",
  "Report email status",
  "Historical marketing consent",
  "Waitlist status",
  "Waitlist confirmation status",
  "Waitlist consent source",
  "Waitlist requested",
  "Waitlist joined",
  "Confirmation email status",
  "Source",
  "Medium",
  "Campaign",
  "Content",
  "Term",
  "Device",
  "Primary pattern",
  "School level",
  "Energy window",
] as const;

export function buildFounderPeopleCsv(rows: FounderPeopleDirectoryRow[]) {
  const body = [
    CSV_COLUMNS.map(csvCell).join(","),
    ...rows.map((row) => [
      row.email,
      row.displayName,
      row.kind,
      row.matchBasis === "exact_normalized_email" ? "Current normalized email" : null,
      earliestTimestamp(row.accountCreatedAt, row.leadCreatedAt, row.invitedAt),
      row.recentAt,
      yesNo(row.hasYovaAccount),
      row.accountCreatedAt,
      row.emailConfirmedAt,
      row.onboardingCompletedAt,
      row.lastSignInAt,
      row.lastProductActivityAt,
      row.inviteStatus,
      row.plansCount,
      row.sessionsCompleted,
      row.studyMinutes,
      yesNo(row.hasStudyProfileLead),
      row.profileStatus,
      row.reportCount,
      row.latestReportAt,
      row.reportEmailStatus,
      row.marketingConsentAt,
      row.waitlistStatus,
      row.waitlistConfirmationStatus,
      row.waitlistConsentSource,
      row.waitlistRequestedAt,
      row.waitlistJoinedAt,
      row.confirmationDeliveryStatus,
      row.source,
      row.medium,
      row.campaign,
      row.content,
      row.term,
      row.deviceType,
      row.primaryPattern,
      row.schoolLevel,
      row.energyWindow,
    ].map(csvCell).join(",")),
  ].join("\r\n");

  return `\uFEFF${body}\r\n`;
}

export function csvCell(value: string | number | boolean | null | undefined) {
  const original = value === null || value === undefined ? "" : String(value);
  const safe = /^[\t\r ]*[=+\-@]/.test(original) || /^[\t\r]/.test(original)
    ? `'${original}`
    : original;
  return `"${safe.replaceAll('"', '""')}"`;
}

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function earliestTimestamp(...values: Array<string | null>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null;
}
