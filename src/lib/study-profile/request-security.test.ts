import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  readStudyProfileBoundedJson,
  validateStudyProfileJsonPostRequest,
} from "@/lib/study-profile/request-security";

describe("validateStudyProfileJsonPostRequest", () => {
  it("accepts same-origin JSON in local and Playwright-style environments", () => {
    const request = new Request("http://127.0.0.1:3100/api/study-profile/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Origin: "http://127.0.0.1:3100",
        "Sec-Fetch-Site": "same-origin",
      },
      body: "{}",
    });

    expect(validateStudyProfileJsonPostRequest(request)).toEqual({ ok: true });
  });

  it("accepts the browser-facing Host origin when Next exposes an internal URL", () => {
    const request = new Request("http://localhost:3101/api/study-profile/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "127.0.0.1:3101",
        Origin: "http://127.0.0.1:3101",
        "Sec-Fetch-Site": "same-origin",
      },
      body: "{}",
    });

    expect(validateStudyProfileJsonPostRequest(request)).toEqual({ ok: true });
  });

  it("rejects cross-origin and simple no-CORS browser writes", () => {
    const crossOrigin = new Request("https://www.yovaapp.com/api/study-profile/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
      },
      body: "{}",
    });
    const simpleWrite = new Request("https://www.yovaapp.com/api/study-profile/responses", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Origin: "https://attacker.example",
      },
      body: "{}",
    });

    expect(validateStudyProfileJsonPostRequest(crossOrigin)).toMatchObject({ ok: false, status: 403 });
    expect(validateStudyProfileJsonPostRequest(simpleWrite)).toMatchObject({ ok: false, status: 415 });
  });

  it("allows JSON from non-browser server tools without an Origin header", () => {
    const request = new Request("https://www.yovaapp.com/api/study-profile/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(validateStudyProfileJsonPostRequest(request)).toEqual({ ok: true });
  });
});

describe("readStudyProfileBoundedJson", () => {
  it("parses a body at the actual byte limit", async () => {
    const body = JSON.stringify({ ok: true });
    const request = new Request("https://www.yovaapp.com/api/study-profile/events", {
      method: "POST",
      body,
    });

    await expect(readStudyProfileBoundedJson(request, new TextEncoder().encode(body).byteLength))
      .resolves.toEqual({ ok: true, value: { ok: true } });
  });

  it("rejects streamed bytes over the limit even without a trustworthy Content-Length", async () => {
    const body = JSON.stringify({ value: "x".repeat(64) });
    const request = new Request("https://www.yovaapp.com/api/study-profile/events", {
      method: "POST",
      headers: { "Content-Length": "2" },
      body,
    });

    await expect(readStudyProfileBoundedJson(request, 16)).resolves.toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("rejects malformed JSON", async () => {
    const request = new Request("https://www.yovaapp.com/api/study-profile/events", {
      method: "POST",
      body: "not json",
    });

    await expect(readStudyProfileBoundedJson(request, 128)).resolves.toEqual({
      ok: false,
      reason: "invalid_json",
    });
  });
});
