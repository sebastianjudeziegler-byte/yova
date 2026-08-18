import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteArchivedPlan } from "@/lib/learning/plan-deletion";

const PLAN_ID = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("archived-plan deletion client", () => {
  it("sends exact same-origin proof and typed confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteArchivedPlan(PLAN_ID)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith("/api/plans/status", expect.objectContaining({
      method: "DELETE",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "X-Yova-Confirm": "delete-archived-plan",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ planId: PLAN_ID, confirmation: "DELETE" }),
    }));
  });

  it("surfaces bounded server copy without inventing success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "Only archived goals can be permanently deleted.",
    }), { status: 409, headers: { "Content-Type": "application/json" } })));

    await expect(deleteArchivedPlan(PLAN_ID)).rejects.toThrow("Only archived goals can be permanently deleted.");
  });
});
