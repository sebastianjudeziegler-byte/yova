import { z } from "zod";

export const FOUNDER_PEOPLE_PAGE_SIZE = 25;
export const FOUNDER_PEOPLE_MAX_PAGE_SIZE = 100;
export const FOUNDER_PEOPLE_EXPORT_MAX_ROWS = 5_000;

export const FounderPeopleKindFilterSchema = z.enum([
  "all",
  "accounts",
  "leads",
  "waitlist",
  "testers",
]);

export const FounderPeopleStatusFilterSchema = z.enum([
  "all",
  "onboarding_incomplete",
  "report_unlocked",
  "confirmation_pending",
  "waitlist_confirmed",
  "email_failed",
]);

const OptionalTimestampSchema = z.string().datetime({ offset: true }).nullable();
const OptionalTextSchema = z.string().max(320).nullable();
const CountSchema = z.coerce.number().int().nonnegative();
const DirectoryEmailSchema = z.string()
  .trim()
  .min(3)
  .max(320)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);

export const FounderPeopleCursorSchema = z.object({
  seenAt: z.string().datetime({ offset: true }),
  email: DirectoryEmailSchema,
}).strict();

export const FounderPeopleDirectoryRowSchema = z.object({
  email: DirectoryEmailSchema,
  kind: z.enum(["account", "lead", "linked", "tester"]),
  matchBasis: z.enum(["exact_normalized_email"]).nullable(),
  displayName: z.string().max(80).nullable(),
  recentAt: z.string().datetime({ offset: true }),
  hasYovaAccount: z.boolean(),
  hasStudyProfileLead: z.boolean(),
  accountCreatedAt: OptionalTimestampSchema,
  emailConfirmedAt: OptionalTimestampSchema,
  lastSignInAt: OptionalTimestampSchema,
  onboardingCompletedAt: OptionalTimestampSchema,
  inviteStatus: z.enum(["pending", "joined"]).nullable(),
  invitedAt: OptionalTimestampSchema,
  joinedAt: OptionalTimestampSchema,
  lastProductActivityAt: OptionalTimestampSchema,
  plansCount: CountSchema,
  sessionsCompleted: CountSchema,
  studyMinutes: CountSchema,
  leadCreatedAt: OptionalTimestampSchema,
  profileStatus: z.enum(["report_unlocked", "waitlist_only"]).nullable(),
  reportCount: CountSchema,
  latestReportAt: OptionalTimestampSchema,
  reportEmailStatus: z.enum(["pending", "sent", "failed", "skipped"]).nullable(),
  reportEmailSentAt: OptionalTimestampSchema,
  reportViewedAt: OptionalTimestampSchema,
  marketingConsentAt: OptionalTimestampSchema,
  waitlistStatus: z.enum(["not_joined", "joined"]).nullable(),
  waitlistConfirmationStatus: z.enum([
    "pending",
    "confirmed",
    "superseded",
    "expired",
    "delivery_failed",
  ]).nullable(),
  waitlistConsentSource: z.enum(["landing", "email_gate", "report_cta"]).nullable(),
  waitlistRequestedAt: OptionalTimestampSchema,
  waitlistJoinedAt: OptionalTimestampSchema,
  confirmationDeliveryStatus: z.enum(["pending", "sent", "failed"]).nullable(),
  schoolLevel: z.enum(["high_school", "college", "other"]).nullable(),
  ageBand: z.enum(["13_17", "18_plus", "unknown"]),
  primaryPattern: z.enum([
    "starting_friction",
    "structure_need",
    "attention_variability",
    "calibration_risk",
    "mistake_sensitivity",
    "cognitive_stamina",
  ]).nullable(),
  energyWindow: z.enum(["morning", "afternoon", "evening", "late_night", "varies"]).nullable(),
  source: OptionalTextSchema,
  medium: OptionalTextSchema,
  campaign: OptionalTextSchema,
  content: OptionalTextSchema,
  term: OptionalTextSchema,
  deviceType: z.enum(["mobile", "tablet", "desktop", "unknown"]),
  hasMetaClick: z.boolean(),
  betaInterest: z.boolean().nullable(),
}).strict();

export const FounderPeopleDirectoryResponseSchema = z.object({
  generatedAt: z.string().datetime({ offset: true }),
  summary: z.object({
    uniquePeople: CountSchema,
    yovaAccounts: CountSchema,
    studyProfileLeads: CountSchema,
    confirmedWaitlist: CountSchema,
    pendingInvites: CountSchema,
  }).strict(),
  total: CountSchema,
  rows: z.array(FounderPeopleDirectoryRowSchema).max(FOUNDER_PEOPLE_MAX_PAGE_SIZE),
  hasMore: z.boolean(),
  nextCursor: FounderPeopleCursorSchema.nullable(),
}).strict();

export const FounderPeopleQuerySchema = z.object({
  search: z.string().trim().max(120).default(""),
  kind: FounderPeopleKindFilterSchema.default("all"),
  status: FounderPeopleStatusFilterSchema.default("all"),
  cursor: FounderPeopleCursorSchema.nullable().default(null),
  limit: z.number().int().min(1).max(FOUNDER_PEOPLE_MAX_PAGE_SIZE).default(FOUNDER_PEOPLE_PAGE_SIZE),
}).strict();

export const FounderPeopleExportQuerySchema = FounderPeopleQuerySchema.pick({
  search: true,
  kind: true,
  status: true,
});

export type FounderPeopleKindFilter = z.infer<typeof FounderPeopleKindFilterSchema>;
export type FounderPeopleStatusFilter = z.infer<typeof FounderPeopleStatusFilterSchema>;
export type FounderPeopleCursor = z.infer<typeof FounderPeopleCursorSchema>;
export type FounderPeopleDirectoryRow = z.infer<typeof FounderPeopleDirectoryRowSchema>;
export type FounderPeopleDirectoryResponse = z.infer<typeof FounderPeopleDirectoryResponseSchema>;
export type FounderPeopleQuery = z.infer<typeof FounderPeopleQuerySchema>;
export type FounderPeopleExportQuery = z.infer<typeof FounderPeopleExportQuerySchema>;
