import { afterEach, describe, expect, it, vi } from "vitest";
import { readActiveSessionCheckpointsForExport } from "@/lib/learning/active-session-checkpoint";
import { readPreviewSnapshotForExport } from "@/lib/persistence/preview-store";
import { readQueuedSessionCompletionsForExport } from "@/lib/sync/session-completion-outbox";
import { readQueuedSessionInterruptionsForExport } from "@/lib/sync/session-interruption-outbox";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

describe("account-export checked browser readers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("distinguishes an empty known store from unavailable localStorage", () => {
    vi.stubGlobal("window", { localStorage: { getItem: vi.fn(() => null) } });

    expect(readPreviewSnapshotForExport()).toEqual({ ok: true, value: null });
    expect(readQueuedSessionCompletionsForExport(ACCOUNT_ID)).toEqual({ ok: true, value: [] });
    expect(readQueuedSessionInterruptionsForExport(ACCOUNT_ID)).toEqual({ ok: true, value: [] });
    expect(readActiveSessionCheckpointsForExport(ACCOUNT_ID)).toEqual({ ok: true, value: [] });

    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => {
          throw new DOMException("blocked", "SecurityError");
        }),
      },
    });
    expect(readPreviewSnapshotForExport()).toEqual({ ok: false });
    expect(readQueuedSessionCompletionsForExport(ACCOUNT_ID)).toEqual({ ok: false });
    expect(readQueuedSessionInterruptionsForExport(ACCOUNT_ID)).toEqual({ ok: false });
    expect(readActiveSessionCheckpointsForExport(ACCOUNT_ID)).toEqual({ ok: false });
  });

  it("fails closed instead of silently omitting malformed records", () => {
    vi.stubGlobal("window", { localStorage: { getItem: vi.fn(() => "{not-json") } });

    expect(readPreviewSnapshotForExport()).toEqual({ ok: false });
    expect(readQueuedSessionCompletionsForExport(ACCOUNT_ID)).toEqual({ ok: false });
    expect(readQueuedSessionInterruptionsForExport(ACCOUNT_ID)).toEqual({ ok: false });
    expect(readActiveSessionCheckpointsForExport(ACCOUNT_ID)).toEqual({ ok: false });
  });
});
