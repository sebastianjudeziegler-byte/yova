import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import {
  STUDY_PROFILE_MODEL_VERSION,
  StudyProfileStoredResponseSchema,
  buildStudyProfileReportFromStoredResponse,
  normalizeStudyProfileEmail,
  type StudyProfileAnswers,
  type StudyProfileMetadata,
  type StudyProfileReport,
  type StudyProfileSnapshot,
  type StudyProfileStoredResponse,
  type StudyProfileSubmission,
} from "@/lib/study-profile";

export const STUDY_PROFILE_CONSENT_COPY_VERSION = "study-profile-updates-v1";
export const STUDY_PROFILE_WAITLIST_CONSENT_COPY_VERSION = "study-profile-waitlist-v2";

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
    | "study_profile_beta_interest";
  eventData: Record<string, string | number | boolean | null>;
  attribution?: StudyProfileSubmission["attribution"];
};

export type StudyProfileInterestState = {
  waitlistJoined: boolean;
  betaInterest: boolean | null;
};

export interface StudyProfileRepository {
  saveResponse(input: PersistStudyProfileResponseInput): Promise<SavedStudyProfileResponse>;
  getReportByToken(reportToken: string): Promise<SavedStudyProfileResponse | null>;
  joinWaitlist(reportToken: string): Promise<StudyProfileInterestState | null>;
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
  betaInterest: boolean | null;
};

type MemoryResponse = SavedStudyProfileResponse & {
  leadId: string;
  tokenHash: string;
  emailDeliveryStatus: StudyProfileEmailDeliveryStatus;
};

type MemoryState = {
  leadsByEmail: Map<string, MemoryLead>;
  responsesByTokenHash: Map<string, MemoryResponse>;
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
        betaInterest: null,
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
      betaInterest: lead.betaInterest,
    };
    this.state.responsesByTokenHash.set(saved.tokenHash, saved);
    this.state.events.push({
      visitorId: input.visitorId,
      responseId: storedResponse.id,
      eventName: "study_profile_email_submitted",
      eventData: {},
      attribution: input.attribution,
    });
    return publicMemoryResponse(saved, lead);
  }

  async getReportByToken(reportToken: string) {
    const response = this.state.responsesByTokenHash.get(hashStudyProfileReportToken(reportToken));
    if (!response) return null;
    const lead = [...this.state.leadsByEmail.values()].find(({ id }) => id === response.leadId);
    if (!lead) return null;
    return publicMemoryResponse(response, lead, reportToken);
  }

  async joinWaitlist(reportToken: string) {
    const resolved = this.resolveLead(reportToken);
    if (!resolved) return null;
    if (!resolved.lead.waitlistJoined) {
      resolved.lead.waitlistJoined = true;
      resolved.lead.waitlistJoinedAt = this.clock.now().toISOString();
      resolved.lead.waitlistConsentCopyVersion = STUDY_PROFILE_WAITLIST_CONSENT_COPY_VERSION;
    }
    return {
      waitlistJoined: true,
      betaInterest: resolved.lead.betaInterest,
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
    this.state.events.push(structuredClone(event));
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
          reportState: input.report,
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
      return savedStudyProfileResponse(input, reportToken, readRpcId(data, "responseId"), createdAt);
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
      .select("id, lead_id, profile_model_version, raw_answers, profile_snapshot, energy_window, school_level, optional_free_response, created_at")
      .eq("report_token_hash", hashStudyProfileReportToken(reportToken))
      .maybeSingle();
    if (error) throw new Error("YOVA could not load this Study Profile report.", { cause: error });
    if (!row) return null;

    const { data: lead, error: leadError } = await supabase
      .from("study_profile_leads")
      .select("waitlist_status, beta_interest")
      .eq("id", row.lead_id)
      .maybeSingle();
    if (leadError) throw new Error("YOVA could not load this Study Profile report.", { cause: leadError });
    if (!lead) return null;

    const storedResponse = StudyProfileStoredResponseSchema.parse({
      id: row.id,
      reportToken,
      profileModelVersion: row.profile_model_version,
      rawAnswers: row.raw_answers,
      snapshot: row.profile_snapshot,
      metadata: {
        energyWindow: row.energy_window,
        schoolLevel: row.school_level,
        hardestPart: row.optional_free_response,
      },
      createdAt: row.created_at,
    });
    return {
      storedResponse,
      report: buildStudyProfileReportFromStoredResponse(storedResponse),
      waitlistJoined: lead.waitlist_status === "joined",
      betaInterest: typeof lead.beta_interest === "boolean" ? lead.beta_interest : null,
    };
  }

  async joinWaitlist(reportToken: string) {
    const resolved = await this.findLeadByToken(reportToken);
    if (!resolved) return null;
    const supabase = createSupabaseAdminClient();
    const { data: current, error: currentError } = await supabase
      .from("study_profile_leads")
      .select("waitlist_status, beta_interest")
      .eq("id", resolved.leadId)
      .maybeSingle();
    if (currentError) throw new Error("YOVA could not update waitlist signup.", { cause: currentError });
    if (!current) return null;
    if (current.waitlist_status === "joined") {
      return {
        waitlistJoined: true,
        betaInterest: typeof current.beta_interest === "boolean" ? current.beta_interest : null,
      };
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("study_profile_leads")
      .update({
        waitlist_status: "joined",
        waitlist_joined_at: now,
        waitlist_consent_copy_version: STUDY_PROFILE_WAITLIST_CONSENT_COPY_VERSION,
      })
      .eq("id", resolved.leadId)
      .eq("waitlist_status", "not_joined")
      .select("waitlist_status, beta_interest")
      .maybeSingle();
    if (error) throw new Error("YOVA could not update waitlist signup.", { cause: error });
    if (!data) {
      const { data: joined, error: joinedError } = await supabase
        .from("study_profile_leads")
        .select("waitlist_status, beta_interest")
        .eq("id", resolved.leadId)
        .maybeSingle();
      if (joinedError) throw new Error("YOVA could not update waitlist signup.", { cause: joinedError });
      if (!joined) return null;
      return {
        waitlistJoined: joined.waitlist_status === "joined",
        betaInterest: typeof joined.beta_interest === "boolean" ? joined.beta_interest : null,
      };
    }
    return {
      waitlistJoined: data.waitlist_status === "joined",
      betaInterest: typeof data.beta_interest === "boolean" ? data.beta_interest : null,
    };
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
      event_data: event.eventData,
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
  async joinWaitlist(): Promise<never> { throw new StudyProfilePersistenceUnavailableError(); }
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
    events: [],
  };
}

function publicMemoryResponse(
  response: MemoryResponse,
  lead: MemoryLead,
  reportToken = response.storedResponse.reportToken,
): SavedStudyProfileResponse {
  return {
    storedResponse: { ...response.storedResponse, reportToken },
    report: buildStudyProfileReportFromStoredResponse(response.storedResponse),
    waitlistJoined: lead.waitlistJoined,
    betaInterest: lead.betaInterest,
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
      .select("id,created_at")
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
