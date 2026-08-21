import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createVisual: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
  releaseOperation: vi.fn(),
  settle: vi.fn(),
}));

vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { create: mocks.createVisual } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAISessionConfig: () => ({ model: "visual-model" }),
}));
vi.mock("@/lib/server/ai-usage", () => ({
  reserveAIRequest: mocks.reserve,
  releaseAIRequestClaim: mocks.release,
  releaseAIRequestReservation: mocks.releaseOperation,
  settleAIRequestClaim: mocks.settle,
}));
vi.mock("@/lib/server/development-preview", () => ({
  isDevelopmentPreviewRequest: () => false,
}));
vi.mock("@/lib/server/rate-limit", () => ({
  checkSessionGenerationRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
  requestRateLimitKey: () => "route-test",
}));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));

import { POST } from "@/app/api/teaching-visual/route";

const CLAIM_ID = "55555555-5555-4555-8555-555555555555";

describe("teaching visual allowance lifecycle", () => {
  beforeEach(() => {
    mocks.createClient.mockReset().mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "44444444-4444-4444-8444-444444444444" } },
          error: null,
        }),
      },
    });
    mocks.reserve.mockReset().mockResolvedValue({
      allowed: true,
      claimId: CLAIM_ID,
      retryAfterSeconds: 0,
      remainingToday: 9,
    });
    mocks.release.mockReset().mockResolvedValue(true);
    mocks.releaseOperation.mockReset().mockResolvedValue(false);
    mocks.settle.mockReset().mockResolvedValue(true);
    mocks.createVisual.mockReset().mockResolvedValue({
      output: [{ type: "image_generation_call", result: "d2VicA==" }],
    });
  });

  it("settles only after a usable image result exists", async () => {
    const response = await POST(visualRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      imageDataUrl: "data:image/webp;base64,d2VicA==",
    });
    expect(mocks.settle).toHaveBeenCalledWith(expect.anything(), CLAIM_ID);
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("releases the exact reservation when the provider returns no image", async () => {
    mocks.createVisual.mockResolvedValueOnce({ output: [] });

    const response = await POST(visualRequest());

    expect(response.status).toBe(503);
    expect(mocks.release).toHaveBeenCalledWith(expect.anything(), CLAIM_ID);
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("returns a usable image when settlement cannot be confirmed", async () => {
    mocks.settle.mockRejectedValueOnce(new Error("settlement receipt lost"));

    const response = await POST(visualRequest());

    expect(response.status).toBe(200);
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("does not start image generation for a live operation-key replay", async () => {
    mocks.reserve.mockResolvedValueOnce({
      allowed: false,
      claimId: null,
      operationKey: "22222222-2222-4222-8222-222222222222",
      denialReason: "operation_in_progress",
      retryAfterSeconds: 29,
      remainingToday: 2,
    });

    const response = await POST(visualRequest());

    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("29");
    await expect(response.json()).resolves.toMatchObject({
      code: "ai_operation_in_progress",
      retryable: true,
    });
    expect(mocks.createVisual).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });
});

function visualRequest() {
  return new Request("https://yova.example/api/teaching-visual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "The electron transport chain",
      keyIdea: "A proton gradient couples electron transfer to ATP production.",
      explanation: "Electrons move through membrane complexes while protons accumulate across the membrane, and ATP synthase uses that gradient.",
    }),
  });
}
