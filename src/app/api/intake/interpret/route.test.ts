import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const CLAIM_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  developmentPreview: vi.fn(),
  supabaseConfigured: vi.fn(),
  openAIConfigured: vi.fn(),
  interpret: vi.fn(),
  reserve: vi.fn(),
  settle: vi.fn(),
  release: vi.fn(),
  recover: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: mocks.supabaseConfigured,
}));
vi.mock("@/lib/server/development-preview", () => ({
  isDevelopmentPreviewRequest: mocks.developmentPreview,
}));
vi.mock("@/lib/openai/config", () => ({
  isOpenAISessionConfigured: mocks.openAIConfigured,
}));
vi.mock("@/lib/openai/intake-interpreter", () => ({
  interpretIntakeWithOpenAI: mocks.interpret,
}));
vi.mock("@/lib/server/ai-usage", () => ({
  reserveAIRequest: mocks.reserve,
  settleAIRequestClaim: mocks.settle,
  refundAIRequestClaimBeforeProvider: mocks.release,
  refundAIRequestReservationBeforeProvider: mocks.recover,
}));

import { POST } from "@/app/api/intake/interpret/route";

describe("intake interpretation AI allowance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.developmentPreview.mockReturnValue(false);
    mocks.supabaseConfigured.mockReturnValue(true);
    mocks.openAIConfigured.mockReturnValue(true);
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
    mocks.reserve.mockResolvedValue({
      allowed: true,
      claimId: CLAIM_ID,
      operationKey: OPERATION_ID,
      reservationState: "reserved",
      replayed: false,
      retryAfterSeconds: 0,
      remainingToday: 10,
    });
    mocks.settle.mockResolvedValue(true);
    mocks.release.mockResolvedValue(true);
    mocks.recover.mockResolvedValue(false);
    mocks.interpret.mockResolvedValue({
      title: "Cell respiration review",
      objective: "Explain the stages of cell respiration accurately.",
      itemType: "topic",
      dueAt: null,
      scope: "Glycolysis, the Krebs cycle, and oxidative phosphorylation",
      progress: "Has reviewed glycolysis",
      requestedMinutes: 30,
      materialsSummary: "No materials attached.",
      missingFields: [],
    });
  });

  it("reserves before provider work and settles the exact successful claim", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-yova-request-id")).toBe(OPERATION_ID);
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.anything(),
      "intake_interpretation",
      OPERATION_ID,
      expect.any(String),
    );
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.settle.mock.invocationCallOrder[0],
    );
    expect(mocks.settle.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.interpret.mock.invocationCallOrder[0],
    );
    expect(mocks.settle).toHaveBeenCalledWith(expect.anything(), CLAIM_ID);
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("uses the deterministic interpretation without provider work when quota is exhausted", async () => {
    mocks.reserve.mockResolvedValueOnce({
      allowed: false,
      claimId: null,
      operationKey: OPERATION_ID,
      denialReason: "usage_limit",
      retryAfterSeconds: 60,
      remainingToday: 0,
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.interpretation.title).toMatch(/cell respiration/i);
    expect(mocks.interpret).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("keeps a provider-attempted reservation consumed when provider work fails", async () => {
    mocks.interpret.mockRejectedValueOnce(new Error("provider unavailable"));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.settle).toHaveBeenCalledWith(expect.anything(), CLAIM_ID);
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("fails closed before provider work when claim consumption cannot be confirmed", async () => {
    mocks.settle.mockRejectedValueOnce(new Error("settlement receipt unavailable"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.interpret).not.toHaveBeenCalled();
    expect(mocks.recover).toHaveBeenCalledWith(
      expect.anything(),
      "intake_interpretation",
      OPERATION_ID,
      expect.any(String),
    );
    errorLog.mockRestore();
  });

  it("does not contact the provider in development preview", async () => {
    mocks.developmentPreview.mockReturnValueOnce(true);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.interpret).not.toHaveBeenCalled();
  });
});

function request() {
  return new Request("https://yova.example/api/intake/interpret", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Yova-Request-Id": OPERATION_ID,
    },
    body: JSON.stringify({
      description: "Review cell respiration for 30 minutes; I have covered glycolysis.",
      materialNames: [],
      timeZone: "Europe/London",
    }),
  });
}
