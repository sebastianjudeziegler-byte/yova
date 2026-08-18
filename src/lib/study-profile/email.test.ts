import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  STUDY_PROFILE_EMAIL_REQUEST_TIMEOUT_MS,
  buildStudyProfileReportEmail,
  sendStudyProfileReportEmail,
} from "@/lib/study-profile/email";

const input = {
  to: "student@example.com",
  reportUrl: "https://www.yovaapp.com/study-profile/report/private_token_12345678901234567890",
  primaryPatternName: "Starting Friction",
  primaryPatternLabel: "High",
  responseId: "3f4edc20-e169-4f7f-b2c3-2a1a683b74e9",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("buildStudyProfileReportEmail", () => {
  it("escapes personalized HTML and includes a plain-text private link", () => {
    const message = buildStudyProfileReportEmail({
      reportUrl: "https://www.yovaapp.com/study-profile/report/private_token?from=email&safe=true",
      primaryPatternName: "Starting <script>alert(1)</script>",
      primaryPatternLabel: 'High "confidence"',
    });

    expect(message.subject).toBe("Your YOVA Study Profile is ready");
    expect(message.html).not.toContain("<script>alert(1)</script>");
    expect(message.html).toContain("Starting &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(message.html).toContain("from=email&amp;safe=true");
    expect(message.text).toContain("View My Study Profile: https://www.yovaapp.com/");
  });
});

describe("sendStudyProfileReportEmail", () => {
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
      to: "student@example.com",
      reply_to: "hello@yovaapp.com",
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
