import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  probeSignedInGenerationDatabase,
  SIGNED_IN_GENERATION_CONTRACT_VERSION,
} from "../../../scripts/readiness-capability-probe.mjs";

describe("signed-in generation release capability probe", () => {
  it("accepts only the current complete database contract", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      contractVersion: SIGNED_IN_GENERATION_CONTRACT_VERSION,
      ready: true,
      studyRoutesSchema: true,
      planSessionsRoutePointer: true,
      requiredRouteRpcs: true,
      expandedMethodAgencyBoundary: true,
    }));

    await expect(probeSignedInGenerationDatabase({
      supabaseUrl: "https://project.supabase.co/",
      supabaseSecretKey: "server-secret-value",
      fetchImpl,
    })).resolves.toEqual({
      passed: true,
      detail: expect.stringContaining(SIGNED_IN_GENERATION_CONTRACT_VERSION),
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://project.supabase.co/rest/v1/rpc/signed_in_generation_readiness_v2",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        cache: "no-store",
        headers: expect.objectContaining({
          apikey: "server-secret-value",
          "User-Agent": "YOVA-release-readiness/1.0",
        }),
      }),
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Authorization");
  });

  it("fails closed when the readiness migration is absent", async () => {
    const result = await probeSignedInGenerationDatabase({
      supabaseUrl: "https://project.supabase.co",
      supabaseSecretKey: "server-secret-value",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(
        { code: "PGRST202", message: "function was not found" },
        404,
      )),
    });

    expect(result).toEqual({
      passed: false,
      detail: expect.stringContaining(`migration ${SIGNED_IN_GENERATION_CONTRACT_VERSION}`),
    });
  });

  it("uses a Bearer header only for a legacy service-role JWT", async () => {
    const legacyKey = "header.payload.signature";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      contractVersion: SIGNED_IN_GENERATION_CONTRACT_VERSION,
      ready: true,
      studyRoutesSchema: true,
      planSessionsRoutePointer: true,
      requiredRouteRpcs: true,
      expandedMethodAgencyBoundary: true,
    }));

    await probeSignedInGenerationDatabase({
      supabaseUrl: "https://project.supabase.co",
      supabaseSecretKey: legacyKey,
      fetchImpl,
    });

    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      apikey: legacyKey,
      Authorization: `Bearer ${legacyKey}`,
    });
  });

  it("rejects stale and partial capability responses", async () => {
    const stale = await probeSignedInGenerationDatabase({
      supabaseUrl: "https://project.supabase.co",
      supabaseSecretKey: "server-secret-value",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        contractVersion: "202608230001",
        ready: true,
      })),
    });
    expect(stale).toEqual({
      passed: false,
      detail: "database readiness contract is stale for this application release",
    });

    const partial = await probeSignedInGenerationDatabase({
      supabaseUrl: "https://project.supabase.co",
      supabaseSecretKey: "server-secret-value",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        contractVersion: SIGNED_IN_GENERATION_CONTRACT_VERSION,
        ready: false,
        studyRoutesSchema: false,
        planSessionsRoutePointer: true,
        requiredRouteRpcs: false,
        expandedMethodAgencyBoundary: false,
      })),
    });
    expect(partial.passed).toBe(false);
    expect(partial.detail).toContain("StudyRoute table/columns");
    expect(partial.detail).toContain("StudyRoute activation/cache RPCs");
    expect(partial.detail).toContain("expanded-method agency RPC boundary");

    const contradictory = await probeSignedInGenerationDatabase({
      supabaseUrl: "https://project.supabase.co",
      supabaseSecretKey: "server-secret-value",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        contractVersion: SIGNED_IN_GENERATION_CONTRACT_VERSION,
        ready: true,
        studyRoutesSchema: false,
        planSessionsRoutePointer: true,
        requiredRouteRpcs: true,
        expandedMethodAgencyBoundary: true,
      })),
    });
    expect(contradictory.passed).toBe(false);
    expect(contradictory.detail).toContain("StudyRoute table/columns");
  });

  it("treats unreachable or malformed targets as unavailable without exposing the key", async () => {
    const secret = "do-not-print-this-secret";
    const unreachable = await probeSignedInGenerationDatabase({
      supabaseUrl: "https://project.supabase.co",
      supabaseSecretKey: secret,
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error(secret)),
    });
    expect(unreachable.passed).toBe(false);
    expect(unreachable.detail).not.toContain(secret);

    const malformed = await probeSignedInGenerationDatabase({
      supabaseUrl: "https://project.supabase.co",
      supabaseSecretKey: secret,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([true])),
    });
    expect(malformed).toEqual({
      passed: false,
      detail: "database capability probe returned an invalid response",
    });
  });
});

describe("signed-in generation readiness migration", () => {
  const baseMigration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/202608300001_signed_in_generation_readiness.sql"),
    "utf8",
  ).toLowerCase();
  const currentMigration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/202608300003_expanded_method_agency_boundary.sql"),
    "utf8",
  ).toLowerCase();

  it("is read-only, service-only, and verifies every release-critical StudyRoute boundary", () => {
    expect(baseMigration).toContain("create or replace function public.signed_in_generation_readiness_v1()");
    expect(baseMigration).toContain("language plpgsql\nstable\nsecurity definer");
    expect(baseMigration).toContain("auth.role() is distinct from 'service_role'");
    expect(baseMigration).toContain("pg_catalog.has_table_privilege(");
    expect(baseMigration).toContain("pg_catalog.has_function_privilege(");
    expect(baseMigration).toContain("grant execute on function public.signed_in_generation_readiness_v1()\nto service_role");
    expect(baseMigration).not.toMatch(/\b(?:insert|update|delete|truncate)\s+(?:from\s+|into\s+)?public\./u);

    for (const capability of [
      "public.study_routes",
      "committed_route_revision_id",
      "public.commit_study_route_revision(jsonb)",
      "public.mint_plan_activation_permit_v1(jsonb,uuid,timestamptz)",
      "public.save_generated_plan_with_routes(jsonb,uuid)",
      "public.cache_generated_session(jsonb)",
    ]) {
      expect(baseMigration).toContain(capability);
    }

    expect(currentMigration).toContain(
      "create or replace function public.signed_in_generation_readiness_v2()",
    );
    expect(currentMigration).toContain("'contractversion', '202608300003'");
    expect(currentMigration).toContain("'expandedmethodagencyboundary'");
    expect(currentMigration).toContain(
      "grant execute on function public.signed_in_generation_readiness_v2()\n"
      + "to service_role",
    );
    const readinessStart = currentMigration.indexOf(
      "create or replace function public.signed_in_generation_readiness_v2()",
    );
    const readinessEnd = currentMigration.indexOf(
      "revoke all on function public.signed_in_generation_readiness_v2()",
      readinessStart,
    );
    expect(readinessStart).toBeGreaterThan(-1);
    expect(readinessEnd).toBeGreaterThan(readinessStart);
    expect(currentMigration.slice(readinessStart, readinessEnd)).not.toMatch(
      /\b(?:insert|update|delete|truncate)\s+(?:from\s+|into\s+)?public\./u,
    );
  });

  it("has a real PostgreSQL gate for service-only access and the complete response", () => {
    const databaseTest = readFileSync(
      resolve(
        process.cwd(),
        "supabase/tests/database/20260830_signed_in_generation_readiness.test.sql",
      ),
      "utf8",
    ).toLowerCase();

    expect(databaseTest.trimStart().startsWith("begin;")).toBe(true);
    expect(databaseTest).toContain("select extensions.plan(5);");
    expect(databaseTest).toContain("public.signed_in_generation_readiness_v1()");
    expect(databaseTest).toContain("'request.jwt.claim.role'");
    expect(databaseTest).toContain("'service_role'");
    expect(databaseTest).toContain("'authenticated'");
    expect(databaseTest).toContain("'ready', true");
    expect(databaseTest.trimEnd().endsWith("rollback;")).toBe(true);

    const expandedDatabaseTest = readFileSync(
      resolve(
        process.cwd(),
        "supabase/tests/database/20260830_expanded_method_agency_boundary.test.sql",
      ),
      "utf8",
    ).toLowerCase();
    expect(expandedDatabaseTest).toContain("public.signed_in_generation_readiness_v2()");
    expect(expandedDatabaseTest).toContain("'expandedmethodagencyboundary', true");
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
