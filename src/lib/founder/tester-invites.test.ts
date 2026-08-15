import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  FOUNDER_INVITE_MAX_BYTES,
  FounderTesterInviteSchema,
  founderTesterFromRow,
  isExistingAuthUserError,
  readBoundedFounderInviteJson,
  validateFounderInviteRequest,
} from "@/lib/founder/tester-invites";

describe("founder tester invitation security", () => {
  it("normalizes a bounded email and optional tester name", () => {
    expect(FounderTesterInviteSchema.parse({
      email: "  Tester@Example.COM ",
      displayName: "  Ada  ",
    })).toEqual({ email: "tester@example.com", displayName: "Ada" });
    expect(FounderTesterInviteSchema.parse({
      email: "tester@example.com",
      displayName: "",
    })).toEqual({ email: "tester@example.com", displayName: undefined });
  });

  it("rejects extra fields and malformed values", () => {
    expect(FounderTesterInviteSchema.safeParse({
      email: "not-an-email",
      role: "founder",
    }).success).toBe(false);
    expect(FounderTesterInviteSchema.safeParse({
      email: "tester@example.com",
      displayName: "x".repeat(81),
    }).success).toBe(false);
  });

  it("accepts only exact same-origin JSON browser requests", () => {
    const valid = inviteRequest("https://yova.example/api/founder/testers/invite", {
      Origin: "https://yova.example",
      "Sec-Fetch-Site": "same-origin",
    });
    const forwardedSpoof = inviteRequest("https://internal.example/api/founder/testers/invite", {
      Origin: "https://yova.example",
      "Sec-Fetch-Site": "same-origin",
      "X-Forwarded-Host": "yova.example",
      "X-Forwarded-Proto": "https",
    });
    const crossOrigin = inviteRequest("https://yova.example/api/founder/testers/invite", {
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "cross-site",
    });
    const missingOrigin = inviteRequest("https://yova.example/api/founder/testers/invite");
    const simplePost = new Request("https://yova.example/api/founder/testers/invite", {
      method: "POST",
      headers: { Origin: "https://yova.example", "Content-Type": "text/plain" },
      body: "{}",
    });

    expect(validateFounderInviteRequest(valid)).toEqual({ ok: true });
    expect(validateFounderInviteRequest(forwardedSpoof)).toMatchObject({ ok: false, status: 403 });
    expect(validateFounderInviteRequest(crossOrigin)).toMatchObject({ ok: false, status: 403 });
    expect(validateFounderInviteRequest(missingOrigin)).toMatchObject({ ok: false, status: 403 });
    expect(validateFounderInviteRequest(simplePost)).toMatchObject({ ok: false, status: 415 });
  });

  it("reads valid JSON and rejects streamed bytes above the real limit", async () => {
    const valid = inviteRequest("https://yova.example/api/founder/testers/invite", {}, {
      email: "tester@example.com",
    });
    const oversized = inviteRequest("https://yova.example/api/founder/testers/invite", {}, {
      email: "tester@example.com",
      displayName: "x".repeat(FOUNDER_INVITE_MAX_BYTES),
    });

    await expect(readBoundedFounderInviteJson(valid)).resolves.toEqual({
      ok: true,
      value: { email: "tester@example.com" },
    });
    await expect(readBoundedFounderInviteJson(oversized)).resolves.toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("maps only the public founder tester fields", () => {
    expect(founderTesterFromRow({
      email: "tester@example.com",
      display_name: "Ada",
      status: "joined",
      invited_at: "2026-08-14T10:00:00.000Z",
      joined_at: "2026-08-14T10:05:00.000Z",
    })).toEqual({
      email: "tester@example.com",
      displayName: "Ada",
      status: "joined",
      invitedAt: "2026-08-14T10:00:00.000Z",
      joinedAt: "2026-08-14T10:05:00.000Z",
    });
  });

  it("recognizes only bounded existing-user provider failures", () => {
    expect(isExistingAuthUserError({ code: "email_exists" })).toBe(true);
    expect(isExistingAuthUserError({ message: "A user with this email has already been registered" })).toBe(true);
    expect(isExistingAuthUserError({ code: "over_email_send_rate_limit" })).toBe(false);
  });
});

function inviteRequest(
  url: string,
  headers: Record<string, string> = {},
  body: unknown = {},
) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
