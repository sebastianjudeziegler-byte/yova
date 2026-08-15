import { NextResponse } from "next/server";
import {
  FounderTesterInviteSchema,
  founderTesterFromRow,
  isExistingAuthUserError,
  readBoundedFounderInviteJson,
  validateFounderInviteRequest,
  type TesterInviteRow,
} from "@/lib/founder/tester-invites";
import { checkFounderInviteRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import { getSiteUrl } from "@/lib/site-url";
import {
  createSupabaseAdminClient,
  createSupabaseNoSessionAuthClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type InviteLedgerRow = TesterInviteRow & {
  id: string;
  auth_user_id: string | null;
  send_count: number;
};

const LEDGER_SELECT = "id,email,display_name,auth_user_id,status,send_count,invited_at,joined_at";

export async function POST(request: Request) {
  const guard = validateFounderInviteRequest(request);
  if (!guard.ok) return jsonError(guard.message, guard.status);

  if (!isSupabaseAdminConfigured()) {
    return jsonError("Tester invitations are not configured on this YOVA environment.", 503);
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return jsonError("Sign in with the YOVA founder account first.", 401);

  const { data: founderAccess, error: founderError } = await supabase.rpc("is_yova_founder");
  if (founderError || founderAccess !== true) {
    return jsonError("Founder access is required to invite testers.", 403);
  }

  const rateLimit = checkFounderInviteRateLimit(`${user.id}:${requestRateLimitKey(request)}`);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many invitations were requested at once. Wait a minute and try again." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      },
    );
  }

  const body = await readBoundedFounderInviteJson(request);
  if (!body.ok) {
    return jsonError(
      body.reason === "too_large"
        ? "The invitation request is too large."
        : "The invitation request was not valid JSON.",
      body.reason === "too_large" ? 413 : 400,
    );
  }

  const parsed = FounderTesterInviteSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonError("Enter a valid email address and an optional name under 80 characters.", 422);
  }

  const admin = createSupabaseAdminClient();
  const { email, displayName } = parsed.data;
  const { data: existingData, error: existingError } = await admin
    .from("tester_invites")
    .select(LEDGER_SELECT)
    .eq("email", email)
    .maybeSingle();
  const existing = existingData as InviteLedgerRow | null;

  if (existingError) {
    console.error("YOVA tester invitation ledger lookup failed", { code: existingError.code ?? "unknown" });
    return jsonError("YOVA could not check tester access right now. Try again.", 503);
  }

  if (existing?.status === "joined") {
    return NextResponse.json(
      { tester: founderTesterFromRow(existing), alreadyInvited: true },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  const createdLedger = !existing;
  const ledger = existing ?? await createPendingInvite({
    admin,
    email,
    displayName: displayName ?? null,
    founderId: user.id,
  });
  if (!ledger) return jsonError("YOVA could not prepare that invitation. Try again.", 500);

  if (existing && displayName !== undefined && displayName !== existing.display_name) {
    const { error } = await admin
      .from("tester_invites")
      .update({ display_name: displayName })
      .eq("id", ledger.id);
    if (error) {
      console.error("YOVA tester invitation name update failed", { code: error.code ?? "unknown" });
      return jsonError("YOVA could not update that pending invitation. Try again.", 500);
    }
    ledger.display_name = displayName;
  }

  if (existing?.auth_user_id) {
    return resendPendingInvitation({ admin, ledger, displayName });
  }

  const confirmationUrl = new URL("/auth/confirm", getSiteUrl().origin).toString();
  const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: confirmationUrl,
    data: {
      ...(displayName ? { display_name: displayName } : {}),
      tester_invite_id: ledger.id,
    },
  });

  if (inviteError) {
    console.error("YOVA tester invitation send failed", { code: inviteError.code ?? "unknown" });
    if (isExistingAuthUserError(inviteError)) {
      return sendExistingUserAccessEmail({
        admin,
        ledger,
        displayName,
        deleteLedgerOnSendFailure: createdLedger,
      });
    }
    if (createdLedger) await deleteUnsentLedger(admin, ledger.id);
    return jsonError("YOVA could not send that invitation. Try again in a moment.", 502);
  }

  const invitedAt = new Date().toISOString();
  const { data: updatedData, error: updateError } = await admin
    .from("tester_invites")
    .update({
      auth_user_id: invitation.user.id,
      display_name: displayName ?? ledger.display_name,
      invited_at: invitedAt,
      send_count: ledger.send_count + 1,
    })
    .eq("id", ledger.id)
    .select(LEDGER_SELECT)
    .single();
  const updated = updatedData as InviteLedgerRow | null;

  if (updateError || !updated) {
    console.error("YOVA tester invitation ledger update failed", { code: updateError?.code ?? "unknown" });
    return jsonError("The invitation was sent, but YOVA could not refresh its tester list.", 500);
  }

  return NextResponse.json(
    { tester: founderTesterFromRow(updated) },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

async function resendPendingInvitation({
  admin,
  ledger,
  displayName,
}: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  ledger: InviteLedgerRow;
  displayName: string | undefined;
}) {
  const confirmationUrl = new URL("/auth/confirm", getSiteUrl().origin).toString();
  const { data: invitation, error } = await admin.auth.admin.inviteUserByEmail(ledger.email, {
    redirectTo: confirmationUrl,
    data: {
      ...(displayName ? { display_name: displayName } : {}),
      tester_invite_id: ledger.id,
    },
  });

  if (error && isExistingAuthUserError(error)) {
    return sendExistingUserAccessEmail({ admin, ledger, displayName });
  }

  if (error || !invitation.user?.id) {
    console.error("YOVA pending tester invitation resend failed", { code: error?.code ?? "missing-user" });
    return jsonError("YOVA could not send that invitation again. Try again in a moment.", 502);
  }

  const invitedAt = new Date().toISOString();
  const { data, error: updateError } = await admin
    .from("tester_invites")
    .update({
      auth_user_id: invitation.user.id,
      display_name: displayName ?? ledger.display_name,
      invited_at: invitedAt,
      send_count: ledger.send_count + 1,
    })
    .eq("id", ledger.id)
    .select(LEDGER_SELECT)
    .single();

  if (updateError || !data) {
    console.error("YOVA resent tester invitation ledger update failed", {
      code: updateError?.code ?? "unknown",
    });
    return jsonError("The email was sent, but YOVA could not refresh its tester list.", 500);
  }

  return NextResponse.json(
    { tester: founderTesterFromRow(data as InviteLedgerRow) },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

async function sendExistingUserAccessEmail({
  admin,
  ledger,
  displayName,
  deleteLedgerOnSendFailure = false,
}: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  ledger: InviteLedgerRow;
  displayName: string | undefined;
  deleteLedgerOnSendFailure?: boolean;
}) {
  // A confirmed Auth user cannot receive another Supabase "invite". Send a
  // normal magic-link email instead. The configured email template sends its
  // TokenHash to scanner-safe /auth/confirm, so no founder-side PKCE verifier
  // or browser cookie is required.
  const confirmationUrl = new URL("/auth/confirm", getSiteUrl().origin).toString();
  const auth = createSupabaseNoSessionAuthClient();
  const { error } = await auth.auth.signInWithOtp({
    email: ledger.email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: confirmationUrl,
    },
  });

  if (error) {
    console.error("YOVA existing tester access email failed", { code: error.code ?? "unknown" });
    if (deleteLedgerOnSendFailure) await deleteUnsentLedger(admin, ledger.id);
    return jsonError("YOVA could not send that tester access email. Try again in a moment.", 502);
  }

  const invitedAt = new Date().toISOString();
  const { data, error: updateError } = await admin
    .from("tester_invites")
    .update({
      display_name: displayName ?? ledger.display_name,
      invited_at: invitedAt,
      send_count: ledger.send_count + 1,
    })
    .eq("id", ledger.id)
    .select(LEDGER_SELECT)
    .single();

  if (updateError || !data) {
    console.error("YOVA existing tester access ledger update failed", {
      code: updateError?.code ?? "unknown",
    });
    return jsonError("The email was sent, but YOVA could not refresh its tester list.", 500);
  }

  return NextResponse.json(
    { tester: founderTesterFromRow(data as InviteLedgerRow) },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

async function createPendingInvite({
  admin,
  email,
  displayName,
  founderId,
}: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  email: string;
  displayName: string | null;
  founderId: string;
}) {
  const { data, error } = await admin
    .from("tester_invites")
    .insert({ email, display_name: displayName, invited_by: founderId })
    .select(LEDGER_SELECT)
    .single();

  if (error || !data) {
    console.error("YOVA tester invitation ledger insert failed", { code: error?.code ?? "unknown" });
    return null;
  }

  return data as InviteLedgerRow;
}

async function deleteUnsentLedger(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  inviteId: string,
) {
  const { error } = await admin.from("tester_invites").delete().eq("id", inviteId);
  if (error) {
    console.error("YOVA unsent tester invitation cleanup failed", { code: error.code ?? "unknown" });
  }
}

function jsonError(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
