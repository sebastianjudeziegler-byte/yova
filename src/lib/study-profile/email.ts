import "server-only";

import { z } from "zod";
import { StudyProfileEmailSchema } from "@/lib/study-profile/schema";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
export const STUDY_PROFILE_EMAIL_REQUEST_TIMEOUT_MS = 4_000;

const StudyProfileEmailCopySchema = z.string().trim().min(1).max(700);
const StudyProfileEmailMethodSchema = z.string().trim().min(1).max(120);

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
  pattern: z.object({
    name: z.string().trim().min(1).max(100),
    tell: StudyProfileEmailCopySchema,
  }).strict(),
  why: StudyProfileEmailCopySchema,
  matchedMethods: z.tuple([
    StudyProfileEmailMethodSchema,
    StudyProfileEmailMethodSchema,
    StudyProfileEmailMethodSchema,
  ]),
  tonightPlan: StudyProfileEmailCopySchema,
  responseId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

const StudyProfileWaitlistConfirmationEmailInputSchema = z.object({
  to: StudyProfileEmailSchema,
  confirmationUrl: z.string().trim().url().max(2_000).refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:")
        && /^#token=[A-Za-z0-9_-]{43}$/.test(url.hash);
    } catch {
      return false;
    }
  }, "Confirmation URL must use HTTP(S) and contain one fragment token"),
  confirmationId: z.string().uuid(),
}).strict();

export type StudyProfileReportEmailInput = z.input<
  typeof StudyProfileReportEmailInputSchema
>;

export type StudyProfileWaitlistConfirmationEmailInput = z.input<
  typeof StudyProfileWaitlistConfirmationEmailInputSchema
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
  const patternName = input.pattern.name.trim();
  const patternTell = input.pattern.tell.trim();
  const why = input.why.trim();
  const matchedMethods = input.matchedMethods.map((method) => method.trim());
  const tonightPlan = input.tonightPlan.trim();
  const reportUrl = new URL(input.reportUrl).toString();
  const safePatternName = escapeStudyProfileEmailHtml(patternName);
  const safePatternTell = escapeStudyProfileEmailHtml(patternTell);
  const safeReportUrl = escapeStudyProfileEmailHtml(reportUrl);
  const safeWhy = escapeStudyProfileEmailHtml(why);
  const safeTonightPlan = escapeStudyProfileEmailHtml(tonightPlan);
  const safeMethods = matchedMethods.map(escapeStudyProfileEmailHtml);
  const subjectPatternName = patternName.replace(/[\r\n]+/g, " ");

  return {
    subject: `Your study profile: ${subjectPatternName}`,
    text: [
      "Your study profile",
      patternName,
      "",
      patternTell,
      "",
      `Open your private report: ${reportUrl}`,
      "",
      "Why this pattern fits:",
      why,
      "",
      "Your matched study methods:",
      ...matchedMethods.map((method, index) => `${index + 1}. ${method}`),
      "",
      "Your plan for tonight:",
      tonightPlan,
      "",
      "Keep the report link private. It opens your report without asking you to sign in.",
      "If you did not request this report, you can ignore this email.",
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#eef3ff;color:#0b1633;font-family:Inter,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your study profile is ${safePatternName}.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3ff;background-image:linear-gradient(180deg,#f8faff 0%,#eef3ff 100%);padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #d8e3ff;border-radius:24px;overflow:hidden;box-shadow:0 24px 70px rgba(31,67,145,0.14);">
            <tr>
              <td style="padding:32px;">
                <div style="font-family:Sora,Inter,Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.03em;color:#0b1b3e;">YOVA</div>
                <div style="margin:28px 0 8px;font-size:12px;font-weight:750;letter-spacing:0.12em;text-transform:uppercase;color:#316bff;">Your Study Profile</div>
                <h1 style="margin:0 0 12px;font-family:Sora,Inter,Arial,sans-serif;font-size:32px;line-height:1.16;letter-spacing:-0.04em;color:#08152f;">${safePatternName}</h1>
                <p style="margin:0 0 26px;font-size:16px;line-height:1.65;color:#52617f;">${safePatternTell}</p>
                <a href="${safeReportUrl}" style="display:inline-block;padding:14px 20px;background:#316bff;border-radius:12px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:750;box-shadow:0 10px 24px rgba(49,107,255,0.22);">Open my Study Profile</a>
                <div style="margin:30px 0 14px;padding:20px;background:#f7f9ff;border:1px solid #dfe7fb;border-radius:16px;">
                  <div style="margin-bottom:8px;font-size:12px;font-weight:750;letter-spacing:0.08em;text-transform:uppercase;color:#316bff;">Why this pattern fits</div>
                  <div style="font-size:15px;line-height:1.65;color:#233354;">${safeWhy}</div>
                </div>
                <div style="margin:0 0 14px;padding:20px;background:#f7f9ff;border:1px solid #dfe7fb;border-radius:16px;">
                  <div style="margin-bottom:12px;font-size:12px;font-weight:750;letter-spacing:0.08em;text-transform:uppercase;color:#316bff;">Matched study methods</div>
                  <div style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#0b1633;">1. ${safeMethods[0]}</div>
                  <div style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#0b1633;">2. ${safeMethods[1]}</div>
                  <div style="font-size:15px;line-height:1.5;color:#0b1633;">3. ${safeMethods[2]}</div>
                </div>
                <div style="margin:0 0 26px;padding:20px;background:#eaf0ff;border:1px solid #cfdcff;border-radius:16px;">
                  <div style="margin-bottom:8px;font-size:12px;font-weight:750;letter-spacing:0.08em;text-transform:uppercase;color:#2459d6;">Your plan for tonight</div>
                  <div style="font-size:15px;line-height:1.65;color:#14264b;">${safeTonightPlan}</div>
                </div>
                <p style="margin:0;font-size:12px;line-height:1.6;color:#77849f;">Keep the report link private. It opens your report without asking you to sign in. If you did not request this report, you can ignore this email.</p>
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

export function buildStudyProfileWaitlistConfirmationEmail(
  input: Pick<StudyProfileWaitlistConfirmationEmailInput, "confirmationUrl">,
) {
  const confirmationUrl = new URL(input.confirmationUrl).toString();
  const safeConfirmationUrl = escapeStudyProfileEmailHtml(confirmationUrl);
  return {
    subject: "Confirm your place on the YOVA waitlist",
    text: [
      "Confirm your YOVA waitlist signup",
      "",
      "Open this private confirmation page:",
      confirmationUrl,
      "",
      "Then select Confirm my place. Opening the link alone will not join the waitlist.",
      "",
      "This link expires in 24 hours. If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#eef3ff;color:#0b1633;font-family:Inter,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">One quick step confirms your place on the YOVA waitlist.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3ff;background-image:linear-gradient(180deg,#f8faff 0%,#eef3ff 100%);padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #d8e3ff;border-radius:24px;overflow:hidden;box-shadow:0 24px 70px rgba(31,67,145,0.14);">
            <tr>
              <td style="padding:32px;">
                <div style="font-family:Sora,Inter,Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.03em;color:#0b1b3e;">YOVA</div>
                <div style="margin:28px 0 8px;font-size:12px;font-weight:750;letter-spacing:0.12em;text-transform:uppercase;color:#316bff;">YOVA waitlist</div>
                <h1 style="margin:0 0 12px;font-family:Sora,Inter,Arial,sans-serif;font-size:32px;line-height:1.16;letter-spacing:-0.04em;color:#08152f;">Confirm your place</h1>
                <p style="margin:0 0 26px;font-size:16px;line-height:1.65;color:#52617f;">Open the private page below, then select <strong>Confirm my place</strong>. Opening the link alone will not join the waitlist.</p>
                <a href="${safeConfirmationUrl}" style="display:inline-block;padding:14px 20px;background:#316bff;border-radius:12px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:750;box-shadow:0 10px 24px rgba(49,107,255,0.22);">Open confirmation page</a>
                <p style="margin:26px 0 0;font-size:13px;line-height:1.65;color:#66758f;">This link expires in 24 hours. If you did not request this, you can ignore this email.</p>
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
      if (typeof payload.id === "string" && payload.id.length <= 200) {
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

export async function sendStudyProfileWaitlistConfirmationEmail(
  input: StudyProfileWaitlistConfirmationEmailInput,
): Promise<StudyProfileEmailDeliveryResult> {
  const parsed = StudyProfileWaitlistConfirmationEmailInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "failed", reason: "invalid_input" };
  }

  if (process.env.YOVA_E2E === "1") {
    return { status: "sent", provider: "resend" };
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.STUDY_PROFILE_FROM_EMAIL?.trim();
  if (!apiKey || !from) {
    return { status: "skipped", reason: "not_configured" };
  }

  const replyTo = process.env.STUDY_PROFILE_REPLY_TO?.trim();
  const message = buildStudyProfileWaitlistConfirmationEmail(parsed.data);
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
        "Idempotency-Key": `study-profile-waitlist-confirmation/${parsed.data.confirmationId}`,
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
      if (typeof payload.id === "string" && payload.id.length <= 200) {
        providerMessageId = payload.id;
      }
    } catch {
      // A successful provider status is authoritative without an optional ID.
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
