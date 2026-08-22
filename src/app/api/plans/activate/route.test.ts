import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  persist: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/supabase/plan-repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/supabase/plan-repository")>();
  return { ...original, persistPlanForAuthenticatedUser: mocks.persist };
});

import { POST } from "@/app/api/plans/activate/route";
import { PlanPersistenceError } from "@/lib/supabase/plan-repository";

const generationRequest = PlanGenerationRequestSchema.parse({
  intent: "study_now",
  learningIntent: "learn",
  goal: "Understand how the product rule differentiates two multiplied functions.",
  materialMode: "none",
  materials: [],
  studyMode: "inside",
  deadline: null,
  timeZone: "Europe/London",
  diagnosticResponses: [],
  availability: [{ day: "Friday", window: "Now", minutes: 25 }],
  profileSummary: "The learner prefers a concise explanation before independent practice.",
});

describe("plan activation staged-material boundary", () => {
  beforeEach(() => {
    mocks.createClient.mockReset().mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
    });
    mocks.persist.mockReset();
  });

  it("turns transaction-time staging expiry into a rebuild response", async () => {
    mocks.persist.mockRejectedValue(new PlanPersistenceError(
      "A pending source expired before the plan could be saved.",
      "material_staging_expired",
    ));
    const plan = generatePreviewPlan(generationRequest);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(new Request("https://yova.example/api/plans/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, generationRequest }),
    }));
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toMatchObject({ code: "material_staging_expired" });
    expect(body.error).toContain("Add that source again");
    errorLog.mockRestore();
  });
});
