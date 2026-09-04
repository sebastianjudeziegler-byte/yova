import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  consumeAIRequestClaimAfterProviderFailure,
  readAIUsageStatus,
  refundAIRequestClaimBeforeProvider,
  refundAIRequestReservationBeforeProvider,
  reserveAIRequest,
} from "@/lib/server/ai-usage";

type LegacyAction =
  | "plan_generation"
  | "session_generation"
  | "lesson_generation"
  | "answer_evaluation"
  | "tutor_message"
  | "teaching_visual";

type StrictReservationAction = LegacyAction
  | "plan_adjustment"
  | "intake_interpretation"
  | "material_processing";

describe("AI usage action API surface", () => {
  it("exposes new cost controls only through strict operation reservations", () => {
    expectTypeOf<Parameters<typeof reserveAIRequest>[1]>()
      .toEqualTypeOf<StrictReservationAction>();
    expectTypeOf<Parameters<typeof refundAIRequestReservationBeforeProvider>[1]>()
      .toEqualTypeOf<StrictReservationAction>();
    expectTypeOf<Parameters<typeof readAIUsageStatus>[1]>()
      .toEqualTypeOf<LegacyAction>();
    expectTypeOf<Parameters<typeof consumeAIRequestClaimAfterProviderFailure>>()
      .toEqualTypeOf<Parameters<typeof refundAIRequestClaimBeforeProvider>>();
  });

  it("funnels every route-level material mapper through a durable material operation", () => {
    const workspace = process.cwd();
    const mapperSource = readFileSync(
      resolve(workspace, "src/lib/materials/material-understanding.ts"),
      "utf8",
    );
    expect(mapperSource).toContain('"material_processing",\n      input.materialId,');
    expect(mapperSource).toContain("settleAIRequestClaim(input.supabase, reservation.claimId)");
    expect(mapperSource).toContain("beforeProviderRequest");

    const apiRoot = resolve(workspace, "src/app/api");
    const routeSources = routeFiles(apiRoot).map((file) => ({
      file: relative(apiRoot, file),
      source: readFileSync(file, "utf8"),
    }));
    expect(routeSources.filter(({ source }) => (
      source.includes("mapMaterialText(")
      || source.includes("mapMaterialTextInternal(")
    ))).toEqual([]);
    expect(routeSources
      .filter(({ source }) => source.includes("mapAndPersistMaterialWithConsumedAIUsage("))
      .map(({ file }) => file))
      .toEqual(["materials/route.ts"]);

    for (const route of [
      "materials/link/route.ts",
      "materials/attach/route.ts",
      "plans/generate/route.ts",
    ]) {
      expect(routeSources.find(({ file }) => file === route)?.source)
        .toContain("mapAndPersistMaterial(");
    }
  });

  it("keeps paid provider failures consume-only and exact refunds at proven pre-provider boundaries", () => {
    const workspace = process.cwd();
    const aiUsageSource = readFileSync(
      resolve(workspace, "src/lib/server/ai-usage.ts"),
      "utf8",
    );
    const consumeFailureHelper = aiUsageSource.slice(
      aiUsageSource.indexOf("export async function consumeAIRequestClaimAfterProviderFailure"),
      aiUsageSource.indexOf("export async function refundAIRequestClaimBeforeProvider"),
    );
    expect(consumeFailureHelper).toContain("return settleAIRequestClaim(supabase, claimId)");

    const apiRoot = resolve(workspace, "src/app/api");
    const routeSources = routeFiles(apiRoot).map((file) => ({
      file: relative(apiRoot, file),
      source: readFileSync(file, "utf8"),
    }));

    expect(routeSources.filter(({ source }) => (
      source.includes("releaseAIRequestClaim(")
      || source.includes("releaseAIRequestReservation(")
    ))).toEqual([]);
    expect(routeSources
      .filter(({ source }) => source.includes("refundAIRequestClaimBeforeProvider("))
      .map(({ file }) => file)
      .sort())
      .toEqual(["materials/route.ts"]);

    for (const route of [
      "plans/[planId]/diagnostic/route.ts",
      "plans/generate/route.ts",
      "sessions/evaluate/route.ts",
      "sessions/generate/route.ts",
      "sessions/lesson/route.ts",
      "sessions/repair/route.ts",
      "teaching-visual/route.ts",
      "tutor/route.ts",
    ]) {
      expect(routeSources.find(({ file }) => file === route)?.source)
        .toContain("consumeAIRequestClaimAfterProviderFailure(");
    }
  });
});

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}
