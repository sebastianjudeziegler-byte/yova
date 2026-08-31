import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createAdmin: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  gt: vi.fn(),
  limit: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createAdmin,
  isSupabaseAdminConfigured: () => true,
}));

import {
  STUDY_PROFILE_LEGACY_SCORING_REVISION,
  STUDY_PROFILE_SCORING_REVISION,
  buildStudyProfileReport,
  scoreStudyProfile,
} from "@/lib/study-profile";
import {
  StudyProfileCommittedWriteError,
  StudyProfileSaveOutcomeUnknownError,
  SupabaseStudyProfileRepository,
  hashStudyProfileReportToken,
} from "@/lib/study-profile/repository";
import type { StudyProfileAnswers, StudyProfileMetadata } from "@/lib/study-profile";

const RESPONSE_ID = "11111111-1111-4111-8111-111111111111";
const LEAD_ID = "22222222-2222-4222-8222-222222222222";
const answers = Object.fromEntries(
  Array.from({ length: 12 }, (_, index) => [`q${index + 1}`, "a"]),
) as StudyProfileAnswers;
const metadata: StudyProfileMetadata = {
  energyWindow: "morning",
  schoolLevel: "college",
  hardestPart: null,
};

describe("Supabase Study Profile save receipts", () => {
  beforeEach(() => {
    mocks.rpc.mockReset().mockResolvedValue({ data: { renamedResponseId: RESPONSE_ID }, error: null });
    mocks.maybeSingle.mockReset().mockResolvedValue({
      data: { id: RESPONSE_ID, created_at: "2026-08-19T12:34:56.123+00:00" },
      error: null,
    });
    const query = {
      select: mocks.select,
      eq: mocks.eq,
      gt: mocks.gt,
      limit: mocks.limit,
      maybeSingle: mocks.maybeSingle,
    };
    mocks.select.mockReset().mockReturnValue(query);
    mocks.eq.mockReset().mockReturnValue(query);
    mocks.gt.mockReset().mockReturnValue(query);
    mocks.limit.mockReset().mockReturnValue(query);
    mocks.from.mockReset().mockReturnValue(query);
    mocks.createAdmin.mockReset().mockReturnValue({ rpc: mocks.rpc, from: mocks.from });
  });

  it("recovers the committed response by its private token hash when the RPC receipt drifts", async () => {
    const saved = await new SupabaseStudyProfileRepository().saveResponse(input());

    expect(saved.storedResponse.id).toBe(RESPONSE_ID);
    expect(saved.storedResponse.createdAt).toBe("2026-08-19T12:34:56.123+00:00");
    expect(mocks.from).toHaveBeenCalledWith("study_profile_responses");
    expect(mocks.eq).toHaveBeenCalledWith(
      "report_token_hash",
      hashStudyProfileReportToken(saved.storedResponse.reportToken),
    );
  });

  it("distinguishes an unrecoverable committed write from a save failure", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "lookup unavailable" } });

    await expect(new SupabaseStudyProfileRepository().saveResponse(input()))
      .rejects.toBeInstanceOf(StudyProfileCommittedWriteError);
  });

  it("recovers a committed row when the RPC itself reports a lost response", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "response lost" } });

    await expect(new SupabaseStudyProfileRepository().saveResponse(input()))
      .resolves.toMatchObject({ storedResponse: { id: RESPONSE_ID } });
  });

  it("reports an unknown outcome instead of claiming not saved when both calls fail", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "response lost" } });
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "lookup unavailable" } });

    await expect(new SupabaseStudyProfileRepository().saveResponse(input()))
      .rejects.toBeInstanceOf(StudyProfileSaveOutcomeUnknownError);
  });
});

describe("Supabase Study Profile report reloads", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.maybeSingle.mockReset();
    const query = {
      select: mocks.select,
      eq: mocks.eq,
      gt: mocks.gt,
      limit: mocks.limit,
      maybeSingle: mocks.maybeSingle,
    };
    mocks.select.mockReset().mockReturnValue(query);
    mocks.eq.mockReset().mockReturnValue(query);
    mocks.gt.mockReset().mockReturnValue(query);
    mocks.limit.mockReset().mockReturnValue(query);
    mocks.from.mockReset().mockReturnValue(query);
    mocks.createAdmin.mockReset().mockReturnValue({ rpc: mocks.rpc, from: mocks.from });
  });

  it("loads a strict current report from the wrapped report_state and restores its study goal", async () => {
    const snapshot = scoreStudyProfile(answers);
    const report = {
      ...buildStudyProfileReport(snapshot, {
        ...metadata,
        studyGoal: "upcoming_exams",
      }, answers),
      freeInsight: {
        heading: "Persisted current report",
        body: "This exact valid report came from report_state.",
      },
    };
    mockReportLookup({
      profile_snapshot: snapshot,
      report_state: {
        report,
        metadata: { studyGoal: "upcoming_exams" },
      },
    });

    const loaded = await new SupabaseStudyProfileRepository()
      .getReportByToken("current-report-token-that-is-long-enough");

    expect(loaded).not.toBeNull();
    expect(loaded?.report.freeInsight).toEqual(report.freeInsight);
    expect(loaded?.report.scoringRevision).toBe(STUDY_PROFILE_SCORING_REVISION);
    expect(loaded?.storedResponse.metadata.studyGoal).toBe("upcoming_exams");
    expect(loaded?.waitlistJoined).toBe(true);
    expect(loaded?.confirmationPending).toBe(false);
  });

  it("restores a nonexpired pending confirmation on a direct report load", async () => {
    mockReportLookup({}, "pending");

    const loaded = await new SupabaseStudyProfileRepository()
      .getReportByToken("pending-report-token-that-is-long-enough");

    expect(loaded).toMatchObject({
      waitlistJoined: false,
      confirmationPending: true,
    });
    expect(mocks.from).toHaveBeenCalledWith("study_profile_waitlist_confirmations");
    expect(mocks.eq).toHaveBeenCalledWith("response_id", RESPONSE_ID);
    expect(mocks.eq).toHaveBeenCalledWith("status", "pending");
    expect(mocks.gt).toHaveBeenCalledWith("expires_at", expect.any(String));
    expect(mocks.limit).toHaveBeenCalledWith(1);
  });

  it("rejects a malformed persisted report and rebuilds it from the validated current snapshot", async () => {
    const snapshot = scoreStudyProfile(answers);
    const report = buildStudyProfileReport(snapshot, {
      ...metadata,
      studyGoal: "better_habits",
    }, answers);
    mockReportLookup({
      profile_snapshot: snapshot,
      report_state: {
        report: {
          ...report,
          overview: report.overview.slice(0, 5),
        },
        metadata: { studyGoal: "better_habits" },
      },
    });

    const loaded = await new SupabaseStudyProfileRepository()
      .getReportByToken("malformed-report-token-that-is-long-enough");

    expect(loaded?.report.overview).toHaveLength(6);
    expect(loaded?.report).toEqual(buildStudyProfileReport(
      snapshot,
      { ...metadata, studyGoal: "better_habits" },
      answers,
    ));
  });

  it("preserves a legacy snapshot and never quotes current question copy for legacy answer IDs", async () => {
    const legacyAnswers = { ...answers, q6: "d" } as StudyProfileAnswers;
    const legacySnapshot = JSON.parse(JSON.stringify(
      scoreStudyProfile(legacyAnswers),
    )) as Record<string, unknown>;
    delete legacySnapshot.scoringRevision;
    delete legacySnapshot.lowSignal;
    for (const score of Object.values(
      legacySnapshot.scores as Record<string, Record<string, unknown>>,
    )) {
      delete score.meanSeverity;
    }
    mockReportLookup({
      raw_answers: legacyAnswers,
      profile_snapshot: legacySnapshot,
      report_state: { contentVersion: "study_profile_report_v2" },
    });

    const loaded = await new SupabaseStudyProfileRepository()
      .getReportByToken("legacy-report-token-that-is-long-enough");

    expect(loaded?.storedResponse.snapshot.scoringRevision).toBeUndefined();
    expect(loaded?.report.scoringRevision).toBe(STUDY_PROFILE_LEGACY_SCORING_REVISION);
    expect(loaded?.report.freeInsight.body).not.toContain("You chose");
    expect(loaded?.report.whyThisIsHappening.body).not.toContain("You chose");
    expect(JSON.stringify(loaded?.report)).not.toContain(
      "I drift into unrelated tabs or my phone and struggle to return",
    );
  });
});

describe("Supabase Study Profile public-delivery RPC contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAdmin.mockReturnValue({ rpc: mocks.rpc, from: mocks.from });
  });

  it("requests a pending landing confirmation without passing a raw token", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        state: "pending",
        shouldSend: true,
        confirmationId: "33333333-3333-4333-8333-333333333333",
        email: "student@example.com",
        retryAfterSeconds: 0,
      },
      error: null,
    });
    const confirmationTokenHash = "c".repeat(64);

    await expect(new SupabaseStudyProfileRepository()
      .requestWaitlistConfirmationByEmail({
        email: " Student@Example.com ",
        visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
        confirmationTokenHash,
        attribution: { source: "direct" },
      })).resolves.toEqual({
        waitlistJoined: false,
        confirmationPending: true,
        dailyCapReached: false,
        shouldSend: true,
        confirmationId: "33333333-3333-4333-8333-333333333333",
        email: "student@example.com",
        retryAfterSeconds: 0,
      });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "request_study_profile_waitlist_confirmation",
      {
        payload: expect.objectContaining({
          email: "student@example.com",
          confirmationTokenHash,
          ageConfirmed: true,
        }),
      },
    );
    expect(JSON.stringify(mocks.rpc.mock.calls[0]))
      .not.toContain("raw_confirmation_token_never_sent_to_database");
  });

  it("passes the explicit 13+ evidence into a report confirmation RPC", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        state: "pending",
        shouldSend: true,
        confirmationId: "33333333-3333-4333-8333-333333333333",
        email: "student@example.com",
        retryAfterSeconds: 0,
      },
      error: null,
    });

    await new SupabaseStudyProfileRepository().requestWaitlistConfirmation(
      "report-token-that-is-long-enough-for-the-schema",
      "report_cta",
      "f".repeat(64),
    );

    expect(mocks.rpc).toHaveBeenCalledWith(
      "request_study_profile_report_waitlist_confirmation",
      {
        payload: expect.objectContaining({
          ageConfirmed: true,
          consentSource: "report_cta",
        }),
      },
    );
  });

  it("parses a one-time confirmation result and a report-email cooldown", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: { status: "confirmed", waitlistJoined: true, newlyJoined: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { allowed: false, reason: "cooldown", retryAfterSeconds: 731 },
        error: null,
      });
    const repository = new SupabaseStudyProfileRepository();

    await expect(repository.confirmWaitlist("d".repeat(64))).resolves.toEqual({
      status: "confirmed",
      waitlistJoined: true,
      newlyJoined: true,
    });
    await expect(repository.reserveReportEmailDelivery(RESPONSE_ID)).resolves.toEqual({
      allowed: false,
      reason: "cooldown",
      retryAfterSeconds: 731,
    });
    expect(mocks.rpc.mock.calls).toEqual([
      ["confirm_study_profile_waitlist", {
        payload: { confirmationTokenHash: "d".repeat(64) },
      }],
      ["reserve_study_profile_report_email_delivery", {
        payload: { responseId: RESPONSE_ID },
      }],
    ]);
  });

  it("fails closed on a malformed confirmation receipt", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { state: "pending", shouldSend: true, email: "student@example.com" },
      error: null,
    });

    await expect(new SupabaseStudyProfileRepository()
      .requestWaitlistConfirmationByEmail({
        email: "student@example.com",
        visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
        confirmationTokenHash: "e".repeat(64),
      })).rejects.toThrow("confirmation request");
  });
});

function input() {
  const snapshot = scoreStudyProfile(answers);
  return {
    email: "student@example.com",
    visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
    answers,
    snapshot,
    metadata,
    report: buildStudyProfileReport(snapshot, metadata, answers),
    marketingConsent: false,
  };
}

function mockReportLookup(
  overrides: Record<string, unknown>,
  waitlistState: "confirmed" | "pending" | "none" = "confirmed",
) {
  mocks.maybeSingle
    .mockResolvedValueOnce({
      data: {
        id: RESPONSE_ID,
        lead_id: LEAD_ID,
        profile_model_version: "profile_model_v1",
        raw_answers: answers,
        profile_snapshot: scoreStudyProfile(answers),
        report_state: {},
        energy_window: metadata.energyWindow,
        school_level: metadata.schoolLevel,
        optional_free_response: null,
        created_at: "2026-08-19T12:34:56.123+00:00",
        ...overrides,
      },
      error: null,
    })
    .mockResolvedValueOnce({
      data: waitlistState === "confirmed"
        ? { id: "33333333-3333-4333-8333-333333333333" }
        : null,
      error: null,
    });
  if (waitlistState !== "confirmed") {
    mocks.maybeSingle.mockResolvedValueOnce({
      data: waitlistState === "pending"
        ? { id: "44444444-4444-4444-8444-444444444444" }
        : null,
      error: null,
    });
  }
}
