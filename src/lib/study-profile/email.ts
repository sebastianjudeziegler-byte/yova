import "server-only";

import { z } from "zod";
import { StudyProfileEmailSchema } from "@/lib/study-profile/schema";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
const EMAIL_SUBJECT = "Your YOVA Study Profile is ready";
export const STUDY_PROFILE_EMAIL_REQUEST_TIMEOUT_MS = 4_000;

const StudyProfileReportEmailInputSchema = z.object({
  to: StudyProfileEmailSchema,
  reportUrl: z.string().trim().url().max(2_000).refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "Report URL must use HTTP(S)"),
  primaryPatternName: z.string().trim().min(1).max(100),
  primaryPatternLabel: z.string().trim().min(1).max(100),
  responseId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

export type StudyProfileReportEmailInput = z.input<
  typeof StudyProfileReportEmailInputSchema
>;

export type StudyProfileEmailDeliveryResult =
  | {
    status: "sent";
    provider: "resend";
    providerMessageId?: string;
  }
  | {
    status: "skipped";
    reason: "not_configured";
  }
  | {
    status: "failed";
    reason: "invalid_input" | "provider_error" | "network_error";
    providerStatus?: number;
  };

export function escapeStudyProfileEmailHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildStudyProfileReportEmail(
  input: Omit<StudyProfileReportEmailInput, "to" | "responseId">,
) {
  const patternName = input.primaryPatternName.trim();
  const patternLabel = input.primaryPatternLabel.trim();
  const reportUrl = new URL(input.reportUrl).toString();
  const safePatternName = escapeStudyProfileEmailHtml(patternName);
  const safePatternLabel = escapeStudyProfileEmailHtml(patternLabel);
  const safeReportUrl = escapeStudyProfileEmailHtml(reportUrl);

  return {
    subject: EMAIL_SUBJECT,
    text: [
      "Your YOVA Study Profile is ready.",
      "",
      "Your top result:",
      `${patternName}: ${patternLabel}`,
      "",
      "Your report includes study methods and a session plan based on your answers.",
      "",
      `View My Study Profile: ${reportUrl}`,
      "",
      "Keep this link private. It opens your report without asking you to sign in.",
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f8fafc;color:#172033;font-family:Inter,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your YOVA Study Profile is ready.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;overflow:hidden;">
            <tr>
              <td style="padding:32px;">
                <div style="font-family:Sora,Inter,Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.03em;color:#5b4bff;">YOVA</div>
                <h1 style="margin:28px 0 12px;font-family:Sora,Inter,Arial,sans-serif;font-size:26px;line-height:1.25;letter-spacing:-0.03em;color:#172033;">Your Study Profile is ready.</h1>
                <p style="margin:0 0 24px;font-size:16px;line-height:1.65;color:#5f6b7a;">Your report includes study methods and a session plan based on your answers.</p>
                <div style="margin:0 0 28px;padding:18px 20px;background:#f3f1ff;border-radius:14px;">
                  <div style="margin-bottom:6px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6957d9;">Your top result</div>
                  <div style="font-size:18px;line-height:1.45;font-weight:750;color:#172033;">${safePatternName}: ${safePatternLabel}</div>
                </div>
                <a href="${safeReportUrl}" style="display:inline-block;padding:14px 20px;background:#5b4bff;border-radius:12px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:750;">View My Study Profile</a>
                <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#7a8494;">Keep this link private. It opens your report without asking you to sign in.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}

/**
 * Sends the transactional private-report link through Resend. Missing config
 * is an expected local-development state; provider failures are returned to
 * the caller and never prevent the on-page report from rendering.
 */
export async function sendStudyProfileReportEmail(
  input: StudyProfileReportEmailInput,
): Promise<StudyProfileEmailDeliveryResult> {
  const parsed = StudyProfileReportEmailInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "failed", reason: "invalid_input" };
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.STUDY_PROFILE_FROM_EMAIL?.trim();
  if (!apiKey || !from) {
    return { status: "skipped", reason: "not_configured" };
  }

  const replyTo = process.env.STUDY_PROFILE_REPLY_TO?.trim();
  const message = buildStudyProfileReportEmail(parsed.data);
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    STUDY_PROFILE_EMAIL_REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(RESEND_EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `study-profile-report/${parsed.data.responseId}`,
      },
      body: JSON.stringify({
        from,
        to: parsed.data.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      return {
        status: "failed",
        reason: "provider_error",
        providerStatus: response.status,
      };
    }

    let providerMessageId: string | undefined;
    try {
      const payload = await response.json() as { id?: unknown };
      if (typeof payload.id === "string" && payload.id.length <= 256) {
        providerMessageId = payload.id;
      }
    } catch {
      // A successful status is authoritative even if the optional ID is absent.
    }

    return {
      status: "sent",
      provider: "resend",
      ...(providerMessageId ? { providerMessageId } : {}),
    };
  } catch {
    return { status: "failed", reason: "network_error" };
  } finally {
    clearTimeout(timeout);
  }
}
