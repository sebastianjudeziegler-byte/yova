import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  STUDY_PROFILE_EMAIL_REQUEST_TIMEOUT_MS,
  buildStudyProfileReportEmail,
  buildStudyProfileWaitlistConfirmationEmail,
  sendStudyProfileReportEmail,
  sendStudyProfileWaitlistConfirmationEmail,
} from "@/lib/study-profile/email";
import type {
  StudyProfileReportEmailInput,
  StudyProfileWaitlistConfirmationEmailInput,
} from "@/lib/study-profile/email";

const reportUrl = "https://www.yovaapp.com/study-profile/report/example-report-reference";
const input: StudyProfileReportEmailInput = {
  to: "recipient@example.test",
  reportUrl,
  pattern: {
    name: "The Drifter",
    tell: "You can start clean, then your attention leaks out of the session.",
  },
  why: "Two answers point to the same focus pattern, so shorter blocks and purposeful format changes should help.",
  matchedMethods: ["Teach-Back", "Timeboxing", "Interleaving"],
  tonightPlan: "Run one 20-minute block on a single topic, then stop at the planned finish.",
  responseId: "3f4edc20-e169-4f7f-b2c3-2a1a683b74e9",
};

const confirmationInput: StudyProfileWaitlistConfirmationEmailInput = {
  to: "recipient@example.test",
  confirmationUrl: `https://www.yovaapp.com/study-profile/waitlist/confirm#token=${"a".repeat(43)}`,
  confirmationId: "3f4edc20-e169-4f7f-b2c3-2a1a683b74e9",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("buildStudyProfileReportEmail", () => {
  it("builds a purely transactional named-pattern report email", () => {
    const message = buildStudyProfileReportEmail(input);

    expect(message.subject).toBe("Your study profile: The Drifter");
    expect(message.html).toContain(">The Drifter</h1>");
    expect(message.html).toContain(input.pattern.tell);
    expect(message.html).toContain(">Open my Study Profile</a>");
    expect(message.html).toContain("Why this pattern fits");
    expect(message.html).toContain(input.why);
    expect(message.html).toContain("Matched study methods");
    for (const method of input.matchedMethods) {
      expect(message.html).toContain(method);
      expect(message.text).toContain(method);
    }
    expect(message.html).toContain("Your plan for tonight");
    expect(message.html).toContain(input.tonightPlan);
    expect(message.html).toContain(`href="${reportUrl}"`);
    expect(message.text).toContain(`Open your private report: ${reportUrl}`);
    expect(message.text).toContain("If you did not request this report, you can ignore this email.");
    expect(message.html).toContain("If you did not request this report, you can ignore this email.");
    expect(message.text).not.toContain("waitlist");
    expect(message.html).not.toContain("join the waitlist");
  });

  it("escapes every personalized HTML field and URL query value", () => {
    const message = buildStudyProfileReportEmail({
      reportUrl: `${reportUrl}?from=email&safe=true`,
      pattern: {
        name: "The Drifter",
        tell: "Focus <script>alert(1)</script>",
      },
      why: 'The result says "pause" & check.',
      matchedMethods: ["Teach <Back>", "Timeboxing", "Interleaving"],
      tonightPlan: "Use one block, then check 'the result'.",
    });

    expect(message.html).not.toContain("<script>alert(1)</script>");
    expect(message.html).toContain("Focus &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(message.html).toContain("&quot;pause&quot; &amp; check.");
    expect(message.html).toContain("Teach &lt;Back&gt;");
    expect(message.html).toContain("check &#039;the result&#039;.");
    expect(message.html).toContain("from=email&amp;safe=true");
  });

  it("removes line breaks from the subject pattern name", () => {
    const message = buildStudyProfileReportEmail({
      ...input,
      pattern: {
        ...input.pattern,
        name: "The Drifter\r\nBcc: example@example.test",
      },
    });

    expect(message.subject).toBe(
      "Your study profile: The Drifter Bcc: example@example.test",
    );
  });
});

describe("sendStudyProfileReportEmail", () => {
  it("rejects incomplete matched-method content before delivery", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RESEND_API_KEY", "re_test_secret");
    vi.stubEnv("STUDY_PROFILE_FROM_EMAIL", "YOVA <study-profile@yovaapp.com>");

    await expect(sendStudyProfileReportEmail({
      ...input,
      matchedMethods: ["Teach-Back", "Timeboxing"],
    } as unknown as StudyProfileReportEmailInput)).resolves.toEqual({
      status: "failed",
      reason: "invalid_input",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips delivery cleanly when Resend is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("STUDY_PROFILE_FROM_EMAIL", "");

    await expect(sendStudyProfileReportEmail(input)).resolves.toEqual({
      status: "skipped",
      reason: "not_configured",
    });
  });

  it("uses an idempotency key and returns the provider message id", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_secret");
    vi.stubEnv("STUDY_PROFILE_FROM_EMAIL", "YOVA <study-profile@yovaapp.com>");
    vi.stubEnv("STUDY_PROFILE_REPLY_TO", "hello@yovaapp.com");
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: "email_123" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendStudyProfileReportEmail(input)).resolves.toEqual({
      status: "sent",
      provider: "resend",
      providerMessageId: "email_123",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.headers).toMatchObject({
      Authorization: "Bearer re_test_secret",
      "Idempotency-Key": `study-profile-report/${input.responseId}`,
    });
    expect(request.body).not.toContain("re_test_secret");
    expect(JSON.parse(String(request.body))).toMatchObject({
      to: "recipient@example.test",
      subject: "Your study profile: The Drifter",
      reply_to: "hello@yovaapp.com",
    });
  });

  it("drops a report provider id that cannot fit the database receipt", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_secret");
    vi.stubEnv("STUDY_PROFILE_FROM_EMAIL", "YOVA <study-profile@yovaapp.com>");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: "x".repeat(201) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));

    await expect(sendStudyProfileReportEmail(input)).resolves.toEqual({
      status: "sent",
      provider: "resend",
    });
  });

  it("aborts a stalled provider request after the delivery timeout", async () => {
    vi.useFakeTimers();
    vi.stubEnv("RESEND_API_KEY", "re_test_secret");
    vi.stubEnv("STUDY_PROFILE_FROM_EMAIL", "YOVA <study-profile@yovaapp.com>");
    const fetchMock = vi.fn((_url: string, request: RequestInit) => new Promise<Response>(
      (_resolve, reject) => {
        request.signal?.addEventListener("abort", () => {
          reject(new DOMException("Request timed out", "AbortError"));
        }, { once: true });
      },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const delivery = sendStudyProfileReportEmail(input);
    await vi.advanceTimersByTimeAsync(STUDY_PROFILE_EMAIL_REQUEST_TIMEOUT_MS);

    await expect(delivery).resolves.toEqual({
      status: "failed",
      reason: "network_error",
    });
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.signal?.aborted).toBe(true);
  });
});

describe("Study Profile waitlist confirmation email", () => {
  it("uses a fragment token and makes the confirmation button step explicit", () => {
    const message = buildStudyProfileWaitlistConfirmationEmail(confirmationInput);

    expect(message.subject).toBe("Confirm your place on the YOVA waitlist");
    expect(message.html).toContain(`href="${confirmationInput.confirmationUrl}"`);
    expect(message.text).toContain("Then select Confirm my place.");
    expect(message.text).toContain("Opening the link alone will not join the waitlist.");
    expect(message.text).toContain("expires in 24 hours");
    const url = new URL(confirmationInput.confirmationUrl);
    expect(url.search).toBe("");
    expect(url.hash).toMatch(/^#token=[A-Za-z0-9_-]{43}$/);
  });

  it("sends with a confirmation-id idempotency key", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_secret");
    vi.stubEnv("STUDY_PROFILE_FROM_EMAIL", "YOVA <study-profile@yovaapp.com>");
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: "email_confirmation_123" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendStudyProfileWaitlistConfirmationEmail(confirmationInput))
      .resolves.toEqual({
        status: "sent",
        provider: "resend",
        providerMessageId: "email_confirmation_123",
      });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.headers).toMatchObject({
      "Idempotency-Key": `study-profile-waitlist-confirmation/${confirmationInput.confirmationId}`,
    });
    expect(String((request.headers as Record<string, string>)["Idempotency-Key"]))
      .not.toContain("a".repeat(43));
  });

  it("drops a confirmation provider id that cannot fit the database receipt", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_secret");
    vi.stubEnv("STUDY_PROFILE_FROM_EMAIL", "YOVA <study-profile@yovaapp.com>");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: "x".repeat(201) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));

    await expect(sendStudyProfileWaitlistConfirmationEmail(confirmationInput))
      .resolves.toEqual({ status: "sent", provider: "resend" });
  });

  it("rejects a query-string token and never calls Resend", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_secret");
    vi.stubEnv("STUDY_PROFILE_FROM_EMAIL", "YOVA <study-profile@yovaapp.com>");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendStudyProfileWaitlistConfirmationEmail({
      ...confirmationInput,
      confirmationUrl: `https://www.yovaapp.com/study-profile/waitlist/confirm?token=${"a".repeat(43)}`,
    })).resolves.toEqual({ status: "failed", reason: "invalid_input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
