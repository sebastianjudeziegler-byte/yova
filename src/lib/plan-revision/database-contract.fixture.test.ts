import { writeFileSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deltaFixture, DELTA_NOW, deltaTopicId, deterministicDeltaPlan } from "@/evals/personalization-delta-fixture";
import { buildPlanRevision } from "@/lib/plan-revision/build-plan-revision";
import { buildNormalPlanFallbackFill } from "@/lib/plan-generation/normal-plan-provider-fill";
import { commitPlanStudyRoutes } from "@/lib/study-route/activation";
import { sessionRevisionPatches } from "@/lib/plan-revision/revision-patch";

describe.skipIf(!process.env.YOVA_DB_FIXTURE_PATH)("actual routed persistence fixture for the isolated Actions database", () => {
  it("emits the reviewed fixed-slot plan, not a hand-written substitute route", async () => {
    const fixture = deltaFixture(1);
    const before = commitPlanStudyRoutes({ ...deterministicDeltaPlan(1), status: "active" as const }, DELTA_NOW.toISOString());
    const proposal = await buildPlanRevision({ ...fixture, plan: before,
      delta: { operations: [{ op: "mark_covered", topic_id: deltaTopicId(4) }] },
      controls: { excludedOperationIndexes: [], sessionEdits: [] }, protections: [], otherReservations: [], contextKind: "active",
      fill: async input => buildNormalPlanFallbackFill(input),
    });
    expect(proposal.canApply).toBe(true);
    const after = commitPlanStudyRoutes(proposal.after, DELTA_NOW.toISOString());
    const patches = sessionRevisionPatches(before, after);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.after!.learningMode).toBe("study");
    const sql = readFileSync("supabase/tests/fixtures/living-plan-routed.sql.template", "utf8");
    const data = JSON.stringify({ before, after, proposal, request: fixture.request, changedId: patches[0]!.id }).replaceAll("'", "''");
    writeFileSync(process.env.YOVA_DB_FIXTURE_PATH!, sql.replace("'__FIXTURE__'::jsonb", `'${data}'::jsonb`));
  });
});
