import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "202608230007_route_aware_plan_adjustment.sql";
const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const migration = readFileSync(resolve(migrationsDirectory, migrationName), "utf8");
const routeAwareFunction = migration.slice(migration.indexOf(
  "create or replace function public.adjust_learning_plan_with_routes(payload jsonb)",
));

describe("route-aware plan adjustment migration", () => {
  it("keeps retired route owners while preserving active sequence conflict semantics", () => {
    expect(migration).toContain(
      "drop constraint plan_sessions_plan_id_sequence_key",
    );
    expect(migration).toContain(
      "create unique index plan_sessions_active_sequence_key\n"
      + "on public.plan_sessions(plan_id, sequence)\n"
      + "where status <> 'skipped'",
    );
    expect(routeAwareFunction).not.toContain("delete from public.plan_sessions");
    expect(routeAwareFunction).toContain("status = 'skipped'");
    expect(routeAwareFunction).toContain("'routeAdjustmentRetiredAt', now()");
    expect(routeAwareFunction).toContain(
      "step_data = session.step_data || pg_catalog.jsonb_build_object(\n"
      + "      'routeAdjustmentOriginalSequence'",
    );
  });

  it("patches the mature completion writer to infer the exact partial index", () => {
    expect(migration).toContain(
      "pg_catalog.pg_get_functiondef(\n"
      + "    'public.complete_plan_session(jsonb)'::pg_catalog.regprocedure",
    );
    expect(migration).toContain(
      "E'and sequence = completed_session.sequence + 1\\n"
      + "        and id <> (follow_up ->> ''id'')::uuid',\n"
      + "    E'and sequence = completed_session.sequence + 1\\n"
      + "        and status <> ''skipped''\\n"
      + "        and id <> (follow_up ->> ''id'')::uuid'",
    );
    expect(migration).toContain(
      "'on conflict (plan_id, sequence) do nothing;',\n"
      + "    'on conflict (plan_id, sequence) where status <> ''skipped'' do nothing;'",
    );
    expect(migration).toContain(
      "if patched_completion_definition is not distinct from completion_definition\n"
      + "    or pg_catalog.strpos(",
    );
    expect(migration).toContain(
      "message = 'route_adjustment_completion_conflict_patch_missing'",
    );
    expect(migration).toContain(
      "pg_catalog.strpos(\n"
      + "      patched_completion_definition,",
    );
    expect(migration).toContain("execute patched_completion_definition;");
  });

  it("cuts authenticated adjustment callers over without exposing the legacy helper", () => {
    expect(migration).toContain(
      "alter function public.adjust_learning_plan(jsonb)\n"
      + "rename to adjust_learning_plan_without_study_routes",
    );
    expect(migration).toContain(
      "revoke all on function public.adjust_learning_plan_without_study_routes(jsonb)\n"
      + "from public, anon, authenticated",
    );
    expect(migration).toContain(
      "create or replace function public.adjust_learning_plan_with_routes(payload jsonb)",
    );
    expect(routeAwareFunction).toContain("security definer\nset search_path = ''");
    expect(routeAwareFunction).toContain(
      "revoke all on function public.adjust_learning_plan_with_routes(jsonb)\n"
      + "from public, anon, authenticated",
    );
    expect(routeAwareFunction).toContain(
      "grant execute on function public.adjust_learning_plan_with_routes(jsonb)\n"
      + "to authenticated",
    );
  });

  it("uses advisory, plan, then stable ordered-session locking", () => {
    const advisoryLock = routeAwareFunction.indexOf("pg_catalog.pg_advisory_xact_lock(");
    const planLock = routeAwareFunction.indexOf(
      "select plan.*\n  into requested_plan",
    );
    const orderedSessionLock = routeAwareFunction.indexOf(
      "order by session.sequence, session.id\n  for update",
    );

    expect(advisoryLock).toBeGreaterThan(-1);
    expect(planLock).toBeGreaterThan(advisoryLock);
    expect(orderedSessionLock).toBeGreaterThan(planLock);
  });

  it("requires all-or-zero route coverage and delegates route-free legacy plans", () => {
    expect(routeAwareFunction).toContain(
      "if current_route_count <> 0 and current_route_count <> current_session_count then",
    );
    expect(routeAwareFunction).toContain(
      "message = 'plan_adjustment_partial_route_coverage'",
    );
    expect(routeAwareFunction).toContain(
      "current_route_count > 0 and payload_route_count <> replacement_count",
    );
    expect(routeAwareFunction).toContain(
      "message = 'plan_adjustment_route_coverage_conflict'",
    );

    const legacyReturn = routeAwareFunction.indexOf(
      "return public.adjust_learning_plan_without_study_routes(payload);",
    );
    const firstRoutedMutation = routeAwareFunction.indexOf(
      "update public.learning_items as item",
    );
    expect(legacyReturn).toBeGreaterThan(-1);
    expect(firstRoutedMutation).toBeGreaterThan(legacyReturn);
  });

  it("protects reviews and durable session work before the first mutation", () => {
    const protectedGuard = routeAwareFunction.indexOf(
      "message = 'plan_adjustment_protected_review_conflict'",
    );
    const environmentGuard = routeAwareFunction.indexOf(
      "message = 'plan_adjustment_protected_environment_conflict'",
    );
    const savedWorkGuard = routeAwareFunction.indexOf(
      "message = 'plan_adjustment_saved_work_protected'",
    );
    const firstRoutedMutation = routeAwareFunction.indexOf(
      "update public.learning_items as item",
    );

    expect(protectedGuard).toBeGreaterThan(-1);
    expect(environmentGuard).toBeGreaterThan(protectedGuard);
    expect(savedWorkGuard).toBeGreaterThan(environmentGuard);
    expect(firstRoutedMutation).toBeGreaterThan(savedWorkGuard);
    expect(routeAwareFunction).toContain("session.step_data ? 'generatedSession'");
    expect(routeAwareFunction).toContain("session.step_data ? 'activeSessionCheckpoint'");
    expect(routeAwareFunction).toContain("event.event_type = 'session_interrupted'");
  });

  it("validates exact reused identities, material successors, and supported methods", () => {
    expect(routeAwareFunction).toContain(
      "pg_catalog.count(distinct (candidate.value ->> 'id')::uuid)",
    );
    expect(routeAwareFunction).toContain(
      "candidate.value #>> '{studyRoute,identity,routeRevisionId}'",
    );
    expect(routeAwareFunction).toContain(
      "perform public.validate_study_route_write_identity(\n"
      + "          requested_route,\n"
      + "          requested_plan.id,\n"
      + "          requested_session_id,\n"
      + "          existing_route_revision_id,\n"
      + "          false",
    );
    expect(migration).toContain(
      "create or replace function public.route_adjustment_material_projection_v1(",
    );
    expect(routeAwareFunction).toContain(
      "message = 'plan_adjustment_route_revision_not_material'",
    );
    expect(routeAwareFunction).toContain("'practice_test_error_repair'");
    expect(routeAwareFunction).toContain(
      "case requested_route #>> '{target,sourceRequirements,sourceType}'",
    );
    expect(routeAwareFunction).toContain(
      "when 'trusted_external_source' then 'yova_generated'",
    );
    expect(routeAwareFunction).toContain(
      "        end\n"
      + "      ) is distinct from current_source_mode",
    );
    expect(routeAwareFunction).not.toMatch(/\bor\s+case\b/i);
  });

  it("requires every new lineage to cite one exact same-plan committed origin", () => {
    expect(routeAwareFunction).toContain(
      "perform public.validate_study_route_write_identity(\n"
      + "        requested_route,\n"
      + "        requested_plan.id,\n"
      + "        requested_session_id,\n"
      + "        null,\n"
      + "        true",
    );
    expect(routeAwareFunction).toContain("where reference.value like 'route-revision:%'");
    expect(routeAwareFunction).toContain("if origin_reference_count <> 1 then");
    expect(routeAwareFunction).toContain(
      "session.committed_route_revision_id\n"
      + "            = origin_reference_revision_id",
    );
    expect(routeAwareFunction).toContain("session.plan_id = requested_plan.id");
    expect(routeAwareFunction).toContain(
      "message = 'plan_adjustment_origin_conflict'",
    );
  });

  it("writes each session and route atomically, then checks exact projections", () => {
    const sessionWrite = routeAwareFunction.indexOf("insert into public.plan_sessions (");
    const sessionProjection = routeAwareFunction.indexOf(
      "perform public.assert_persisted_session_request(",
    );
    const routeCommit = routeAwareFunction.indexOf(
      "perform public.commit_study_route_revision(requested_route);",
    );
    const routeProjection = routeAwareFunction.indexOf(
      "perform public.assert_committed_study_route_projection(",
    );
    const tombstoneWrite = routeAwareFunction.indexOf(
      "-- Every routed row omitted by the replacement becomes a skipped tombstone",
    );

    expect(sessionWrite).toBeGreaterThan(-1);
    expect(sessionProjection).toBeGreaterThan(sessionWrite);
    expect(routeCommit).toBeGreaterThan(sessionProjection);
    expect(routeProjection).toBeGreaterThan(routeCommit);
    expect(tombstoneWrite).toBeGreaterThan(routeProjection);
    expect(routeAwareFunction).not.toContain("exception when others then\n    return");
  });

  it("returns only requested active replacements with their full committed routes", () => {
    expect(routeAwareFunction).toContain(
      "from pg_catalog.jsonb_array_elements(payload -> 'sessions') as candidate(value)\n"
      + "  join public.plan_sessions as session",
    );
    expect(routeAwareFunction).toContain(
      "'studyRoute', pg_catalog.jsonb_build_object(",
    );
    expect(routeAwareFunction).toContain("'routeLineageId', route.route_lineage_id");
    expect(routeAwareFunction).toContain("'routeRevisionId', route.route_revision_id");
    expect(routeAwareFunction).toContain(") || route.route_payload");
    expect(routeAwareFunction).toContain(
      "message = 'plan_adjustment_authoritative_readback_failed'",
    );
  });

  it("contains no duplicate RAISE USING option in any exception block", () => {
    const raiseBlocks = [...migration.matchAll(/raise exception using([\s\S]*?);/g)];
    expect(raiseBlocks.length).toBeGreaterThan(0);

    for (const block of raiseBlocks) {
      const options = [...block[1]!.matchAll(/\b(errcode|message|detail|hint|column|constraint|datatype|table|schema)\s*=/g)]
        .map((match) => match[1]);
      expect(new Set(options).size, block[0]).toBe(options.length);
    }
  });

  it("is the first migration to expose the route-aware adjustment boundary", () => {
    const earlierMigrations = readdirSync(migrationsDirectory)
      .filter((name) => name.endsWith(".sql") && name < migrationName);

    expect(earlierMigrations.length).toBeGreaterThan(0);
    for (const name of earlierMigrations) {
      expect(
        readFileSync(resolve(migrationsDirectory, name), "utf8"),
        name,
      ).not.toContain("adjust_learning_plan_with_routes");
    }
  });
});
