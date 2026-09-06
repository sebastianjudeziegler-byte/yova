import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeStudyProfileReportTransition,
  storeStudyProfileReportTransition,
} from "@/lib/study-profile/report-transition";

describe("Study Profile cross-document report transition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves and consumes the delivery notice for the matching response", () => {
    const values = new Map<string, string>();
    const storage = storageFor(values);

    storeStudyProfileReportTransition({
      responseId: "11111111-1111-4111-8111-111111111111",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      emailDelivery: "failed",
      waitlistError: "The confirmation email could not be sent.",
    }, storage);

    expect(consumeStudyProfileReportTransition(
      "11111111-1111-4111-8111-111111111111",
      storage,
    )).toEqual({
      version: 1,
      responseId: "11111111-1111-4111-8111-111111111111",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      emailDelivery: "failed",
      waitlistError: "The confirmation email could not be sent.",
    });
    expect(values.size).toBe(0);
  });

  it("does not apply a stale transition to another private report", () => {
    const values = new Map<string, string>();
    const storage = storageFor(values);
    storeStudyProfileReportTransition({
      responseId: "11111111-1111-4111-8111-111111111111",
      emailDelivery: "skipped",
    }, storage);

    expect(consumeStudyProfileReportTransition(
      "22222222-2222-4222-8222-222222222222",
      storage,
    )).toBeNull();
    expect(values.size).toBe(0);
  });

  it("fails open when session storage is unavailable", () => {
    const unavailable = {
      getItem: vi.fn(() => { throw new Error("blocked"); }),
      removeItem: vi.fn(),
      setItem: vi.fn(() => { throw new Error("blocked"); }),
    };

    expect(() => storeStudyProfileReportTransition({
      responseId: "11111111-1111-4111-8111-111111111111",
      emailDelivery: "sent",
    }, unavailable)).not.toThrow();
    expect(consumeStudyProfileReportTransition(
      "11111111-1111-4111-8111-111111111111",
      unavailable,
    )).toBeNull();
  });

  it("fails open when the browser blocks the sessionStorage getter", () => {
    const blockedWindow = Object.defineProperty({}, "sessionStorage", {
      get() {
        throw new Error("blocked");
      },
    });
    vi.stubGlobal("window", blockedWindow);

    expect(() => storeStudyProfileReportTransition({
      responseId: "11111111-1111-4111-8111-111111111111",
      emailDelivery: "failed",
    })).not.toThrow();
    expect(consumeStudyProfileReportTransition(
      "11111111-1111-4111-8111-111111111111",
    )).toBeNull();
  });
});

function storageFor(values: Map<string, string>) {
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}
