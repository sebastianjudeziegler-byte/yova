import { describe, expect, it } from "vitest";
import {
  createSessionAdaptationNote,
  readSessionAdaptationNote,
} from "@/lib/personalization/adaptation-note";

describe("session adaptation notes", () => {
  it("creates a note only from a useful explanation and valid date", () => {
    expect(createSessionAdaptationNote(
      " YOVA added retrieval because the previous check showed a gap. ",
      "2026-08-05T20:00:00.000Z",
    )).toEqual({
      explanation: "YOVA added retrieval because the previous check showed a gap.",
      adaptedAt: "2026-08-05T20:00:00.000Z",
    });
    expect(createSessionAdaptationNote("", "2026-08-05T20:00:00.000Z")).toBeUndefined();
    expect(createSessionAdaptationNote("Useful explanation", "not-a-date")).toBeUndefined();
  });

  it("restores a safe note from Supabase step data", () => {
    expect(readSessionAdaptationNote({
      adaptationExplanation: "YOVA added a guided example after the session felt too difficult.",
      adaptedAt: "2026-08-05T20:00:00.000Z",
    })?.explanation).toContain("guided example");
  });

  it("ignores partial or malformed database values", () => {
    expect(readSessionAdaptationNote({ adaptationExplanation: "Missing its timestamp" })).toBeUndefined();
    expect(readSessionAdaptationNote([])).toBeUndefined();
  });
});
