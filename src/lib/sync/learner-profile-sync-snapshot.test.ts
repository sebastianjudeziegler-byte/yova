import { describe, expect, it } from "vitest";
import {
  captureAuthoritativeLearnerProfileSyncSnapshot,
  learnerProfileNeedsSync,
  learnerProfileSyncFingerprint,
  type LearnerProfileSyncState,
} from "@/lib/sync/learner-profile-sync-snapshot";

const hydratedState = (): LearnerProfileSyncState => ({
  accountId: "11111111-1111-4111-8111-111111111111",
  displayName: "Ada Lovelace",
  onboardingAnswers: [
    "starting_is_hard",
    "offer_a_path",
    "15_to_25_minutes",
    "{\"version\":1,\"controls\":{\"selfReport\":true}}",
  ],
});

describe("learner profile sync snapshot", () => {
  it("recognizes a cloned cloud-hydrated payload as already authoritative", () => {
    const hydrated = hydratedState();
    const snapshot = captureAuthoritativeLearnerProfileSyncSnapshot(hydrated);
    const cloned = {
      ...hydrated,
      onboardingAnswers: [...hydrated.onboardingAnswers],
    };

    expect(learnerProfileNeedsSync(cloned, snapshot)).toBe(false);
    expect(learnerProfileSyncFingerprint(cloned)).toBe(
      learnerProfileSyncFingerprint(hydrated),
    );
  });

  it("requires a save when no authoritative snapshot exists", () => {
    expect(learnerProfileNeedsSync(hydratedState(), null)).toBe(true);
  });

  it("keeps account and display-name edits inside the sync identity", () => {
    const hydrated = hydratedState();
    const snapshot = captureAuthoritativeLearnerProfileSyncSnapshot(hydrated);

    expect(learnerProfileNeedsSync({
      ...hydrated,
      accountId: "22222222-2222-4222-8222-222222222222",
    }, snapshot)).toBe(true);
    expect(learnerProfileNeedsSync({
      ...hydrated,
      displayName: "Grace Hopper",
    }, snapshot)).toBe(true);
  });

  it("treats canonicalized answer content as a real edit", () => {
    const hydrated = hydratedState();
    const snapshot = captureAuthoritativeLearnerProfileSyncSnapshot(hydrated);
    const canonicalized = {
      ...hydrated,
      onboardingAnswers: hydrated.onboardingAnswers.map((answer, index) => (
        index === 3
          ? "{\"controls\":{\"selfReport\":true},\"version\":1}"
          : answer
      )),
    };

    expect(learnerProfileNeedsSync(canonicalized, snapshot)).toBe(true);
  });

  it("preserves answer order and empty slots in the sync identity", () => {
    const hydrated = hydratedState();
    const snapshot = captureAuthoritativeLearnerProfileSyncSnapshot(hydrated);
    const reordered = {
      ...hydrated,
      onboardingAnswers: [
        hydrated.onboardingAnswers[1],
        hydrated.onboardingAnswers[0],
        ...hydrated.onboardingAnswers.slice(2),
      ],
    };
    const extraEmptySlot = {
      ...hydrated,
      onboardingAnswers: [...hydrated.onboardingAnswers, ""],
    };

    expect(learnerProfileNeedsSync(reordered, snapshot)).toBe(true);
    expect(learnerProfileNeedsSync(extraEmptySlot, snapshot)).toBe(true);
  });

  it("recognizes the exact state after a successful save as current", () => {
    const edited = {
      ...hydratedState(),
      onboardingAnswers: [...hydratedState().onboardingAnswers, "new preference"],
    };
    const savedSnapshot = captureAuthoritativeLearnerProfileSyncSnapshot(edited);

    expect(learnerProfileNeedsSync(edited, savedSnapshot)).toBe(false);
  });
});
