export type StudyProfileReportDeliveryState =
  | "sent"
  | "skipped"
  | "failed"
  | "cooldown"
  | "daily_cap";

export type StudyProfileReportTransition = {
  version: 1;
  responseId: string;
  visitorId?: string;
  emailDelivery?: StudyProfileReportDeliveryState;
  waitlistError?: string | null;
};

const REPORT_TRANSITION_STORAGE_KEY = "yova.study-profile.report-transition.v1";
const EMAIL_DELIVERY_STATES = new Set<StudyProfileReportDeliveryState>([
  "sent",
  "skipped",
  "failed",
  "cooldown",
  "daily_cap",
]);

export function storeStudyProfileReportTransition(
  {
    responseId,
    visitorId,
    emailDelivery,
    waitlistError,
  }: Omit<StudyProfileReportTransition, "version">,
  storage?: Pick<Storage, "setItem">,
) {
  try {
    const resolvedStorage = storage ?? window.sessionStorage;
    resolvedStorage.setItem(REPORT_TRANSITION_STORAGE_KEY, JSON.stringify({
      version: 1,
      responseId,
      visitorId,
      emailDelivery,
      waitlistError: waitlistError?.slice(0, 500) ?? null,
    } satisfies StudyProfileReportTransition));
  } catch {
    // The report still opens if the browser blocks session storage.
  }
}

export function consumeStudyProfileReportTransition(
  responseId: string,
  storage?: Pick<Storage, "getItem" | "removeItem">,
): StudyProfileReportTransition | null {
  try {
    const resolvedStorage = storage ?? window.sessionStorage;
    const raw = resolvedStorage.getItem(REPORT_TRANSITION_STORAGE_KEY);
    resolvedStorage.removeItem(REPORT_TRANSITION_STORAGE_KEY);
    if (!raw) return null;
    const candidate = JSON.parse(raw) as Partial<StudyProfileReportTransition>;
    if (candidate.version !== 1 || candidate.responseId !== responseId) return null;
    const visitorId = typeof candidate.visitorId === "string"
      ? candidate.visitorId
      : undefined;
    const emailDelivery = typeof candidate.emailDelivery === "string"
      && EMAIL_DELIVERY_STATES.has(candidate.emailDelivery as StudyProfileReportDeliveryState)
      ? candidate.emailDelivery as StudyProfileReportDeliveryState
      : undefined;
    const waitlistError = typeof candidate.waitlistError === "string"
      ? candidate.waitlistError.slice(0, 500)
      : null;
    return { version: 1, responseId, visitorId, emailDelivery, waitlistError };
  } catch {
    return null;
  }
}
