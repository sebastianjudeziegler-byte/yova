import { describe, expect, it } from "vitest";
import {
  FounderPeopleDirectoryResponseSchema,
  FounderPeopleQuerySchema,
} from "@/lib/founder/people";
import { directoryRow } from "@/lib/founder/people.test-support";

describe("founder people contracts", () => {
  it("bounds search, filters, cursor, and page size", () => {
    expect(FounderPeopleQuerySchema.parse({}).limit).toBe(25);
    expect(FounderPeopleQuerySchema.safeParse({ search: "x".repeat(121) }).success).toBe(false);
    expect(FounderPeopleQuerySchema.safeParse({ kind: "customers" }).success).toBe(false);
    expect(FounderPeopleQuerySchema.safeParse({ status: "deleted" }).success).toBe(false);
    expect(FounderPeopleQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("accepts only the explicit PII-safe directory shape", () => {
    const row = directoryRow();
    const response = {
      generatedAt: "2026-09-07T12:00:00.000Z",
      summary: {
        uniquePeople: 1,
        yovaAccounts: 1,
        studyProfileLeads: 1,
        confirmedWaitlist: 1,
        pendingInvites: 0,
      },
      total: 1,
      rows: [row],
      hasMore: false,
      nextCursor: null,
    };

    expect(FounderPeopleDirectoryResponseSchema.parse(response).rows[0]?.kind).toBe("linked");
    expect(FounderPeopleDirectoryResponseSchema.safeParse({
      ...response,
      rows: [{ ...row, rawAnswers: { q1: "a" } }],
    }).success).toBe(false);
  });
});
