import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  STUDY_PROFILE_SCORING_REVISION,
  buildStudyProfileReport,
  scoreStudyProfile,
} from "@/lib/study-profile";
import {
  MemoryStudyProfileRepository,
  STUDY_PROFILE_WAITLIST_CONSENT_COPY_VERSIONS,
  generateStudyProfileReportToken,
  hashStudyProfileReportToken,
} from "@/lib/study-profile/repository";
import type { StudyProfileAnswers, StudyProfileMetadata } from "@/lib/study-profile";

const answers = Object.fromEntries(
  Array.from({ length: 12 }, (_, index) => [`q${index + 1}`, "a"]),
) as StudyProfileAnswers;

const metadata: StudyProfileMetadata = {
  energyWindow: "morning",
  schoolLevel: "college",
  hardestPart: null,
};

describe("Study Profile repository", () => {
  let repository: MemoryStudyProfileRepository;
  let tokenIndex: number;
  let uuidIndex: number;

  beforeEach(() => {
    tokenIndex = 0;
    uuidIndex = 0;
    repository = new MemoryStudyProfileRepository(undefined, {
      now: () => new Date("2026-08-11T12:00:00.000Z"),
      token: () => `token_${String(++tokenIndex).padStart(36, "x")}`,
      uuid: () => `00000000-0000-4000-8000-${String(++uuidIndex).padStart(12, "0")}`,
    });
  });

  it("normalizes one lead while preserving separate retakes and old reports", async () => {
    const first = await repository.saveResponse(input(" Student@Example.com ", false));
    const second = await repository.saveResponse(input("student@example.com", true));

    expect(repository.inspect().leadsByEmail).toHaveLength(1);
    expect(repository.inspect().responsesByTokenHash).toHaveLength(2);
    expect(first.storedResponse.id).not.toBe(second.storedResponse.id);
    expect(first.storedResponse.reportToken).not.toBe(second.storedResponse.reportToken);
    expect(await repository.getReportByToken(first.storedResponse.reportToken))
      .toMatchObject({ storedResponse: { id: first.storedResponse.id } });
  });

  it("returns null for an invalid or unknown report token", async () => {
    expect(await repository.getReportByToken("unknown_token_that_is_long_enough_12345")).toBeNull();
  });

  it("joins the waitlist idempotently without replacing the first consent record", async () => {
    const saved = await repository.saveResponse(input("student@example.com", false));
    const token = saved.storedResponse.reportToken;

    await expect(repository.joinWaitlist(token)).resolves.toEqual({
      waitlistJoined: true,
      betaInterest: null,
      newlyJoined: true,
    });
    await expect(repository.joinWaitlist(token)).resolves.toEqual({
      waitlistJoined: true,
      betaInterest: null,
      newlyJoined: false,
    });
    const lead = [...repository.inspect().leadsByEmail.values()][0];
    expect(lead.waitlistJoinedAt).toBe("2026-08-11T12:00:00.000Z");
    expect(lead.waitlistConsentCopyVersion).toBe(
      STUDY_PROFILE_WAITLIST_CONSENT_COPY_VERSIONS.report_cta,
    );
    expect(lead.waitlistConsentSource).toBe("report_cta");
  });

  it("creates a normalized waitlist-only lead with explicit consent evidence", async () => {
    await expect(repository.joinWaitlistByEmail({
      email: "  New.Student@Example.COM ",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      attribution: {
        source: "instagram",
        referrer: "https://www.instagram.com/",
        utmCampaign: "study-profile-launch",
      },
    })).resolves.toEqual({
      waitlistJoined: true,
      betaInterest: null,
    });

    const state = repository.inspect();
    expect(state.leadsByEmail).toHaveLength(1);
    expect(state.responsesByTokenHash).toHaveLength(0);
    expect([...state.leadsByEmail.entries()]).toEqual([[
      "new.student@example.com",
      expect.objectContaining({
        email: "new.student@example.com",
        marketingConsent: false,
        waitlistJoined: true,
        waitlistJoinedAt: "2026-08-11T12:00:00.000Z",
        waitlistConsentCopyVersion: STUDY_PROFILE_WAITLIST_CONSENT_COPY_VERSIONS.landing,
        waitlistConsentSource: "landing",
      }),
    ]]);

    const event = state.events.find(({ eventName }) => (
      eventName === "study_profile_waitlist_joined"
    ));
    expect(event).toEqual({
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      eventName: "study_profile_waitlist_joined",
      eventData: {
        source: "landing",
        scoringRevision: STUDY_PROFILE_SCORING_REVISION,
      },
      attribution: {
        source: "instagram",
        referrer: "https://www.instagram.com/",
        utmCampaign: "study-profile-launch",
      },
    });
    expect(JSON.stringify(event)).not.toContain("new.student@example.com");
    expect(JSON.stringify(event)).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });

  it("joins an existing report lead without creating a duplicate lead or response", async () => {
    const saved = await repository.saveResponse(input("student@example.com", false));

    await expect(repository.joinWaitlistByEmail({
      email: " STUDENT@EXAMPLE.COM ",
      visitorId: "8c81ab87-262d-4dab-bd92-318aca7ac09c",
      attribution: { source: "direct" },
    })).resolves.toMatchObject({ waitlistJoined: true });

    const state = repository.inspect();
    expect(state.leadsByEmail).toHaveLength(1);
    expect(state.responsesByTokenHash).toHaveLength(1);
    expect(await repository.getReportByToken(saved.storedResponse.reportToken))
      .toMatchObject({ waitlistJoined: true });
    expect([...state.leadsByEmail.values()][0]).toMatchObject({
      waitlistJoined: true,
      waitlistJoinedAt: "2026-08-11T12:00:00.000Z",
      waitlistConsentCopyVersion: STUDY_PROFILE_WAITLIST_CONSENT_COPY_VERSIONS.landing,
      waitlistConsentSource: "landing",
    });
  });

  it("preserves the first landing consent evidence and records one conversion event", async () => {
    let now = new Date("2026-08-11T12:00:00.000Z");
    const idempotentRepository = new MemoryStudyProfileRepository(undefined, {
      now: () => now,
      uuid: () => "00000000-0000-4000-8000-000000000001",
    });
    const request = {
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      attribution: { source: "tiktok" },
    } as const;

    await idempotentRepository.joinWaitlistByEmail(request);
    now = new Date("2026-08-12T15:30:00.000Z");
    await idempotentRepository.joinWaitlistByEmail({
      ...request,
      visitorId: "8c81ab87-262d-4dab-bd92-318aca7ac09c",
      attribution: { source: "instagram" },
    });

    const state = idempotentRepository.inspect();
    expect([...state.leadsByEmail.values()][0]).toMatchObject({
      waitlistJoinedAt: "2026-08-11T12:00:00.000Z",
      waitlistConsentCopyVersion: STUDY_PROFILE_WAITLIST_CONSENT_COPY_VERSIONS.landing,
      waitlistConsentSource: "landing",
    });
    expect(state.events.filter(({ eventName }) => (
      eventName === "study_profile_waitlist_joined"
    ))).toEqual([expect.objectContaining({
      visitorId: request.visitorId,
      eventData: {
        source: "landing",
        scoringRevision: STUDY_PROFILE_SCORING_REVISION,
      },
      attribution: { source: "tiktok" },
    })]);
  });

  it("generates opaque 256-bit tokens and stores stable SHA-256 hashes", () => {
    const token = generateStudyProfileReportToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashStudyProfileReportToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashStudyProfileReportToken(token)).toBe(hashStudyProfileReportToken(token));
  });
});

function input(email: string, marketingConsent: boolean) {
  const snapshot = scoreStudyProfile(answers);
  return {
    email,
    visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
    answers,
    snapshot,
    metadata,
    report: buildStudyProfileReport(snapshot, metadata),
    marketingConsent,
  };
}
