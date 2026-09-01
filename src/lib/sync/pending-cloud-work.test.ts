import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureAuthoritativeLearnerProfileSyncSnapshot } from "@/lib/sync/learner-profile-sync-snapshot";

const mocks = vi.hoisted(() => ({
  flushQueuedSessionTerminals: vi.fn(),
  saveAuthenticatedLearnerProfile: vi.fn(),
}));

vi.mock("@/lib/sync/session-terminal-outbox", () => ({
  flushQueuedSessionTerminals: mocks.flushQueuedSessionTerminals,
}));

vi.mock("@/lib/supabase/learning-state-repository", () => ({
  saveAuthenticatedLearnerProfile: mocks.saveAuthenticatedLearnerProfile,
}));

import { syncPendingCloudWork } from "@/lib/sync/pending-cloud-work";

const accountId = "10000000-0000-4000-8000-000000000001";
const profileState = (displayName: string) => ({
  accountId,
  displayName,
  onboardingAnswers: ["help_me_choose", "15_to_25_minutes"],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.flushQueuedSessionTerminals.mockResolvedValue({ synced: 0, remaining: 0 });
  mocks.saveAuthenticatedLearnerProfile.mockImplementation(async (input) => ({
    ...input,
    onboardingAnswers: [...input.onboardingAnswers],
  }));
});

describe("pending cloud work", () => {
  it("reads the latest profile only after terminal flushing settles", async () => {
    let releaseTerminalFlush!: () => void;
    mocks.flushQueuedSessionTerminals.mockReturnValue(new Promise((resolve) => {
      releaseTerminalFlush = () => resolve({ synced: 1, remaining: 0 });
    }));
    let current = profileState("Before edit");
    const sync = syncPendingCloudWork(accountId, () => ({
      onboardingCompleted: true,
      profileState: current,
      authoritativeSnapshot: captureAuthoritativeLearnerProfileSyncSnapshot(
        profileState("Cloud name"),
      ),
    }));

    current = profileState("Edited while terminal sync was running");
    releaseTerminalFlush();

    await expect(sync).resolves.toEqual({
      issue: null,
      syncedProfileState: current,
    });
    expect(mocks.saveAuthenticatedLearnerProfile).toHaveBeenCalledOnce();
    expect(mocks.saveAuthenticatedLearnerProfile).toHaveBeenCalledWith({
      accountId,
      displayName: "Edited while terminal sync was running",
      onboardingAnswers: current.onboardingAnswers,
    });
  });

  it("returns the exact payload receipt when the repository coalesces a newer write", async () => {
    const requested = profileState("Retry snapshot");
    const actuallyPersisted = profileState("Newer coalesced edit");
    mocks.saveAuthenticatedLearnerProfile.mockResolvedValue(actuallyPersisted);

    await expect(syncPendingCloudWork(accountId, () => ({
      onboardingCompleted: true,
      profileState: requested,
      authoritativeSnapshot: null,
    }))).resolves.toEqual({
      issue: null,
      syncedProfileState: actuallyPersisted,
    });
  });

  it("does not write a cloud-hydrated profile that is already authoritative", async () => {
    const current = profileState("Cloud name");

    await expect(syncPendingCloudWork(accountId, () => ({
      onboardingCompleted: true,
      profileState: { ...current, onboardingAnswers: [...current.onboardingAnswers] },
      authoritativeSnapshot: captureAuthoritativeLearnerProfileSyncSnapshot(current),
    }))).resolves.toEqual({ issue: null, syncedProfileState: null });
    expect(mocks.saveAuthenticatedLearnerProfile).not.toHaveBeenCalled();
  });

  it("does not write after sign-out or an account switch during terminal flushing", async () => {
    await expect(syncPendingCloudWork(accountId, () => null)).resolves.toEqual({
      issue: null,
      syncedProfileState: null,
    });
    await expect(syncPendingCloudWork(accountId, () => ({
      onboardingCompleted: true,
      profileState: { ...profileState("Other account"), accountId: "other-account" },
      authoritativeSnapshot: null,
    }))).resolves.toEqual({ issue: null, syncedProfileState: null });
    expect(mocks.saveAuthenticatedLearnerProfile).not.toHaveBeenCalled();
  });

  it("keeps a terminal warning ahead of profile retries", async () => {
    mocks.flushQueuedSessionTerminals.mockResolvedValue({ synced: 0, remaining: 2 });

    await expect(syncPendingCloudWork(accountId, () => ({
      onboardingCompleted: true,
      profileState: profileState("Dirty profile"),
      authoritativeSnapshot: null,
    }))).resolves.toEqual({
      issue: "2 session events are still waiting to sync.",
      syncedProfileState: null,
    });
    expect(mocks.saveAuthenticatedLearnerProfile).not.toHaveBeenCalled();
  });

  it("returns a profile failure without marking the payload as synced", async () => {
    mocks.saveAuthenticatedLearnerProfile.mockRejectedValue(new Error("Profile write failed"));

    await expect(syncPendingCloudWork(accountId, () => ({
      onboardingCompleted: true,
      profileState: profileState("Dirty profile"),
      authoritativeSnapshot: null,
    }))).resolves.toEqual({
      issue: "Profile write failed",
      syncedProfileState: null,
    });
  });
});
