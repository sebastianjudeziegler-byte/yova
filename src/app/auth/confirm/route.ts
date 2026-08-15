import { NextResponse, type NextRequest } from "next/server";
import { getSiteUrl } from "@/lib/site-url";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CONFIRMATION_MAX_BYTES = 2_048;
const INVITE_TOKEN_HASH = /^[A-Za-z0-9_-]{20,1024}$/;
type ConfirmationType = "invite" | "email";

/**
 * Email security scanners commonly open links before the recipient does. GET is
 * deliberately inert so a preview/prefetch cannot spend the one-time token.
 */
export async function GET(request: NextRequest) {
  const confirmation = confirmationFromUrl(request.nextUrl);
  if (!isSupabaseConfigured() || !confirmation) return authRedirect("invalid-link");

  return new NextResponse(confirmationPage(confirmation), {
    status: 200,
    headers: confirmationHeaders(),
  });
}

/** The one-time token is consumed only after the tester presses the form button. */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured() || !isSameOriginFormPost(request)) {
    return authRedirect("invalid-link");
  }

  const body = await readBoundedFormBody(request);
  if (!body) return authRedirect("invalid-link");

  const tokenHash = body.get("token_hash") ?? "";
  const type = parseConfirmationType(body.get("type"));
  if (!type || !INVITE_TOKEN_HASH.test(tokenHash)) return authRedirect("invalid-link");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error || !data.user?.email) {
    console.error("YOVA tester invitation confirmation failed", {
      code: error?.code ?? "missing-user",
      status: error?.status ?? null,
    });
    return authRedirect("failed");
  }

  // The database trigger is authoritative for new invitees. This update also
  // handles already-confirmed Auth users accepting a later tester invitation.
  if (isSupabaseAdminConfigured()) {
    const admin = createSupabaseAdminClient();
    const { error: ledgerError } = await admin
      .from("tester_invites")
      .update({
        auth_user_id: data.user.id,
        status: "joined",
        joined_at: new Date().toISOString(),
      })
      .eq("email", data.user.email.trim().toLowerCase());
    if (ledgerError) {
      console.error("YOVA tester invitation confirmation ledger update failed", {
        code: ledgerError.code ?? "unknown",
      });
    }
  }

  const response = NextResponse.redirect(new URL("/", getSiteUrl().origin));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function confirmationFromUrl(url: URL) {
  const tokenHash = url.searchParams.get("token_hash") ?? "";
  const type = parseConfirmationType(url.searchParams.get("type"));
  return type && INVITE_TOKEN_HASH.test(tokenHash) ? { tokenHash, type } : null;
}

function parseConfirmationType(value: string | null): ConfirmationType | null {
  return value === "invite" || value === "email" ? value : null;
}

function isSameOriginFormPost(request: NextRequest) {
  const mediaType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/x-www-form-urlencoded") return false;

  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") return false;

  const origin = request.headers.get("origin")?.trim();
  if (!origin) return false;

  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

async function readBoundedFormBody(request: NextRequest) {
  if (!request.body) return null;
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > CONFIRMATION_MAX_BYTES) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > CONFIRMATION_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
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
    return new URLSearchParams(text);
  } catch {
    return null;
  }
}

function confirmationHeaders() {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
}

function confirmationPage({ tokenHash, type }: { tokenHash: string; type: ConfirmationType }) {
  const invitation = type === "invite";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${invitation ? "Accept your YOVA invitation" : "Sign in to YOVA"}</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#f4f6fb;color:#0b1020;font-family:Inter,Arial,sans-serif}.shell{min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(100%,520px);background:#fff;border:1px solid #e0e5ef;border-radius:20px;padding:40px;box-shadow:0 18px 50px rgba(11,16,32,.09);text-align:center}.brand{display:inline-flex;align-items:center;gap:10px;font-weight:800;letter-spacing:.16em}.mark{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:#0b1020;color:#fff}.eyebrow{margin:32px 0 12px;color:#346bff;font-size:12px;font-weight:800;letter-spacing:.12em}.card h1{margin:0;font-size:clamp(30px,7vw,42px);line-height:1.12}.copy{margin:18px auto 28px;max-width:390px;color:#667085;font-size:16px;line-height:1.65}.button{width:100%;min-height:52px;border:0;border-radius:12px;background:#346bff;color:#fff;font-size:16px;font-weight:750;cursor:pointer}.note{margin:18px 0 0;color:#98a2b3;font-size:13px;line-height:1.5}@media(max-width:520px){.shell{padding:0}.card{min-height:100vh;border:0;border-radius:0;padding:36px 24px;display:flex;flex-direction:column;justify-content:center}}
  </style>
</head>
<body>
  <main class="shell">
    <section class="card" aria-labelledby="confirmation-title">
      <div class="brand"><span class="mark" aria-hidden="true">Y</span><span>YOVA</span></div>
      <p class="eyebrow">${invitation ? "PRIVATE ALPHA INVITATION" : "SECURE SIGN-IN"}</p>
      <h1 id="confirmation-title">${invitation ? "Your YOVA invitation is ready." : "Continue to your YOVA."}</h1>
      <p class="copy">${invitation ? "Press the button below to accept your invitation and open YOVA." : "Press the button below to finish signing in. Your learning profile and progress will stay connected."}</p>
      <form method="post" action="/auth/confirm">
        <input type="hidden" name="token_hash" value="${tokenHash}">
        <input type="hidden" name="type" value="${type}">
        <button class="button" type="submit">${invitation ? "Accept invitation and open YOVA" : "Sign in to YOVA"}</button>
      </form>
      <p class="note">This button protects your one-time link from being used by an automatic email preview.</p>
    </section>
  </main>
</body>
</html>`;
}

function authRedirect(result: "invalid-link" | "failed") {
  const destination = new URL("/", getSiteUrl().origin);
  destination.searchParams.set("auth", result);
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
