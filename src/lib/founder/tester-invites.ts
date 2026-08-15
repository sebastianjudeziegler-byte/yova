import "server-only";
import { z } from "zod";

export const FOUNDER_INVITE_MAX_BYTES = 2_048;

export type FounderTester = {
  email: string;
  displayName?: string | null;
  status: "pending" | "joined";
  invitedAt: string;
  joinedAt?: string | null;
};

export type TesterInviteRow = {
  email: string;
  display_name: string | null;
  status: string;
  invited_at: string;
  joined_at: string | null;
};

const optionalDisplayName = z.union([
  z.string().trim().min(1).max(80),
  z.literal(""),
]).optional().transform((value) => value || undefined);

export const FounderTesterInviteSchema = z.object({
  email: z.string().trim().email().max(254),
  displayName: optionalDisplayName,
}).strict().transform((value) => ({
  email: value.email.toLowerCase(),
  displayName: value.displayName,
}));

export type FounderInviteRequestGuardResult =
  | { ok: true }
  | { ok: false; status: 403 | 415; message: string };

/** Requires a same-origin JSON request before cookie-backed founder auth runs. */
export function validateFounderInviteRequest(request: Request): FounderInviteRequestGuardResult {
  const mediaType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return { ok: false, status: 415, message: "Invitation requests must use application/json." };
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") {
    return { ok: false, status: 403, message: "Cross-origin invitation requests are not allowed." };
  }

  const origin = request.headers.get("origin")?.trim();
  if (!origin) {
    return { ok: false, status: 403, message: "Invitation requests require same-origin browser verification." };
  }

  try {
    if (new URL(origin).origin === new URL(request.url).origin) return { ok: true };
  } catch {
    // Invalid and opaque origins are not accepted for a founder write.
  }

  return { ok: false, status: 403, message: "Cross-origin invitation requests are not allowed." };
}

export async function readBoundedFounderInviteJson(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: "invalid_json" | "too_large" }> {
  if (!request.body) return { ok: false, reason: "invalid_json" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > FOUNDER_INVITE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "invalid_json" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

export function founderTesterFromRow(row: TesterInviteRow): FounderTester {
  return {
    email: row.email,
    displayName: row.display_name,
    status: row.status === "joined" ? "joined" : "pending",
    invitedAt: row.invited_at,
    joinedAt: row.joined_at,
  };
}

export function isExistingAuthUserError(error: { code?: string; message?: string }) {
  const code = error.code?.toLowerCase();
  if (code === "email_exists" || code === "user_already_exists") return true;
  const message = error.message?.toLowerCase() ?? "";
  return message.includes("already registered") || message.includes("already been registered");
}
