import { describe, expect, it, vi } from "vitest";
import { ShapeSlotGenerationError } from "@/lib/openai/shape-slot-generator";
import { SHAPE_SLOT_HONEST_ERROR } from "@/lib/session-shapes/slots-schema";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => false }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => { throw new Error("not configured"); } }));
vi.mock("@/lib/server/development-preview", () => ({ isDevelopmentPreviewRequest: () => true }));
vi.mock("@/lib/openai/client", () => ({ getOpenAIClient: () => { throw new Error("unused"); } }));
vi.mock("@/lib/openai/config", () => ({ getOpenAISessionConfig: () => null }));

const { handleShapeSlotRequest, shapeSlotUsageAction } = await import("./shape-slot-handler");

const base = {
  requestId: "11111111-1111-4111-8111-111111111111",
  recoveryKey: "22222222-2222-4222-8222-222222222222",
  planId: "33333333-3333-4333-8333-333333333333",
  planSessionId: "44444444-4444-4444-8444-444444444444",
  topic: { id: "55555555-5555-4555-8555-555555555555", title: "Glycolysis", description: "How glucose becomes pyruvate.", subtopics: [], taskType: "conceptual_learning" },
  modifiers: { instructionStyle: "standard", weighting: "relationships_first", produceStep: "typed_explanation", explanationFocus: "concept", questionCap: 8 },
};

function post(body: unknown, ip = "10.0.0.1") {
  return new Request("http://localhost/api/sessions/shape", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

describe("shape slot handler", () => {
  it("rejects malformed and unknown requests before touching the provider", async () => {
    const provider = vi.fn();
    expect((await handleShapeSlotRequest(post("{not json"), { provider: provider as never })).status).toBe(400);
    expect((await handleShapeSlotRequest(post({ ...base, action: "learn_block", extra: 1 }), { provider: provider as never })).status).toBe(422);
    expect(provider).not.toHaveBeenCalled();
  });

  it("is honest when the provider is not configured, except Slot 1 which templates", async () => {
    const learn = await handleShapeSlotRequest(post({ ...base, action: "learn_block" }), { provider: null });
    expect(learn.status).toBe(503);
    expect(await learn.json()).toEqual({ error: SHAPE_SLOT_HONEST_ERROR, code: "provider_unavailable" });
    const direction = await handleShapeSlotRequest(post({ ...base, action: "direction", source: { name: "Unit 3 slides", kind: "slides", location: null }, entry: "study_full" }), { provider: null });
    expect(direction.status).toBe(200);
    expect(await direction.json()).toMatchObject({ action: "direction", origin: "template" });
  });

  it("returns the filled slot with the request id", async () => {
    const provider = vi.fn(async () => ({ feedback: "You named the products; NADH is missing.", missing: ["NADH"], incorrect: [] }));
    const response = await handleShapeSlotRequest(post({ ...base, action: "compare", produced: "Glucose becomes pyruvate.", reference: { excerpts: [], keyPoints: [] } }), { provider: provider as never });
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Yova-Request-Id")).toBe(base.requestId);
    expect(await response.json()).toEqual({ action: "compare", feedback: "You named the products; NADH is missing.", missing: ["NADH"], incorrect: [] });
  });

  it("reports a generation failure honestly with the attempt count", async () => {
    const provider = vi.fn(async () => { throw new Error("provider down"); });
    const response = await handleShapeSlotRequest(post({ ...base, action: "learn_block" }), { provider: provider as never });
    expect(response.status).toBe(502);
    expect(response.headers.get("X-Yova-Slot-Attempts")).toBe("2");
    expect(await response.json()).toEqual({ error: SHAPE_SLOT_HONEST_ERROR, code: "generation_failed" });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("rate-limits repeated requests from one caller", async () => {
    const provider = vi.fn(async () => ({ feedback: "Feedback that names one missing idea for the learner.", missing: [], incorrect: [] }));
    let limited: Response | null = null;
    for (let attempt = 0; attempt < 20 && !limited; attempt += 1) {
      const response = await handleShapeSlotRequest(post({ ...base, action: "compare", produced: "x", reference: { excerpts: [], keyPoints: [] } }, "10.0.0.9"), { provider: provider as never });
      if (response.status === 429) limited = response;
    }
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("Retry-After")).toMatch(/^\d+$/);
  });

  it("bills comparison as evaluation and the other slots as lesson work", () => {
    expect(shapeSlotUsageAction({ action: "compare" })).toBe("answer_evaluation");
    expect(shapeSlotUsageAction({ action: "learn_block" })).toBe("lesson_generation");
    expect(shapeSlotUsageAction({ action: "practice" })).toBe("lesson_generation");
    expect(new ShapeSlotGenerationError("generation_failed", 2).message).toBe(SHAPE_SLOT_HONEST_ERROR);
  });
});
