import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import {
  STUDY_PROFILE_MODEL_VERSION,
  STUDY_PROFILE_SCORING_REVISION,
  STUDY_PROFILE_STUDY_GOALS,
  StudyProfileReportSchema,
  StudyProfileAnswersSchema,
  StudyProfileSnapshotSchema,
  StudyProfileStoredResponseSchema,
  buildStudyProfileReportFromStoredResponse,
  normalizeStudyProfileEmail,
  type StudyProfileAnswers,
  type StudyProfileMetadata,
  type StudyProfileReport,
  type StudyProfileSnapshot,
  type StudyProfileStoredResponse,
  type StudyProfileStudyGoal,
  type StudyProfileSubmission,
} from "@/lib/study-profile";

export const STUDY_PROFILE_CONSENT_COPY_VERSION = "study-profile-updates-v1";
export const STUDY_PROFILE_WAITLIST_SOURCES = [
  "landing",
  "email_gate",
  "report_cta",
] as const;
export type StudyProfileWaitlistSource = (typeof STUDY_PROFILE_WAITLIST_SOURCES)[number];

export const STUDY_PROFILE_WAITLIST_CONSENT_COPY_VERSIONS: Record<
  StudyProfileWaitlistSource,
  string
> = {
  landing: "study-profile-waitlist-v4-landing",
  email_gate: "study-profile-waitlist-v4-email-gate",
  report_cta: "study-profile-waitlist-v4-report-cta",
};

// Retained as the default report-CTA version for compatibility with existing
// repository consumers. New callers should pass an explicit source.
export const STUDY_PROFILE_WAITLIST_CONSENT_COPY_VERSION =
  STUDY_PROFILE_WAITLIST_CONSENT_COPY_VERSIONS.report_cta;

export type StudyProfileEmailDeliveryStatus = "pending" | "sent" | "failed" | "skipped";

export type PersistStudyProfileResponseInput = {
  email: string;
  visitorId: string;
  answers: StudyProfileAnswers;
  snapshot: StudyProfileSnapshot;
  metadata: StudyProfileMetadata;
  report: StudyProfileReport;
  marketingConsent: boolean;
  attribution?: StudyProfileSubmission["attribution"];
};

export type SavedStudyProfileResponse = {
  storedResponse: StudyProfileStoredResponse;
  report: StudyProfileReport;
  waitlistJoined: boolean;
  confirmationPending: boolean;
  betaInterest: boolean | null;
};

export type StudyProfileEventRecord = {
  visitorId?: string | null;
  responseId?: string | null;
  eventName:
    | "study_profile_page_viewed"
    | "study_profile_started"
    | "study_profile_question_answered"
    | "study_profile_completed"
    | "study_profile_email_submitted"
    | "study_profile_report_viewed"
    | "study_profile_waitlist_joined"
    | "study_profile_share_tapped"
    | "study_profile_beta_interest";
  eventData: Record<string, string | number | boolean | null>;
  attribution?: StudyProfileSubmission["attribution"];
};

export type StudyProfileInterestState = {
  waitlistJoined: boolean;
  betaInterest: boolean | null;
};

export type StudyProfileWaitlistJoinState = StudyProfileInterestState & {
  newlyJoined: boolean;
};

export type StudyProfileWaitlistConfirmationRequestState = {
  waitlistJoined: boolean;
  confirmationPending: boolean;
  dailyCapReached: boolean;
  shouldSend: boolean;
  confirmationId: string | null;
  email: string | null;
  retryAfterSeconds: number;
};

export type StudyProfileWaitlistConfirmationResult = {
  status: "confirmed" | "invalid" | "expired";
  waitlistJoined: boolean;
  newlyJoined: boolean;
};

export type StudyProfileReportEmailReservation = {
  allowed: boolean;
  reason: "cooldown" | "daily_cap" | null;
  retryAfterSeconds: number;
};

export type JoinStudyProfileWaitlistByEmailInput = {
  email: string;
  visitorId: string;
  attribution?: StudyProfileSubmission["attribution"];
};

export type RequestStudyProfileWaitlistByEmailInput =
  JoinStudyProfileWaitlistByEmailInput & {
    confirmationTokenHash: string;
  };

export interface StudyProfileRepository {
  saveResponse(input: PersistStudyProfileResponseInput): Promise<SavedStudyProfileResponse>;
  getReportByToken(reportToken: string): Promise<SavedStudyProfileResponse | null>;
  requestWaitlistConfirmation(
    reportToken: string,
    source: Exclude<StudyProfileWaitlistSource, "landing">,
    confirmationTokenHash: string,
  ): Promise<StudyProfileWaitlistConfirmationRequestState | null>;
  requestWaitlistConfirmationByEmail(
    input: RequestStudyProfileWaitlistByEmailInput,
  ): Promise<StudyProfileWaitlistConfirmationRequestState>;
  markWaitlistConfirmationDelivery(
    confirmationId: string,
    status: "sent" | "failed",
    providerMessageId?: string | null,
  ): Promise<void>;
  confirmWaitlist(
    confirmationTokenHash: string,
  ): Promise<StudyProfileWaitlistConfirmationResult>;
  reserveReportEmailDelivery(
    responseId: string,
  ): Promise<StudyProfileReportEmailReservation>;
  setBetaInterest(reportToken: string, interested: boolean): Promise<StudyProfileInterestState | null>;
  recordEvent(event: StudyProfileEventRecord): Promise<void>;
  markEmailDelivery(
    responseId: string,
    status: StudyProfileEmailDeliveryStatus,
    providerMessageId?: string | null,
  ): Promise<void>;
}

export class StudyProfilePersistenceUnavailableError extends Error {
  constructor() {
    super("Study Profile persistence is not configured.");
    this.name = "StudyProfilePersistenceUnavailableError";
  }
}

export class StudyProfileCommittedWriteError extends Error {
  readonly reportToken: string;

  constructor(reportToken: string, cause?: unknown) {
    super("The Study Profile was saved, but its persistence receipt could not be recovered.", { cause });
    this.name = "StudyProfileCommittedWriteError";
    this.reportToken = reportToken;
  }
}

export class StudyProfileSaveOutcomeUnknownError extends Error {
  readonly reportToken: string;

  constructor(reportToken: string, cause?: unknown) {
    super("YOVA could not confirm whether the Study Profile save committed.", { cause });
    this.name = "StudyProfileSaveOutcomeUnknownError";
    this.reportToken = reportToken;
  }
}

export class StudyProfileInterestStateError extends Error {
  constructor() {
    super("Join the YOVA waitlist before updating interest preferences.");
    this.name = "StudyProfileInterestStateError";
  }
}

type MemoryLead = {
  id: string;
  email: string;
  marketingConsent: boolean;
  waitlistJoined: boolean;
  waitlistJoinedAt: string | null;
  waitlistConsentCopyVersion: string | null;
  waitlistConsentSource: StudyProfileWaitlistSource | null;
  betaInterest: boolean | null;
  reportEmailNextAllowedAt: string | null;
};

type MemoryWaitlistConfirmation = {
  id: string;
  leadId: string;
  responseId: string | null;
  visitorId: string | null;
  tokenHash: string | null;
  consumedTokenHash: string | null;
  status: "pending" | "confirmed" | "superseded" | "expired" | "delivery_failed";
  consentCopyVersion: string;
  consentSource: StudyProfileWaitlistSource;
  scoringRevision: string;
  profileModelVersion: string;
  requestedAt: string;
  expiresAt: string;
  resendAfter: string;
  confirmedAt: string | null;
  replayExpiresAt: string | null;
  deliveryStatus: "pending" | "sent" | "failed";
  attribution?: StudyProfileSubmission["attribution"];
};

type MemoryEmailDeliveryAttempt = {
  leadId: string;
  kind: "report" | "waitlist_confirmation";
  reservedAt: string;
};

type MemoryResponse = SavedStudyProfileResponse & {
  leadId: string;
  tokenHash: string;
  emailDeliveryStatus: StudyProfileEmailDeliveryStatus;
};

type MemoryState = {
  leadsByEmail: Map<string, MemoryLead>;
  responsesByTokenHash: Map<string, MemoryResponse>;
  waitlistConfirmations: MemoryWaitlistConfirmation[];
  emailDeliveryAttempts: MemoryEmailDeliveryAttempt[];
  events: StudyProfileEventRecord[];
};

type RepositoryClock = {
  now: () => Date;
  token: () => string;
  uuid: () => string;
};

const DEFAULT_CLOCK: RepositoryClock = {
  now: () => new Date(),
  token: generateStudyProfileReportToken,
  uuid: randomUUID,
};

const STUDY_PROFILE_WAITLIST_CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1_000;
const STUDY_PROFILE_WAITLIST_RESEND_COOLDOWN_MS = 15 * 60 * 1_000;
const STUDY_PROFILE_REPORT_EMAIL_COOLDOWN_MS = 15 * 60 * 1_000;
const STUDY_PROFILE_EMAIL_DAILY_WINDOW_MS = 24 * 60 * 60 * 1_000;
const STUDY_PROFILE_EMAIL_DAILY_ATTEMPT_LIMIT = 5;

declare global {
  var __yovaStudyProfileMemoryState: MemoryState | undefined;
}

export class MemoryStudyProfileRepository implements StudyProfileRepository {
  private readonly state: MemoryState;
  private readonly clock: RepositoryClock;

  constructor(
    state: MemoryState = createMemoryState(),
    clock: Partial<RepositoryClock> = {},
  ) {
    this.state = state;
    this.clock = { ...DEFAULT_CLOCK, ...clock };
  }

  async saveResponse(input: PersistStudyProfileResponseInput) {
    const email = normalizeStudyProfileEmail(input.email);
    let lead = this.state.leadsByEmail.get(email);
    if (!lead) {
      lead = {
        id: this.clock.uuid(),
        email,
        marketingConsent: input.marketingConsent,
        waitlistJoined: false,
        waitlistJoinedAt: null,
        waitlistConsentCopyVersion: null,
        waitlistConsentSource: null,
        betaInterest: null,
        reportEmailNextAllowedAt: null,
      };
      this.state.leadsByEmail.set(email, lead);
    } else if (input.marketingConsent) {
      lead.marketingConsent = true;
    }

    const reportToken = this.clock.token();
    const storedResponse = StudyProfileStoredResponseSchema.parse({
      id: this.clock.uuid(),
      reportToken,
      profileModelVersion: STUDY_PROFILE_MODEL_VERSION,
      rawAnswers: input.answers,
      snapshot: input.snapshot,
      metadata: input.metadata,
      createdAt: this.clock.now().toISOString(),
    });
    const saved: MemoryResponse = {
      storedResponse,
      report: input.report,
      leadId: lead.id,
      tokenHash: hashStudyProfileReportToken(reportToken),
      emailDeliveryStatus: "pending",
      waitlistJoined: lead.waitlistJoined,
      confirmationPending: false,
      betaInterest: lead.betaInterest,
    };
    this.state.responsesByTokenHash.set(saved.tokenHash, saved);
    this.state.events.push({
      visitorId: input.visitorId,
      responseId: storedResponse.id,
      eventName: "study_profile_email_submitted",
      eventData: { scoringRevision: STUDY_PROFILE_SCORING_REVISION },
      attribution: input.attribution,
    });
    return publicMemoryResponse(saved, lead);
  }

  async getReportByToken(reportToken: string) {
    const response = this.state.responsesByTokenHash.get(hashStudyProfileReportToken(reportToken));
    if (!response) return null;
    const lead = [...this.state.leadsByEmail.values()].find(({ id }) => id === response.leadId);
    if (!lead) return null;
    const responseId = response.storedResponse.id;
    const waitlistJoined = this.state.waitlistConfirmations.some((confirmation) => (
      confirmation.responseId === responseId
      && confirmation.status === "confirmed"
    ));
    const confirmationPending = !waitlistJoined
      && this.state.waitlistConfirmations.some((confirmation) => (
        confirmation.responseId === responseId
        && confirmation.status === "pending"
        && new Date(confirmation.expiresAt).getTime() > this.clock.now().getTime()
      ));
    return publicMemoryResponse(response, lead, reportToken, {
      waitlistJoined,
      confirmationPending,
    });
  }

  async requestWaitlistConfirmation(
    reportToken: string,
    source: Exclude<StudyProfileWaitlistSource, "landing">,
    confirmationTokenHash: string,
  ) {
    const resolved = this.resolveLead(reportToken);
    if (!resolved) return null;
    const responseId = resolved.response.storedResponse.id;
    const scopedConfirmed = this.state.waitlistConfirmations.some((confirmation) => (
      confirmation.responseId === responseId
      && confirmation.status === "confirmed"
    ));
    if (scopedConfirmed) {
      return {
        waitlistJoined: true,
        confirmationPending: false,
        dailyCapReached: false,
        shouldSend: false,
        confirmationId: null,
        email: null,
        retryAfterSeconds: 0,
      };
    }
    if (resolved.lead.waitlistJoined) {
      return {
        waitlistJoined: false,
        confirmationPending: true,
        dailyCapReached: false,
        shouldSend: false,
        confirmationId: null,
        email: null,
        retryAfterSeconds: 0,
      };
    }
    return this.requestConfirmation({
      lead: resolved.lead,
      responseId,
      visitorId: null,
      confirmationTokenHash,
      source,
      scoringRevision: resolved.response.report.scoringRevision,
      profileModelVersion: resolved.response.storedResponse.profileModelVersion,
    });
  }

  async requestWaitlistConfirmationByEmail(
    input: RequestStudyProfileWaitlistByEmailInput,
  ) {
    const email = normalizeStudyProfileEmail(input.email);
    let lead = this.state.leadsByEmail.get(email);
    if (!lead) {
      lead = {
        id: this.clock.uuid(),
        email,
        marketingConsent: false,
        waitlistJoined: false,
        waitlistJoinedAt: null,
        waitlistConsentCopyVersion: null,
        waitlistConsentSource: null,
        betaInterest: null,
        reportEmailNextAllowedAt: null,
      };
      this.state.leadsByEmail.set(email, lead);
    }
    return this.requestConfirmation({
      lead,
      responseId: null,
      visitorId: input.visitorId,
      confirmationTokenHash: input.confirmationTokenHash,
      source: "landing",
      scoringRevision: STUDY_PROFILE_SCORING_REVISION,
      profileModelVersion: STUDY_PROFILE_MODEL_VERSION,
      attribution: input.attribution,
    });
  }

  async markWaitlistConfirmationDelivery(
    confirmationId: string,
    status: "sent" | "failed",
  ) {
    const confirmation = this.state.waitlistConfirmations
      .find(({ id }) => id === confirmationId);
    if (!confirmation || confirmation.status !== "pending") return;
    confirmation.deliveryStatus = status;
    if (status === "failed") {
      confirmation.status = "delivery_failed";
      confirmation.tokenHash = null;
      confirmation.expiresAt = this.clock.now().toISOString();
      confirmation.resendAfter = this.clock.now().toISOString();
    }
  }

  async confirmWaitlist(confirmationTokenHash: string) {
    const confirmation = this.state.waitlistConfirmations.find((candidate) => (
      candidate.status === "pending" && candidate.tokenHash === confirmationTokenHash
    ));
    if (!confirmation) {
      const replay = this.state.waitlistConfirmations.find((candidate) => (
        candidate.status === "confirmed"
        && candidate.consumedTokenHash === confirmationTokenHash
        && candidate.replayExpiresAt !== null
        && new Date(candidate.replayExpiresAt).getTime() > this.clock.now().getTime()
      ));
      if (replay) {
        return { status: "confirmed" as const, waitlistJoined: true, newlyJoined: false };
      }
      return { status: "invalid" as const, waitlistJoined: false, newlyJoined: false };
    }
    if (new Date(confirmation.expiresAt).getTime() <= this.clock.now().getTime()) {
      confirmation.status = "expired";
      confirmation.tokenHash = null;
      return { status: "expired" as const, waitlistJoined: false, newlyJoined: false };
    }
    const lead = [...this.state.leadsByEmail.values()]
      .find(({ id }) => id === confirmation.leadId);
    if (!lead) {
      return { status: "invalid" as const, waitlistJoined: false, newlyJoined: false };
    }
    const newlyJoined = !lead.waitlistJoined;
    if (newlyJoined) {
      lead.waitlistJoined = true;
      lead.waitlistJoinedAt = this.clock.now().toISOString();
      lead.waitlistConsentCopyVersion = confirmation.consentCopyVersion;
      lead.waitlistConsentSource = confirmation.consentSource;
      this.state.events.push({
        ...(confirmation.visitorId ? { visitorId: confirmation.visitorId } : {}),
        ...(confirmation.responseId ? { responseId: confirmation.responseId } : {}),
        eventName: "study_profile_waitlist_joined",
        eventData: {
          source: confirmation.consentSource,
          scoringRevision: confirmation.scoringRevision,
          doubleOptIn: true,
        },
        attribution: confirmation.attribution,
      });
    }
    confirmation.status = "confirmed";
    confirmation.tokenHash = null;
    confirmation.consumedTokenHash = confirmationTokenHash;
    confirmation.confirmedAt = this.clock.now().toISOString();
    confirmation.replayExpiresAt = new Date(Math.min(
      new Date(confirmation.expiresAt).getTime(),
      this.clock.now().getTime() + STUDY_PROFILE_WAITLIST_RESEND_COOLDOWN_MS,
    )).toISOString();
    return { status: "confirmed" as const, waitlistJoined: true, newlyJoined };
  }

  async reserveReportEmailDelivery(responseId: string) {
    const response = [...this.state.responsesByTokenHash.values()]
      .find(({ storedResponse }) => storedResponse.id === responseId);
    if (!response) return { allowed: false, reason: "cooldown" as const, retryAfterSeconds: 1 };
    const lead = [...this.state.leadsByEmail.values()]
      .find(({ id }) => id === response.leadId);
    if (!lead) return { allowed: false, reason: "cooldown" as const, retryAfterSeconds: 1 };
    const now = this.clock.now();
    const dailyAttempts = this.state.emailDeliveryAttempts
      .filter((attempt) => (
        attempt.leadId === lead.id
        && new Date(attempt.reservedAt).getTime()
          > now.getTime() - STUDY_PROFILE_EMAIL_DAILY_WINDOW_MS
      ))
      .sort((left, right) => left.reservedAt.localeCompare(right.reservedAt));
    if (dailyAttempts.length >= STUDY_PROFILE_EMAIL_DAILY_ATTEMPT_LIMIT) {
      response.emailDeliveryStatus = "skipped";
      const retryAt = new Date(dailyAttempts[0].reservedAt).getTime()
        + STUDY_PROFILE_EMAIL_DAILY_WINDOW_MS;
      return {
        allowed: false,
        reason: "daily_cap" as const,
        retryAfterSeconds: Math.min(
          86_400,
          Math.max(1, Math.ceil((retryAt - now.getTime()) / 1_000)),
        ),
      };
    }
    const nextAllowedAt = lead.reportEmailNextAllowedAt
      ? new Date(lead.reportEmailNextAllowedAt)
      : null;
    if (!nextAllowedAt || nextAllowedAt.getTime() <= now.getTime()) {
      lead.reportEmailNextAllowedAt = new Date(
        now.getTime() + STUDY_PROFILE_REPORT_EMAIL_COOLDOWN_MS,
      ).toISOString();
      this.state.emailDeliveryAttempts.push({
        leadId: lead.id,
        kind: "report",
        reservedAt: now.toISOString(),
      });
      return { allowed: true, reason: null, retryAfterSeconds: 0 };
    }
    response.emailDeliveryStatus = "skipped";
    return {
      allowed: false,
      reason: "cooldown" as const,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((nextAllowedAt.getTime() - now.getTime()) / 1_000),
      ),
    };
  }

  async setBetaInterest(reportToken: string, interested: boolean) {
    const resolved = this.resolveLead(reportToken);
    if (!resolved) return null;
    if (!resolved.lead.waitlistJoined) throw new StudyProfileInterestStateError();
    resolved.lead.betaInterest = interested;
    return { waitlistJoined: true, betaInterest: interested };
  }

  async recordEvent(event: StudyProfileEventRecord) {
    this.state.events.push(structuredClone({
      ...event,
      eventData: {
        scoringRevision: STUDY_PROFILE_SCORING_REVISION,
        ...event.eventData,
      },
    }));
  }

  async markEmailDelivery(
    responseId: string,
    status: StudyProfileEmailDeliveryStatus,
  ) {
    const response = [...this.state.responsesByTokenHash.values()]
      .find(({ storedResponse }) => storedResponse.id === responseId);
    if (response) response.emailDeliveryStatus = status;
  }

  inspect() {
    return this.state;
  }

  private resolveLead(reportToken: string) {
    const response = this.state.responsesByTokenHash.get(hashStudyProfileReportToken(reportToken));
    if (!response) return null;
    const lead = [...this.state.leadsByEmail.values()].find(({ id }) => id === response.leadId);
    return lead ? { response, lead } : null;
  }

  private requestConfirmation(input: {
    lead: MemoryLead;
    responseId: string | null;
    visitorId: string | null;
    confirmationTokenHash: string;
    source: StudyProfileWaitlistSource;
    scoringRevision: string;
    profileModelVersion: string;
    attribution?: StudyProfileSubmission["attribution"];
  }): StudyProfileWaitlistConfirmationRequestState {
    if (input.lead.waitlistJoined) {
      return {
        waitlistJoined: true,
        confirmationPending: false,
        dailyCapReached: false,
        shouldSend: false,
        confirmationId: null,
        email: null,
        retryAfterSeconds: 0,
      };
    }
    const now = this.clock.now();
    const pending = this.state.waitlistConfirmations
      .filter(({ leadId, responseId, status }) => (
        leadId === input.lead.id
        && responseId === input.responseId
        && status === "pending"
      ))
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))[0];
    if (pending && new Date(pending.expiresAt).getTime() > now.getTime()) {
      if (new Date(pending.resendAfter).getTime() > now.getTime()) {
        return {
          waitlistJoined: false,
          confirmationPending: true,
          dailyCapReached: false,
          shouldSend: false,
          confirmationId: pending.id,
          email: input.lead.email,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((new Date(pending.resendAfter).getTime() - now.getTime()) / 1_000),
          ),
        };
      }
    } else if (pending) {
      pending.status = "expired";
      pending.tokenHash = null;
    }
    const latestConfirmationAttempt = this.state.emailDeliveryAttempts
      .filter((attempt) => (
        attempt.leadId === input.lead.id
        && attempt.kind === "waitlist_confirmation"
      ))
      .sort((left, right) => right.reservedAt.localeCompare(left.reservedAt))[0];
    if (
      latestConfirmationAttempt
      && new Date(latestConfirmationAttempt.reservedAt).getTime()
        > now.getTime() - STUDY_PROFILE_WAITLIST_RESEND_COOLDOWN_MS
    ) {
      const retryAt = new Date(latestConfirmationAttempt.reservedAt).getTime()
        + STUDY_PROFILE_WAITLIST_RESEND_COOLDOWN_MS;
      return {
        waitlistJoined: false,
        confirmationPending: true,
        dailyCapReached: false,
        shouldSend: false,
        confirmationId: null,
        email: null,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((retryAt - now.getTime()) / 1_000),
        ),
      };
    }
    const dailyAttempts = this.state.emailDeliveryAttempts
      .filter((attempt) => (
        attempt.leadId === input.lead.id
        && new Date(attempt.reservedAt).getTime()
          > now.getTime() - STUDY_PROFILE_EMAIL_DAILY_WINDOW_MS
      ))
      .sort((left, right) => left.reservedAt.localeCompare(right.reservedAt));
    if (dailyAttempts.length >= STUDY_PROFILE_EMAIL_DAILY_ATTEMPT_LIMIT) {
      const retryAt = new Date(dailyAttempts[0].reservedAt).getTime()
        + STUDY_PROFILE_EMAIL_DAILY_WINDOW_MS;
      return {
        waitlistJoined: false,
        confirmationPending: false,
        dailyCapReached: true,
        shouldSend: false,
        confirmationId: null,
        email: null,
        retryAfterSeconds: Math.min(
          86_400,
          Math.max(1, Math.ceil((retryAt - now.getTime()) / 1_000)),
        ),
      };
    }
    if (pending && pending.status === "pending") {
      pending.status = "superseded";
      pending.tokenHash = null;
    }
    const confirmation: MemoryWaitlistConfirmation = {
      id: this.clock.uuid(),
      leadId: input.lead.id,
      responseId: input.responseId,
      visitorId: input.visitorId,
      tokenHash: input.confirmationTokenHash,
      consumedTokenHash: null,
      status: "pending",
      consentCopyVersion: STUDY_PROFILE_WAITLIST_CONSENT_COPY_VERSIONS[input.source],
      consentSource: input.source,
      scoringRevision: input.scoringRevision,
      profileModelVersion: input.profileModelVersion,
      requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + STUDY_PROFILE_WAITLIST_CONFIRMATION_TTL_MS)
        .toISOString(),
      resendAfter: new Date(now.getTime() + STUDY_PROFILE_WAITLIST_RESEND_COOLDOWN_MS)
        .toISOString(),
      confirmedAt: null,
      replayExpiresAt: null,
      deliveryStatus: "pending",
      attribution: input.attribution,
    };
    this.state.waitlistConfirmations.push(confirmation);
    this.state.emailDeliveryAttempts.push({
      leadId: input.lead.id,
      kind: "waitlist_confirmation",
      reservedAt: now.toISOString(),
    });
    return {
      waitlistJoined: false,
      confirmationPending: true,
      dailyCapReached: false,
      shouldSend: true,
      confirmationId: confirmation.id,
      email: input.lead.email,
      retryAfterSeconds: 0,
    };
  }
}

export class SupabaseStudyProfileRepository implements StudyProfileRepository {
  async saveResponse(input: PersistStudyProfileResponseInput) {
    const supabase = createSupabaseAdminClient();
    const reportToken = generateStudyProfileReportToken();
    const reportTokenHash = hashStudyProfileReportToken(reportToken);
    const createdAt = new Date().toISOString();
    const attribution = persistenceAttribution(input.attribution);
    let data: unknown = null;
    let rpcFailure: unknown = null;
    try {
      const result = await supabase.rpc("save_study_profile_response", {
        payload: {
          email: normalizeStudyProfileEmail(input.email),
          visitorId: input.visitorId,
          reportTokenHash,
          profileModelVersion: STUDY_PROFILE_MODEL_VERSION,
          rawAnswers: input.answers,
          profileSnapshot: input.snapshot,
          metadata: input.metadata,
          reportState: {
            report: input.report,
            metadata: {
              studyGoal: input.metadata.studyGoal ?? null,
            },
          },
          marketingConsent: input.marketingConsent,
          consentCopyVersion: STUDY_PROFILE_CONSENT_COPY_VERSION,
          attribution,
          emailDeliveryStatus: "pending",
        },
      });
      data = result.data;
      rpcFailure = result.error;
    } catch (error) {
      rpcFailure = error;
    }

    if (rpcFailure) {
      const recovery = await recoverSavedStudyProfileResponse(
        supabase,
        input,
        reportToken,
        reportTokenHash,
      );
      if (recovery.status === "saved") return recovery.value;
      if (recovery.status === "unknown") {
        throw new StudyProfileSaveOutcomeUnknownError(reportToken, rpcFailure);
      }
      throw new Error("YOVA could not save this Study Profile response.", { cause: rpcFailure });
    }

    try {
      const responseId = readRpcId(data, "responseId");
      readRpcId(data, "leadId");
      return savedStudyProfileResponse(
        input,
        reportToken,
        responseId,
        createdAt,
      );
    } catch (receiptError) {
      // The RPC has already committed at this point. Recover the canonical row
      // by its unique private token hash so response-envelope drift cannot make
      // the learner submit a duplicate profile.
      const recovery = await recoverSavedStudyProfileResponse(
        supabase,
        input,
        reportToken,
        reportTokenHash,
      );
      if (recovery.status === "saved") return recovery.value;
      throw new StudyProfileCommittedWriteError(reportToken, receiptError);
    }
  }

  async getReportByToken(reportToken: string) {
    const supabase = createSupabaseAdminClient();
    const { data: row, error } = await supabase
      .from("study_profile_responses")
      .select("id, lead_id, profile_model_version, raw_answers, profile_snapshot, report_state, energy_window, school_level, optional_free_response, created_at")
      .eq("report_token_hash", hashStudyProfileReportToken(reportToken))
      .maybeSingle();
    if (error) throw new Error("YOVA could not load this Study Profile report.", { cause: error });
    if (!row) return null;

    const waitlistState = await readReportWaitlistConfirmationState(supabase, row.id);

    const persistedState = readPersistedStudyProfileState(row.report_state);
    const rawAnswers = StudyProfileAnswersSchema.parse(row.raw_answers);
    const snapshot = StudyProfileSnapshotSchema.parse(row.profile_snapshot);
    const storedResponse = StudyProfileStoredResponseSchema.parse({
      id: row.id,
      reportToken,
      profileModelVersion: row.profile_model_version,
      rawAnswers,
      snapshot,
      metadata: {
        energyWindow: row.energy_window,
        schoolLevel: row.school_level,
        ...(persistedState.studyGoal ? { studyGoal: persistedState.studyGoal } : {}),
        hardestPart: row.optional_free_response,
      },
      createdAt: row.created_at,
    });
    return {
      storedResponse,
      report: persistedState.report ?? buildStudyProfileReportFromStoredResponse(storedResponse),
      waitlistJoined: waitlistState.waitlistJoined,
      confirmationPending: waitlistState.confirmationPending,
      betaInterest: null,
    };
  }

  async requestWaitlistConfirmation(
    reportToken: string,
    source: Exclude<StudyProfileWaitlistSource, "landing">,
    confirmationTokenHash: string,
  ) {
    const { data, error } = await createSupabaseAdminClient().rpc(
      "request_study_profile_report_waitlist_confirmation",
      {
        payload: {
          reportTokenHash: hashStudyProfileReportToken(reportToken),
          confirmationTokenHash,
          ageConfirmed: true,
          consentCopyVersion: STUDY_PROFILE_WAITLIST_CONSENT_COPY_VERSIONS[source],
          consentSource: source,
        },
      },
    );
    if (error) throw new Error("YOVA could not request waitlist confirmation.", { cause: error });
    if (data === null) return null;
    return parseWaitlistConfirmationRequestReceipt(data);
  }

  async requestWaitlistConfirmationByEmail(
    input: RequestStudyProfileWaitlistByEmailInput,
  ) {
    const attribution = persistenceAttribution(input.attribution);
    const { data, error } = await createSupabaseAdminClient().rpc(
      "request_study_profile_waitlist_confirmation",
      {
        payload: {
          email: normalizeStudyProfileEmail(input.email),
          visitorId: input.visitorId,
          confirmationTokenHash: input.confirmationTokenHash,
          ageConfirmed: true,
          consentCopyVersion: STUDY_PROFILE_WAITLIST_CONSENT_COPY_VERSIONS.landing,
          attribution,
        },
      },
    );
    if (error) throw new Error("YOVA could not request waitlist confirmation.", { cause: error });
    return parseWaitlistConfirmationRequestReceipt(data);
  }

  async markWaitlistConfirmationDelivery(
    confirmationId: string,
    status: "sent" | "failed",
    providerMessageId?: string | null,
  ) {
    const { data, error } = await createSupabaseAdminClient().rpc(
      "mark_study_profile_waitlist_confirmation_delivery",
      {
        payload: {
          confirmationId,
          deliveryStatus: status,
          providerMessageId: providerMessageId || null,
        },
      },
    );
    if (error) {
      throw new Error("YOVA could not record waitlist confirmation delivery.", {
        cause: error,
      });
    }
    if (!data || typeof data !== "object" || (data as Record<string, unknown>).updated !== true) {
      throw new Error("YOVA could not confirm waitlist email delivery bookkeeping.");
    }
  }

  async confirmWaitlist(confirmationTokenHash: string) {
    const { data, error } = await createSupabaseAdminClient().rpc(
      "confirm_study_profile_waitlist",
      { payload: { confirmationTokenHash } },
    );
    if (error) throw new Error("YOVA could not confirm that waitlist request.", { cause: error });
    return parseWaitlistConfirmationResult(data);
  }

  async reserveReportEmailDelivery(responseId: string) {
    const { data, error } = await createSupabaseAdminClient().rpc(
      "reserve_study_profile_report_email_delivery",
      { payload: { responseId } },
    );
    if (error) throw new Error("YOVA could not reserve report email delivery.", { cause: error });
    return parseReportEmailReservation(data);
  }

  async setBetaInterest(reportToken: string, interested: boolean) {
    const resolved = await this.findLeadByToken(reportToken);
    if (!resolved) return null;
    const supabase = createSupabaseAdminClient();
    const { data: lead, error: leadError } = await supabase
      .from("study_profile_leads")
      .select("waitlist_status")
      .eq("id", resolved.leadId)
      .single();
    if (leadError) throw new Error("YOVA could not update beta interest.", { cause: leadError });
    if (lead.waitlist_status !== "joined") throw new StudyProfileInterestStateError();

    const { error } = await supabase
      .from("study_profile_leads")
      .update({ beta_interest: interested, beta_interest_updated_at: new Date().toISOString() })
      .eq("id", resolved.leadId);
    if (error) throw new Error("YOVA could not update beta interest.", { cause: error });
    return { waitlistJoined: true, betaInterest: interested };
  }

  async recordEvent(event: StudyProfileEventRecord) {
    const attribution = persistenceAttribution(event.attribution);
    const { error } = await createSupabaseAdminClient().from("study_profile_events").insert({
      visitor_id: event.visitorId || null,
      response_id: event.responseId || null,
      event_name: event.eventName,
      event_data: {
        scoringRevision: STUDY_PROFILE_SCORING_REVISION,
        ...event.eventData,
      },
      profile_model_version: STUDY_PROFILE_MODEL_VERSION,
      traffic_source: attribution.source,
      referrer_host: attribution.referrerHost,
      utm_source: attribution.utmSource,
      utm_medium: attribution.utmMedium,
      utm_campaign: attribution.utmCampaign,
      utm_content: attribution.utmContent,
      utm_term: attribution.utmTerm,
    });
    if (error) throw new Error("YOVA could not record the Study Profile event.", { cause: error });
  }

  async markEmailDelivery(
    responseId: string,
    status: StudyProfileEmailDeliveryStatus,
    providerMessageId?: string | null,
  ) {
    const now = new Date().toISOString();
    const { error } = await createSupabaseAdminClient()
      .from("study_profile_responses")
      .update({
        email_delivery_status: status,
        email_provider_message_id: providerMessageId || null,
        email_last_attempted_at: now,
        email_sent_at: status === "sent" ? now : null,
      })
      .eq("id", responseId);
    if (error) throw new Error("YOVA could not record report email delivery.", { cause: error });
  }

  private async findLeadByToken(reportToken: string) {
    const { data, error } = await createSupabaseAdminClient()
      .from("study_profile_responses")
      .select("id, lead_id")
      .eq("report_token_hash", hashStudyProfileReportToken(reportToken))
      .maybeSingle();
    if (error) throw new Error("YOVA could not resolve that report.", { cause: error });
    return data ? { responseId: data.id as string, leadId: data.lead_id as string } : null;
  }
}

class UnavailableStudyProfileRepository implements StudyProfileRepository {
  async saveResponse(): Promise<never> { throw new StudyProfilePersistenceUnavailableError(); }
  async getReportByToken(): Promise<never> { throw new StudyProfilePersistenceUnavailableError(); }
  async requestWaitlistConfirmation(): Promise<never> { throw new StudyProfilePersistenceUnavailableError(); }
  async requestWaitlistConfirmationByEmail(): Promise<never> { throw new StudyProfilePersistenceUnavailableError(); }
  async markWaitlistConfirmationDelivery(): Promise<never> { throw new StudyProfilePersistenceUnavailableError(); }
  async confirmWaitlist(): Promise<never> { throw new StudyProfilePersistenceUnavailableError(); }
  async reserveReportEmailDelivery(): Promise<never> { throw new StudyProfilePersistenceUnavailableError(); }
  async setBetaInterest(): Promise<never> { throw new StudyProfilePersistenceUnavailableError(); }
  async recordEvent(): Promise<never> { throw new StudyProfilePersistenceUnavailableError(); }
  async markEmailDelivery(): Promise<never> { throw new StudyProfilePersistenceUnavailableError(); }
}

let supabaseRepository: SupabaseStudyProfileRepository | null = null;
let unavailableRepository: UnavailableStudyProfileRepository | null = null;

export function getStudyProfileRepository(): StudyProfileRepository {
  if (isSupabaseAdminConfigured()) {
    supabaseRepository ??= new SupabaseStudyProfileRepository();
    return supabaseRepository;
  }
  if (canUseMemoryPersistence()) {
    globalThis.__yovaStudyProfileMemoryState ??= createMemoryState();
    return new MemoryStudyProfileRepository(globalThis.__yovaStudyProfileMemoryState);
  }
  unavailableRepository ??= new UnavailableStudyProfileRepository();
  return unavailableRepository;
}

export function generateStudyProfileReportToken() {
  return randomBytes(32).toString("base64url");
}

export function hashStudyProfileReportToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function referrerHostname(referrer?: string | null) {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.slice(0, 255) || null;
  } catch {
    return null;
  }
}

function canUseMemoryPersistence() {
  return process.env.NODE_ENV !== "production" || process.env.YOVA_E2E === "1";
}

function createMemoryState(): MemoryState {
  return {
    leadsByEmail: new Map(),
    responsesByTokenHash: new Map(),
    waitlistConfirmations: [],
    emailDeliveryAttempts: [],
    events: [],
  };
}

function publicMemoryResponse(
  response: MemoryResponse,
  lead: MemoryLead,
  reportToken = response.storedResponse.reportToken,
  waitlistState: Pick<SavedStudyProfileResponse, "waitlistJoined" | "confirmationPending"> = {
    waitlistJoined: false,
    confirmationPending: false,
  },
): SavedStudyProfileResponse {
  return {
    storedResponse: { ...response.storedResponse, reportToken },
    report: response.report,
    waitlistJoined: waitlistState.waitlistJoined,
    confirmationPending: !waitlistState.waitlistJoined && waitlistState.confirmationPending,
    betaInterest: waitlistState.waitlistJoined ? lead.betaInterest : null,
  };
}

function persistenceAttribution(attribution?: StudyProfileSubmission["attribution"]) {
  return {
    source: attribution?.source || null,
    referrerHost: referrerHostname(attribution?.referrer),
    utmSource: attribution?.utmSource || null,
    utmMedium: attribution?.utmMedium || null,
    utmCampaign: attribution?.utmCampaign || null,
    utmContent: attribution?.utmContent || null,
    utmTerm: attribution?.utmTerm || null,
  };
}

function readPersistedStudyProfileState(value: unknown): {
  report: StudyProfileReport | null;
  studyGoal: StudyProfileStudyGoal | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { report: null, studyGoal: null };
  }
  const record = value as Record<string, unknown>;
  const wrapped = record.report && typeof record.report === "object"
    ? record.report
    : record;
  const metadata = record.metadata && typeof record.metadata === "object"
    ? record.metadata as Record<string, unknown>
    : null;
  const studyGoalCandidate = metadata?.studyGoal;
  const studyGoal = typeof studyGoalCandidate === "string"
    && (STUDY_PROFILE_STUDY_GOALS as readonly string[]).includes(studyGoalCandidate)
    ? studyGoalCandidate as StudyProfileStudyGoal
    : null;

  const parsedReport = StudyProfileReportSchema.safeParse(wrapped);
  return {
    report: parsedReport.success ? parsedReport.data : null,
    studyGoal,
  };
}

function readRpcId(value: unknown, field: string) {
  if (!value || typeof value !== "object" || !(field in value)) {
    throw new Error("YOVA received an invalid Study Profile persistence response.");
  }
  const id = (value as Record<string, unknown>)[field];
  if (typeof id !== "string") {
    throw new Error("YOVA received an invalid Study Profile persistence response.");
  }
  return id;
}

function parseWaitlistConfirmationRequestReceipt(
  value: unknown,
): StudyProfileWaitlistConfirmationRequestState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("YOVA could not confirm the waitlist confirmation request.");
  }
  const receipt = value as Record<string, unknown>;
  if (receipt.state === "joined") {
    if (
      receipt.shouldSend !== false
      || receipt.confirmationId !== null
      || receipt.email !== null
      || receipt.retryAfterSeconds !== 0
    ) {
      throw new Error("YOVA could not confirm the waitlist confirmation request.");
    }
    return {
      waitlistJoined: true,
      confirmationPending: false,
      dailyCapReached: false,
      shouldSend: false,
      confirmationId: null,
      email: null,
      retryAfterSeconds: 0,
    };
  }
  if (receipt.state === "masked") {
    if (
      receipt.shouldSend !== false
      || receipt.confirmationId !== null
      || receipt.email !== null
      || !isBoundedRetry(receipt.retryAfterSeconds, 0, 900)
    ) {
      throw new Error("YOVA could not confirm the waitlist confirmation request.");
    }
    return {
      waitlistJoined: false,
      confirmationPending: true,
      dailyCapReached: false,
      shouldSend: false,
      confirmationId: null,
      email: null,
      retryAfterSeconds: receipt.retryAfterSeconds,
    };
  }
  if (receipt.state === "daily_cap") {
    if (
      receipt.shouldSend !== false
      || receipt.confirmationId !== null
      || receipt.email !== null
      || !isBoundedRetry(receipt.retryAfterSeconds, 1, 86_400)
    ) {
      throw new Error("YOVA could not confirm the waitlist confirmation request.");
    }
    return {
      waitlistJoined: false,
      confirmationPending: false,
      dailyCapReached: true,
      shouldSend: false,
      confirmationId: null,
      email: null,
      retryAfterSeconds: receipt.retryAfterSeconds,
    };
  }
  if (
    receipt.state !== "pending"
    || typeof receipt.shouldSend !== "boolean"
    || typeof receipt.confirmationId !== "string"
    || !isUuid(receipt.confirmationId)
    || typeof receipt.email !== "string"
    || !receipt.email.includes("@")
    || !isBoundedRetry(receipt.retryAfterSeconds, 0, 900)
    || (receipt.shouldSend && receipt.retryAfterSeconds !== 0)
  ) {
    throw new Error("YOVA could not confirm the waitlist confirmation request.");
  }
  return {
    waitlistJoined: false,
    confirmationPending: true,
    dailyCapReached: false,
    shouldSend: receipt.shouldSend,
    confirmationId: receipt.confirmationId,
    email: normalizeStudyProfileEmail(receipt.email),
    retryAfterSeconds: receipt.retryAfterSeconds,
  };
}

function parseWaitlistConfirmationResult(
  value: unknown,
): StudyProfileWaitlistConfirmationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("YOVA could not confirm the waitlist confirmation result.");
  }
  const receipt = value as Record<string, unknown>;
  if (receipt.status === "confirmed") {
    if (receipt.waitlistJoined !== true || typeof receipt.newlyJoined !== "boolean") {
      throw new Error("YOVA could not confirm the waitlist confirmation result.");
    }
    return {
      status: "confirmed",
      waitlistJoined: true,
      newlyJoined: receipt.newlyJoined,
    };
  }
  if (
    (receipt.status === "invalid" || receipt.status === "expired")
    && receipt.waitlistJoined === false
  ) {
    return {
      status: receipt.status,
      waitlistJoined: false,
      newlyJoined: false,
    };
  }
  throw new Error("YOVA could not confirm the waitlist confirmation result.");
}

function parseReportEmailReservation(value: unknown): StudyProfileReportEmailReservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("YOVA could not confirm the report email reservation.");
  }
  const receipt = value as Record<string, unknown>;
  if (
    typeof receipt.allowed !== "boolean"
    || (receipt.reason !== null && receipt.reason !== "cooldown" && receipt.reason !== "daily_cap")
    || typeof receipt.retryAfterSeconds !== "number"
    || !Number.isInteger(receipt.retryAfterSeconds)
    || receipt.retryAfterSeconds < 0
    || receipt.retryAfterSeconds > 86_400
    || (receipt.allowed && (receipt.retryAfterSeconds !== 0 || receipt.reason !== null))
    || (!receipt.allowed && (receipt.retryAfterSeconds < 1 || receipt.reason === null))
  ) {
    throw new Error("YOVA could not confirm the report email reservation.");
  }
  return {
    allowed: receipt.allowed,
    reason: receipt.reason,
    retryAfterSeconds: receipt.retryAfterSeconds,
  };
}

function isBoundedRetry(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function savedStudyProfileResponse(
  input: PersistStudyProfileResponseInput,
  reportToken: string,
  responseId: unknown,
  createdAt: unknown,
): SavedStudyProfileResponse {
  const storedResponse = StudyProfileStoredResponseSchema.parse({
    id: responseId,
    reportToken,
    profileModelVersion: STUDY_PROFILE_MODEL_VERSION,
    rawAnswers: input.answers,
    snapshot: input.snapshot,
    metadata: input.metadata,
    createdAt,
  });
  return {
    storedResponse,
    report: input.report,
    waitlistJoined: false,
    confirmationPending: false,
    betaInterest: null,
  };
}

async function recoverSavedStudyProfileResponse(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  input: PersistStudyProfileResponseInput,
  reportToken: string,
  reportTokenHash: string,
): Promise<
  | { status: "saved"; value: SavedStudyProfileResponse }
  | { status: "not_found" }
  | { status: "unknown" }
> {
  try {
    const { data: persisted, error } = await supabase
      .from("study_profile_responses")
      .select("id,lead_id,created_at")
      .eq("report_token_hash", reportTokenHash)
      .maybeSingle();
    if (error) return { status: "unknown" };
    if (!persisted) return { status: "not_found" };
    return {
      status: "saved",
      value: savedStudyProfileResponse(
        input,
        reportToken,
        persisted.id,
        persisted.created_at,
      ),
    };
  } catch {
    return { status: "unknown" };
  }
}

async function readReportWaitlistConfirmationState(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  responseId: unknown,
): Promise<Pick<SavedStudyProfileResponse, "waitlistJoined" | "confirmationPending">> {
  const empty = { waitlistJoined: false, confirmationPending: false };
  if (typeof responseId !== "string") return empty;
  try {
    const { data: confirmed, error: confirmedError } = await supabase
      .from("study_profile_waitlist_confirmations")
      .select("id")
      .eq("response_id", responseId)
      .eq("status", "confirmed")
      .limit(1)
      .maybeSingle();
    if (confirmedError) return empty;
    if (confirmed) return { waitlistJoined: true, confirmationPending: false };

    const { data: pending, error: pendingError } = await supabase
      .from("study_profile_waitlist_confirmations")
      .select("id")
      .eq("response_id", responseId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .maybeSingle();
    return pendingError
      ? empty
      : { waitlistJoined: false, confirmationPending: Boolean(pending) };
  } catch {
    return empty;
  }
}
