import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningPlan } from "@/lib/domain";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";

const mocks = vi.hoisted(() => ({
  isSupabaseConfigured: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

import {
  persistPlanForAuthenticatedUser,
  PlanPersistenceError,
} from "@/lib/supabase/plan-repository";

const plan = {
  id: "7e9ebf11-61b6-40cf-8519-b0870288d115",
  learningItemId: "9e528f4c-c207-41a4-824b-e9d34a042f62",
  status: "active",
} as LearningPlan;

const generationRequest = {
  intent: "plan",
  learningIntent: "learn",
  goal: "Understand photosynthesis for a biology test",
  materialMode: "none",
  materials: [],
  studyMode: "inside",
  deadline: null,
  timeZone: "America/Los_Angeles",
  diagnosticResponses: [],
  availability: [],
  profileSummary: "The learner prefers direct explanations and short sessions.",
} as PlanGenerationRequest;

const activationPermitId = "3dd7abce-dd49-42c4-8961-a8cbb5310171";
const draftReceiptIssuedAt = "2026-08-24T10:00:00.000Z";

function authenticatedClient() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
    rpc: vi.fn().mockResolvedValue({ error: { message: "duplicate key" } }),
    from: vi.fn(),
  };
}

describe("plan persistence retries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isSupabaseConfigured.mockReturnValue(true);
    mocks.createSupabaseAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: activationPermitId, error: null }),
    });
  });

  it("mints server-side authority for the exact payload used by the cookie-auth writer", async () => {
    const client = authenticatedClient();
    client.rpc.mockResolvedValue({ error: null });
    mocks.createSupabaseServerClient.mockResolvedValue(client);
    const admin = mocks.createSupabaseAdminClient();

    await expect(
      persistPlanForAuthenticatedUser(plan, generationRequest, draftReceiptIssuedAt),
    ).resolves.toBe("supabase");

    expect(admin.rpc).toHaveBeenCalledWith("mint_plan_activation_permit_v1", {
      payload: expect.any(Object),
      requested_user_id: "user-1",
      draft_receipt_issued_at: draftReceiptIssuedAt,
    });
    expect(client.rpc).toHaveBeenCalledWith("save_generated_plan_with_routes", {
      payload: expect.any(Object),
      activation_permit_id: activationPermitId,
    });
    expect(admin.rpc.mock.calls[0]?.[1]?.payload).toBe(client.rpc.mock.calls[0]?.[1]?.payload);
  });

  it("fails closed before the authenticated writer when permit issuance is unavailable", async () => {
    const client = authenticatedClient();
    mocks.createSupabaseServerClient.mockResolvedValue(client);
    const admin = mocks.createSupabaseAdminClient();
    admin.rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });

    await expect(
      persistPlanForAuthenticatedUser(plan, generationRequest, draftReceiptIssuedAt),
    ).rejects.toBeInstanceOf(PlanPersistenceError);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("never treats shallow plan rows as authority after an ambiguous writer response", async () => {
    const client = authenticatedClient();
    mocks.createSupabaseServerClient.mockResolvedValue(client);

    await expect(
      persistPlanForAuthenticatedUser(plan, generationRequest, draftReceiptIssuedAt),
    ).rejects.toBeInstanceOf(PlanPersistenceError);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("persists the streamed architecture for an older mapped plan without a saved stamp", async () => {
    const mappedPlan = {
      ...plan,
      sessionArchitectureVersion: undefined,
      knowledgeMap: {
        version: 1,
        scopeJudgment: {
          band: "focused_skill",
          label: "Focused skill",
          minimumSessions: 1,
          recommendedSessions: 2,
          maximumSessions: 3,
          minimumTeachingSessions: 1,
          explanation: "A focused prerequisite sequence that can be taught and checked in a few sessions.",
        },
        topics: [{
          id: "00000000-0000-4000-8000-000000000021",
          title: "Carbon movement",
          description: "Trace how carbon enters and moves through the photosynthesis process.",
          subtopics: [],
          prerequisiteTopicIds: [],
          status: "not_started",
          initialEvidence: null,
          sourceReferences: [],
          origin: "ai_generated",
          deferred: null,
          curriculumReference: null,
        }],
        placementCheck: {
          status: "available",
          completedAt: null,
          demonstratedTopicIds: [],
          gapTopicIds: [],
        },
        curriculum: null,
      },
    } as LearningPlan;
    const client = authenticatedClient();
    client.rpc.mockResolvedValue({ error: null });
    mocks.createSupabaseServerClient.mockResolvedValue(client);

    await expect(
      persistPlanForAuthenticatedUser(mappedPlan, generationRequest, draftReceiptIssuedAt),
    ).resolves.toBe("supabase");
    expect(client.rpc).toHaveBeenCalledWith("save_generated_plan_with_routes", expect.objectContaining({
      payload: expect.objectContaining({
        generationInputs: expect.objectContaining({
          sessionArchitectureVersion: "streamed_teaching_v1",
        }),
      }),
      activation_permit_id: activationPermitId,
    }));
  });

  it("surfaces an expired staged source as a non-retryable rebuild condition", async () => {
    const client = authenticatedClient();
    client.rpc.mockResolvedValue({ error: { message: "material_staging_expired" } });
    mocks.createSupabaseServerClient.mockResolvedValue(client);

    await expect(
      persistPlanForAuthenticatedUser(plan, generationRequest, draftReceiptIssuedAt),
    ).rejects.toMatchObject({
      name: "PlanPersistenceError",
      code: "material_staging_expired",
    });
  });
});
