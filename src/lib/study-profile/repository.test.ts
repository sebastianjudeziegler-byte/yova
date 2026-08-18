import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildStudyProfileReport, scoreStudyProfile } from "@/lib/study-profile";
import {
  MemoryStudyProfileRepository,
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
    });
    await expect(repository.joinWaitlist(token)).resolves.toEqual({
      waitlistJoined: true,
      betaInterest: null,
    });
    const lead = [...repository.inspect().leadsByEmail.values()][0];
    expect(lead.waitlistJoinedAt).toBe("2026-08-11T12:00:00.000Z");
    expect(lead.waitlistConsentCopyVersion).toBe("study-profile-waitlist-v2");
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
