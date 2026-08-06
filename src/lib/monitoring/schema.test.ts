import { describe, expect, it } from "vitest";
import { ErrorReportRequestSchema } from "@/lib/monitoring/schema";

describe("ErrorReportRequestSchema", () => {
  it("accepts a bounded technical error signal", () => {
    expect(ErrorReportRequestSchema.safeParse({
      surface: "route_boundary",
      errorCode: "route_render_failed",
      digest: "next-digest-123",
      requestId: "7f764e1d-3758-4eeb-b43e-12a01a19dcf9",
      routePath: "/learning/plan-123",
    }).success).toBe(true);
  });

  it("rejects raw messages, stack traces, and private context", () => {
    expect(ErrorReportRequestSchema.safeParse({
      surface: "tutor",
      errorCode: "tutor_request_failed",
      routePath: "/",
      message: "The learner asked a private question",
      stack: "Error at private source text",
    }).success).toBe(false);
  });

  it("rejects query strings and malformed error codes", () => {
    expect(ErrorReportRequestSchema.safeParse({
      surface: "cloud_sync",
      errorCode: "Cloud sync failed!",
      routePath: "/?private=learner-context",
    }).success).toBe(false);
    expect(ErrorReportRequestSchema.safeParse({
      surface: "route_boundary",
      errorCode: "route_render_failed",
      digest: "a raw error message does not belong here",
      routePath: "/",
    }).success).toBe(false);
  });
});
