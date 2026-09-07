import { z } from "zod";

export const FOUNDER_ANALYTICS_WINDOWS = [7, 30, 90] as const;
export type FounderAnalyticsWindow = (typeof FOUNDER_ANALYTICS_WINDOWS)[number];

const CountSchema = z.coerce.number().int().nonnegative();
const RateSchema = z.coerce.number().finite().nonnegative();
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const DeviceBreakdownSchema = z.object({
  device: z.enum(["mobile", "tablet", "desktop", "unknown"]),
  count: CountSchema,
}).strict();

const ProductSummarySchema = z.object({
  totalAccounts: CountSchema,
  newAccounts: CountSchema,
  onboardingRate: RateSchema,
  engagedUsers: CountSchema,
  returningUsers: CountSchema,
  plansCreated: CountSchema,
  activePlans: CountSchema,
  sessionStarts: CountSchema,
  resumedSessions: CountSchema,
  sessionsCompleted: CountSchema,
  sessionCompletionRate: RateSchema,
  studyMinutes: CountSchema,
  sessionFitRate: RateSchema,
  tutorQuestions: CountSchema,
  productErrors: CountSchema,
  errorAffectedUsers: CountSchema,
  openSupportRequests: CountSchema,
}).strict();

export const FounderProductAnalyticsSchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(90),
  generatedAt: z.string().datetime({ offset: true }),
  summary: ProductSummarySchema,
  cohortFunnel: z.array(z.object({
    key: z.enum(["accounts", "onboarding", "plans", "sessions_started", "sessions_completed"]),
    label: z.string().min(1).max(80),
    count: CountSchema,
  }).strict()).length(5),
  daily: z.array(z.object({
    date: DateSchema,
    newAccounts: CountSchema,
    engagedUsers: CountSchema,
    plansCreated: CountSchema,
    sessionsCompleted: CountSchema,
  }).strict()),
  deviceBreakdown: z.array(DeviceBreakdownSchema),
  eventBreakdown: z.array(z.object({
    eventName: z.string().min(1).max(80),
    count: CountSchema,
    users: CountSchema,
  }).strict()),
}).strict();

const StudyProfileSummarySchema = z.object({
  pageViews: CountSchema,
  trackedVisits: CountSchema,
  started: CountSchema,
  completed: CountSchema,
  reportUnlocks: CountSchema,
  uniqueReportLeads: CountSchema,
  reportViews: CountSchema,
  waitlistRequests: CountSchema,
  confirmedWaitlist: CountSchema,
  reportWaitlist: CountSchema,
  shareTaps: CountSchema,
  lifetimeWaitlist: CountSchema,
  pendingConfirmations: CountSchema,
}).strict();

const StudyProfileRatesSchema = z.object({
  visitToStart: RateSchema,
  startToComplete: RateSchema,
  completeToUnlock: RateSchema,
  unlockToReportView: RateSchema,
  unlockToWaitlist: RateSchema,
  visitToWaitlist: RateSchema,
}).strict();

const AudienceBreakdownSchema = z.object({
  key: z.string().min(1).max(100),
  count: CountSchema,
  percent: RateSchema,
}).strict();

export const FounderStudyProfileAnalyticsSchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(90),
  generatedAt: z.string().datetime({ offset: true }),
  summary: StudyProfileSummarySchema,
  rates: StudyProfileRatesSchema,
  daily: z.array(z.object({
    date: DateSchema,
    pageViews: CountSchema,
    trackedVisits: CountSchema,
    started: CountSchema,
    completed: CountSchema,
    reportUnlocks: CountSchema,
    confirmedWaitlist: CountSchema,
  }).strict()),
  questionReach: z.array(z.object({
    questionNumber: z.coerce.number().int().min(1).max(14),
    answeredJourneys: CountSchema,
    percentOfStarts: RateSchema,
    dropFromPrevious: z.coerce.number().int(),
  }).strict()).length(14),
  acquisition: z.array(z.object({
    source: z.string().min(1).max(100),
    medium: z.string().min(1).max(100),
    campaign: z.string().min(1).max(160),
    visits: CountSchema,
    started: CountSchema,
    completed: CountSchema,
    reportUnlocks: CountSchema,
    confirmedWaitlist: CountSchema,
  }).strict()),
  audience: z.object({
    patterns: z.array(AudienceBreakdownSchema),
    schoolLevels: z.array(AudienceBreakdownSchema),
    energyWindows: z.array(AudienceBreakdownSchema),
  }).strict(),
  delivery: z.object({
    reportSent: CountSchema,
    reportFailed: CountSchema,
    reportPending: CountSchema,
    reportSkipped: CountSchema,
    confirmationSent: CountSchema,
    confirmationFailed: CountSchema,
    confirmationPending: CountSchema,
  }).strict(),
  deviceBreakdown: z.array(DeviceBreakdownSchema),
}).strict();

export type FounderProductAnalytics = z.infer<typeof FounderProductAnalyticsSchema>;
export type FounderStudyProfileAnalytics = z.infer<typeof FounderStudyProfileAnalyticsSchema>;

export function parseFounderAnalyticsWindow(
  rawValue: string | string[] | undefined,
): FounderAnalyticsWindow {
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  const parsed = Number(value);
  return FOUNDER_ANALYTICS_WINDOWS.includes(parsed as FounderAnalyticsWindow)
    ? parsed as FounderAnalyticsWindow
    : 30;
}

export function safeRate(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1_000) / 10;
}
