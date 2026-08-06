import { describe, expect, it } from "vitest";
import { SupportRequestSchema } from "@/lib/support/schema";

describe("SupportRequestSchema", () => {
  it("accepts a bounded private-alpha support request", () => {
    expect(SupportRequestSchema.safeParse({
      category: "session",
      subject: "My session would not open",
      message: "The loading screen remained visible after I selected Start session.",
    }).success).toBe(true);
  });

  it("rejects unsupported categories and hidden extra fields", () => {
    expect(SupportRequestSchema.safeParse({
      category: "urgent_admin",
      subject: "Please change this",
      message: "This category should not be accepted by the API.",
      status: "resolved",
    }).success).toBe(false);
  });

  it("rejects empty and unbounded messages", () => {
    expect(SupportRequestSchema.safeParse({
      category: "other",
      subject: "Short",
      message: "Too short",
    }).success).toBe(false);
    expect(SupportRequestSchema.safeParse({
      category: "other",
      subject: "Long message",
      message: "x".repeat(4_001),
    }).success).toBe(false);
  });
});
