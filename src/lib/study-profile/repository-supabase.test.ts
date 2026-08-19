import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createAdmin: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createAdmin,
  isSupabaseAdminConfigured: () => true,
}));

import { buildStudyProfileReport, scoreStudyProfile } from "@/lib/study-profile";
import {
  StudyProfileCommittedWriteError,
  StudyProfileSaveOutcomeUnknownError,
  SupabaseStudyProfileRepository,
  hashStudyProfileReportToken,
} from "@/lib/study-profile/repository";
import type { StudyProfileAnswers, StudyProfileMetadata } from "@/lib/study-profile";

const RESPONSE_ID = "11111111-1111-4111-8111-111111111111";
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
      maybeSingle: mocks.maybeSingle,
    };
    mocks.select.mockReset().mockReturnValue(query);
    mocks.eq.mockReset().mockReturnValue(query);
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
