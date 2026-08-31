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

  it("requires a delivered one-time confirmation before joining the waitlist", async () => {
    const saved = await repository.saveResponse(input("student@example.com", false));
    const token = saved.storedResponse.reportToken;
    const confirmationHash = hashStudyProfileReportToken(
      "confirmation_token_that_is_long_enough_0001",
    );

    const requested = await repository.requestWaitlistConfirmation(
      token,
      "report_cta",
      confirmationHash,
    );
    expect(requested).toMatchObject({
      waitlistJoined: false,
      confirmationPending: true,
      shouldSend: true,
    });
    expect(await repository.getReportByToken(token)).toMatchObject({
      waitlistJoined: false,
      confirmationPending: true,
    });
    await repository.markWaitlistConfirmationDelivery(
      requested?.confirmationId ?? "",
      "sent",
    );
    await expect(repository.confirmWaitlist(confirmationHash)).resolves.toEqual({
      status: "confirmed",
      waitlistJoined: true,
      newlyJoined: true,
    });
    await expect(repository.confirmWaitlist(confirmationHash)).resolves.toEqual({
      status: "confirmed",
      waitlistJoined: true,
      newlyJoined: false,
    });
    expect(await repository.getReportByToken(token)).toMatchObject({
      waitlistJoined: true,
      confirmationPending: false,
    });
    const lead = [...repository.inspect().leadsByEmail.values()][0];
    expect(lead.waitlistJoinedAt).toBe("2026-08-11T12:00:00.000Z");
    expect(lead.waitlistConsentCopyVersion).toBe(
      STUDY_PROFILE_WAITLIST_CONSENT_COPY_VERSIONS.report_cta,
    );
    expect(lead.waitlistConsentSource).toBe("report_cta");
  });

  it("creates a normalized pending lead and preserves consent only after confirmation", async () => {
    const confirmationHash = hashStudyProfileReportToken(
      "confirmation_token_that_is_long_enough_0002",
    );
    const requested = await repository.requestWaitlistConfirmationByEmail({
      email: "  New.Student@Example.COM ",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      confirmationTokenHash: confirmationHash,
      attribution: {
        source: "instagram",
        referrer: "https://www.instagram.com/",
        utmCampaign: "study-profile-launch",
      },
    });
    expect(requested).toMatchObject({
      waitlistJoined: false,
      confirmationPending: true,
      shouldSend: true,
    });

    const state = repository.inspect();
    expect(state.leadsByEmail).toHaveLength(1);
    expect(state.responsesByTokenHash).toHaveLength(0);
    expect([...state.leadsByEmail.entries()]).toEqual([[
      "new.student@example.com",
      expect.objectContaining({
        email: "new.student@example.com",
        marketingConsent: false,
        waitlistJoined: false,
        waitlistJoinedAt: null,
        waitlistConsentCopyVersion: null,
        waitlistConsentSource: null,
      }),
    ]]);

    await repository.markWaitlistConfirmationDelivery(
      requested.confirmationId ?? "",
      "sent",
    );
    await expect(repository.confirmWaitlist(confirmationHash)).resolves.toMatchObject({
      status: "confirmed",
      waitlistJoined: true,
    });

    const event = state.events.find(({ eventName }) => (
      eventName === "study_profile_waitlist_joined"
    ));
    expect(event).toEqual({
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      eventName: "study_profile_waitlist_joined",
      eventData: {
        source: "landing",
        scoringRevision: STUDY_PROFILE_SCORING_REVISION,
        doubleOptIn: true,
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

  it("does not expose a landing confirmation through an unrelated report token", async () => {
    const saved = await repository.saveResponse(input("student@example.com", false));
    const confirmationHash = hashStudyProfileReportToken(
      "confirmation_token_that_is_long_enough_0003",
    );

    const requested = await repository.requestWaitlistConfirmationByEmail({
      email: " STUDENT@EXAMPLE.COM ",
      visitorId: "8c81ab87-262d-4dab-bd92-318aca7ac09c",
      confirmationTokenHash: confirmationHash,
      attribution: { source: "direct" },
    });
    await repository.markWaitlistConfirmationDelivery(
      requested.confirmationId ?? "",
      "sent",
    );
    await repository.confirmWaitlist(confirmationHash);

    const state = repository.inspect();
    expect(state.leadsByEmail).toHaveLength(1);
    expect(state.responsesByTokenHash).toHaveLength(1);
    expect(await repository.getReportByToken(saved.storedResponse.reportToken))
      .toMatchObject({ waitlistJoined: false, confirmationPending: false });
    expect([...state.leadsByEmail.values()][0]).toMatchObject({
      waitlistJoined: true,
      waitlistJoinedAt: "2026-08-11T12:00:00.000Z",
      waitlistConsentCopyVersion: STUDY_PROFILE_WAITLIST_CONSENT_COPY_VERSIONS.landing,
      waitlistConsentSource: "landing",
    });
  });

  it("preserves the confirmed consent evidence and records one conversion event", async () => {
    let now = new Date("2026-08-11T12:00:00.000Z");
    const idempotentRepository = new MemoryStudyProfileRepository(undefined, {
      now: () => now,
      uuid: () => "00000000-0000-4000-8000-000000000001",
    });
    const request = {
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      confirmationTokenHash: hashStudyProfileReportToken(
        "confirmation_token_that_is_long_enough_0004",
      ),
      attribution: { source: "tiktok" },
    } as const;

    const requested = await idempotentRepository.requestWaitlistConfirmationByEmail(request);
    await idempotentRepository.markWaitlistConfirmationDelivery(
      requested.confirmationId ?? "",
      "sent",
    );
    await idempotentRepository.confirmWaitlist(request.confirmationTokenHash);
    now = new Date("2026-08-12T15:30:00.000Z");
    await idempotentRepository.requestWaitlistConfirmationByEmail({
      ...request,
      visitorId: "8c81ab87-262d-4dab-bd92-318aca7ac09c",
      confirmationTokenHash: hashStudyProfileReportToken(
        "confirmation_token_that_is_long_enough_0005",
      ),
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
        doubleOptIn: true,
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

  it("atomically allows one report email per normalized address per 15 minutes", async () => {
    const first = await repository.saveResponse(input(" Student@Example.com ", false));
    const second = await repository.saveResponse(input("student@example.com", false));

    const [firstReservation, secondReservation] = await Promise.all([
      repository.reserveReportEmailDelivery(first.storedResponse.id),
      repository.reserveReportEmailDelivery(second.storedResponse.id),
    ]);

    expect([firstReservation.allowed, secondReservation.allowed].sort())
      .toEqual([false, true]);
    expect(firstReservation.allowed ? firstReservation : secondReservation)
      .toEqual({ allowed: true, reason: null, retryAfterSeconds: 0 });
    expect(firstReservation.allowed ? secondReservation : firstReservation)
      .toEqual({ allowed: false, reason: "cooldown", retryAfterSeconds: 900 });
  });

  it("keeps a newly issued report token blind to an existing address's membership", async () => {
    const first = await repository.saveResponse(input("victim@example.com", false));
    const confirmationHash = hashStudyProfileReportToken(
      "confirmation_token_that_is_long_enough_victim",
    );
    const requested = await repository.requestWaitlistConfirmation(
      first.storedResponse.reportToken,
      "report_cta",
      confirmationHash,
    );
    await repository.markWaitlistConfirmationDelivery(
      requested?.confirmationId ?? "",
      "sent",
    );
    await repository.confirmWaitlist(confirmationHash);

    expect(await repository.getReportByToken(first.storedResponse.reportToken))
      .toMatchObject({ waitlistJoined: true, confirmationPending: false });

    const fresh = await repository.saveResponse(input(" VICTIM@example.com ", false));
    expect(fresh).toMatchObject({
      waitlistJoined: false,
      confirmationPending: false,
      betaInterest: null,
    });
    expect(await repository.getReportByToken(fresh.storedResponse.reportToken))
      .toMatchObject({ waitlistJoined: false, confirmationPending: false });
    await expect(repository.requestWaitlistConfirmation(
      fresh.storedResponse.reportToken,
      "report_cta",
      hashStudyProfileReportToken("confirmation_token_that_is_long_enough_fresh"),
    )).resolves.toEqual({
      waitlistJoined: false,
      confirmationPending: true,
      dailyCapReached: false,
      shouldSend: false,
      confirmationId: null,
      email: null,
      retryAfterSeconds: 0,
    });
  });

  it("enforces one recipient-wide confirmation reservation every 15 minutes", async () => {
    const first = await repository.saveResponse(input("student@example.com", false));
    const second = await repository.saveResponse(input("student@example.com", false));
    await expect(repository.requestWaitlistConfirmation(
      first.storedResponse.reportToken,
      "report_cta",
      hashStudyProfileReportToken("confirmation_token_that_is_long_enough_cross_1"),
    )).resolves.toMatchObject({ shouldSend: true, retryAfterSeconds: 0 });

    await expect(repository.requestWaitlistConfirmation(
      second.storedResponse.reportToken,
      "report_cta",
      hashStudyProfileReportToken("confirmation_token_that_is_long_enough_cross_2"),
    )).resolves.toEqual({
      waitlistJoined: false,
      confirmationPending: true,
      dailyCapReached: false,
      shouldSend: false,
      confirmationId: null,
      email: null,
      retryAfterSeconds: 900,
    });
  });

  it("caps combined report and confirmation reservations at five per address per day", async () => {
    let now = new Date("2026-08-11T12:00:00.000Z");
    const cappedRepository = new MemoryStudyProfileRepository(undefined, {
      now: () => now,
      token: () => `token_${String(++tokenIndex).padStart(36, "x")}`,
      uuid: () => `00000000-0000-4000-8000-${String(++uuidIndex).padStart(12, "0")}`,
    });
    const saved = await Promise.all(Array.from({ length: 6 }, () => (
      cappedRepository.saveResponse(input("recipient@example.com", false))
    )));

    await expect(cappedRepository.reserveReportEmailDelivery(saved[0].storedResponse.id))
      .resolves.toMatchObject({ allowed: true });
    now = new Date("2026-08-11T12:16:00.000Z");
    await expect(cappedRepository.requestWaitlistConfirmation(
      saved[1].storedResponse.reportToken,
      "report_cta",
      hashStudyProfileReportToken("confirmation_token_that_is_long_enough_cap_1"),
    )).resolves.toMatchObject({ shouldSend: true });

    for (const [index, minute] of [[2, 32], [3, 48], [4, 64]] as const) {
      now = new Date(`2026-08-11T${String(12 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00.000Z`);
      await expect(cappedRepository.reserveReportEmailDelivery(saved[index].storedResponse.id))
        .resolves.toMatchObject({ allowed: true });
    }

    now = new Date("2026-08-11T13:20:00.000Z");
    await expect(cappedRepository.reserveReportEmailDelivery(saved[5].storedResponse.id))
      .resolves.toMatchObject({ allowed: false, reason: "daily_cap" });
    await expect(cappedRepository.requestWaitlistConfirmation(
      saved[5].storedResponse.reportToken,
      "report_cta",
      hashStudyProfileReportToken("confirmation_token_that_is_long_enough_cap_2"),
    )).resolves.toMatchObject({
      waitlistJoined: false,
      dailyCapReached: true,
      shouldSend: false,
    });
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
