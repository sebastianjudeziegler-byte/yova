import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningPlan } from "@/lib/domain";
import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";

const mocks = vi.hoisted(() => ({
  isSupabaseConfigured: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
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

function clientWithExistingPlan(existingPlan: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: existingPlan, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
    rpc: vi.fn().mockResolvedValue({ error: { message: "duplicate key" } }),
    from: vi.fn().mockReturnValue(query),
  };
}

describe("plan persistence retries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isSupabaseConfigured.mockReturnValue(true);
  });

  it("treats the exact existing plan as a successful activation retry", async () => {
    const client = clientWithExistingPlan({
      id: plan.id,
      learning_item_id: plan.learningItemId,
      status: plan.status,
    });
    mocks.createSupabaseServerClient.mockResolvedValue(client);

    await expect(persistPlanForAuthenticatedUser(plan, generationRequest)).resolves.toBe("supabase");
    expect(client.from).toHaveBeenCalledWith("plans");
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
    const client = clientWithExistingPlan({
      id: mappedPlan.id,
      learning_item_id: mappedPlan.learningItemId,
      status: mappedPlan.status,
    });
    mocks.createSupabaseServerClient.mockResolvedValue(client);

    await expect(persistPlanForAuthenticatedUser(mappedPlan, generationRequest)).resolves.toBe("supabase");
    expect(client.rpc).toHaveBeenCalledWith("save_generated_plan", expect.objectContaining({
      payload: expect.objectContaining({
        generationInputs: expect.objectContaining({
          sessionArchitectureVersion: "streamed_teaching_v1",
        }),
      }),
    }));
  });

  it("still fails when the existing row does not match the requested plan", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(clientWithExistingPlan({
      id: plan.id,
      learning_item_id: "2ccf4102-6fe2-4545-a225-2f67b22ec3b9",
      status: plan.status,
    }));

    await expect(persistPlanForAuthenticatedUser(plan, generationRequest)).rejects.toBeInstanceOf(PlanPersistenceError);
  });
});
