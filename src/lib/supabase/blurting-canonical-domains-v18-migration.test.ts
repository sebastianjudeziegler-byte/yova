import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "202608240007_blurting_canonical_domains_v18.sql";
const migrationDirectory = resolve(process.cwd(), "supabase/migrations");
const migration = readFileSync(
  resolve(migrationDirectory, migrationName),
  "utf8",
);
const lowerMigration = migration.toLocaleLowerCase();

function section(start: string, end: string) {
  const startIndex = lowerMigration.indexOf(start);
  const endIndex = lowerMigration.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return lowerMigration.slice(startIndex, endIndex);
}

const trimHelper = section(
  "create or replace function private.blurting_ecmascript_trim_v1(",
  "create or replace function private.blurting_bounded_text_valid_v18(",
);
const timestampHelpers = section(
  "create or replace function private.blurting_timestamp_value_valid_v18(",
  "revoke all on function private.blurting_ecmascript_trim_v1(text)",
);
const constraints = section(
  "alter table private.blurting_resources_v18\n  add constraint",
  "-- replace only the four raw statement-time calls",
);
const guardReplacement = section(
  "-- replace only the four raw statement-time calls",
  "alter table private.blurting_resources_v18\n  validate constraint",
);

describe("dormant Blurting V18 canonical-domain migration", () => {
  it("is ordered immediately after the empty migration-006 private store", () => {
    const ordered = readdirSync(migrationDirectory)
      .filter((name) => /^20260824000[567]_/.test(name))
      .sort();

    expect(ordered).toEqual([
      "202608240005_generated_resource_authority.sql",
      "202608240006_blurting_resource_store_v18.sql",
      migrationName,
    ]);
    for (const dependency of [
      "private.blurting_resources_v18",
      "private.blurting_delivery_receipts_v18",
      "private.blurting_evaluation_receipts_v18",
      "private.blurting_public_resource_payload_valid_v18(jsonb)",
      "private.blurting_source_snapshot_valid_v1(jsonb,text,text[])",
    ]) {
      expect(lowerMigration).toContain(`'${dependency}'`);
    }
    expect(lowerMigration).toContain(
      "message = 'blurting_canonical_domains_v18_dependency_missing'",
    );
  });

  it("pins the complete ECMAScript TrimString set without Unicode-class drift", () => {
    const expectedCodePoints = [
      9, 10, 11, 12, 13, 32, 160, 5760,
      8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201,
      8202, 8232, 8233, 8239, 8287, 12288, 65279,
    ];
    const actualCodePoints = [...trimHelper.matchAll(/pg_catalog\.chr\((\d+)\)/gu)]
      .map((match) => Number(match[1]));

    expect(actualCodePoints).toEqual(expectedCodePoints);
    for (const excludedCodePoint of [133, 6158, 8203]) {
      expect(trimHelper).not.toContain(`pg_catalog.chr(${excludedCodePoint})`);
    }
    expect(trimHelper).toContain("pg_catalog.btrim(");
    expect(lowerMigration).not.toContain("[[:space:]]");
    expect(lowerMigration).not.toContain("\\s");
    expect(lowerMigration).not.toContain("\\p{");
  });

  it("uses exact edge equality and Unicode code-point counts for bounded text", () => {
    expect(lowerMigration).toContain(
      "candidate = private.blurting_ecmascript_trim_v1(candidate)",
    );
    expect(lowerMigration).toContain("pg_catalog.char_length(candidate)");
    expect(lowerMigration).toContain(
      "create or replace function private.blurting_json_strings_canonical_v18(",
    );
    expect(lowerMigration).toContain(
      "create or replace function private.blurting_json_string_array_valid_v18(",
    );
    expect(lowerMigration).toContain(
      "private.blurting_source_snapshot_text_valid_v18(",
    );
    expect(lowerMigration).toContain(
      "private.blurting_public_payload_text_valid_v18(public_payload)",
    );
    expect(lowerMigration).toContain(
      "private.blurting_server_payload_text_valid_v18(",
    );
    expect(lowerMigration).not.toMatch(/\b(?:if|or)\s+not private\.blurting_/u);
    expect(lowerMigration.match(/\) is not true/gu)?.length)
      .toBeGreaterThanOrEqual(35);
    for (const range of [
      "'canonicaltext', 1, 7000",
      "'displaylabel', 2, 120",
      "'referenceanswer', 1, 1200",
      "'model', 1, 160",
      "'comparisoncriterion', 8, 240",
      "'transfersuccesscriterion', 8, 240",
      "'{prompts,0,prompt}', 3, 320",
      "'{prompts,0,expectedanswer}', 1, 600",
      "runtime_payload -> 'gapchecklist', 1, 6, 3, 240",
    ]) {
      expect(lowerMigration).toContain(range);
    }
  });

  it("keeps canonical helper signatures and source-validator calls arity-exact", () => {
    const snapshotSignature = section(
      "create or replace function private.blurting_source_snapshot_text_valid_v18(",
      ")\nreturns boolean\nlanguage plpgsql",
    );
    const timestampSignature = section(
      "create or replace function private.blurting_timestamp_text_matches_v18(",
      ")\nreturns boolean\nlanguage plpgsql",
    );

    expect(snapshotSignature.match(/source_snapshot jsonb/gu)).toHaveLength(1);
    expect(snapshotSignature.match(/expected_source_type text/gu)).toHaveLength(1);
    expect(snapshotSignature.match(/expected_source_ids text\[\]/gu)).toHaveLength(1);
    expect(timestampSignature.match(/candidate text/gu)).toHaveLength(1);
    expect(timestampSignature.match(/expected_value timestamptz/gu)).toHaveLength(1);
    expect(lowerMigration).toContain([
      "private.blurting_source_snapshot_valid_v1(",
      "      source_snapshot,",
      "      expected_source_type,",
      "      expected_source_ids",
      "    )",
    ].join("\n"));
    expect(lowerMigration).not.toContain([
      "expected_source_ids",
      "      expected_source_ids",
    ].join("\n"));
    expect(timestampSignature).not.toContain([
      "candidate text,",
      "  candidate text,",
    ].join("\n"));
  });

  it("pins exact UTC millisecond spellings and database values", () => {
    expect(timestampHelpers).toContain(
      "create or replace function private.blurting_timestamp_value_valid_v18(",
    );
    expect(timestampHelpers).toContain("pg_catalog.isfinite(candidate)");
    expect(timestampHelpers).toContain(
      "extract(year from candidate at time zone 'utc') between 1 and 9999",
    );
    expect(timestampHelpers).toContain(
      "candidate = pg_catalog.date_trunc('milliseconds', candidate)",
    );
    expect(timestampHelpers).toContain(
      "'yyyy-mm-dd\"t\"hh24:mi:ss.ms\"z\"'",
    );
    expect(timestampHelpers).toContain(
      "^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])t([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{3}z$",
    );
    expect(timestampHelpers).toContain(
      "private.blurting_timestamp_text_v18(parsed_value) = candidate",
    );
    expect(timestampHelpers).toContain(
      "create or replace function private.blurting_statement_timestamp_ms_v18()",
    );
    expect(lowerMigration).toContain("pg_catalog.getdatabaseencoding()");
    expect(lowerMigration).toContain("pg_catalog.chr(0)");
    expect(lowerMigration).toContain("pg_catalog.chr(55296)");
    expect(lowerMigration).toContain("pg_catalog.chr(128512), 1, 1");
    expect(lowerMigration).toContain("pg_catalog.chr(160)");
    expect(lowerMigration).toContain("pg_catalog.chr(65279)");
    expect(lowerMigration).toContain(
      "message = 'blurting_canonical_domains_v18_vector_changed'",
    );
  });

  it("constrains every persisted V18 instant and both generatedAt spellings", () => {
    for (const timestampColumn of [
      "generated_at",
      "created_at",
      "retired_at",
      "retire_after",
      "issued_at",
      "last_seen_at",
      "expires_at",
      "recall_disclosed_at",
      "compare_disclosed_at",
      "repair_disclosed_at",
      "transfer_disclosed_at",
      "complete_disclosed_at",
      "closed_at",
      "leased_until",
      "completed_at",
    ]) {
      expect(constraints).toContain(
        `private.blurting_timestamp_value_valid_v18(${timestampColumn})`,
      );
    }
    expect(constraints).toContain(
      "public_payload #>> '{identity,resourcegeneratedat}'",
    );
    expect(constraints).toContain(
      "server_payload #>> '{session,generatedat}'",
    );
    expect(lowerMigration).toContain([
      "alter column created_at",
      "  set default private.blurting_statement_timestamp_ms_v18();",
    ].join("\n"));
  });

  it("updates only the four private guards to the canonical statement instant", () => {
    for (const signature of [
      "private.guard_blurting_delivery_insert_v18()",
      "private.guard_blurting_delivery_transition_v18()",
      "private.guard_blurting_evaluation_insert_v18()",
      "private.guard_blurting_evaluation_transition_v18()",
    ]) {
      expect(guardReplacement).toContain(`'${signature}'`);
    }
    expect(guardReplacement).toContain("raw_call_count <> 1");
    expect(guardReplacement).toContain(
      "message = 'blurting_canonical_domains_v18_guard_changed'",
    );
    expect(guardReplacement).toContain(
      "private.blurting_statement_timestamp_ms_v18()",
    );
    expect(guardReplacement).not.toContain("clock_timestamp()'");
  });

  it("locks and rejects unexpected 006 rows before validating all constraints", () => {
    const resourceLock = lowerMigration.indexOf(
      "lock table private.blurting_resources_v18 in share row exclusive mode;",
    );
    const deliveryLock = lowerMigration.indexOf(
      "lock table private.blurting_delivery_receipts_v18",
    );
    const evaluationLock = lowerMigration.indexOf(
      "lock table private.blurting_evaluation_receipts_v18",
    );
    const unexpectedRows = lowerMigration.indexOf(
      "blurting_canonical_domains_v18_unexpected_existing_row",
    );
    const addConstraint = lowerMigration.indexOf(
      "add constraint blurting_resources_v18_canonical_domains_check",
    );
    const transaction = lowerMigration.lastIndexOf("\nbegin;\n", resourceLock);
    const dependencyCheck = lowerMigration.indexOf(
      "blurting_canonical_domains_v18_dependency_missing",
    );
    const commit = lowerMigration.lastIndexOf("\ncommit;");

    expect(resourceLock).toBeGreaterThanOrEqual(0);
    expect(transaction).toBeGreaterThan(-1);
    expect(dependencyCheck).toBeGreaterThan(transaction);
    expect(resourceLock).toBeGreaterThan(transaction);
    expect(deliveryLock).toBeGreaterThan(resourceLock);
    expect(evaluationLock).toBeGreaterThan(deliveryLock);
    expect(unexpectedRows).toBeGreaterThan(evaluationLock);
    expect(addConstraint).toBeGreaterThan(unexpectedRows);
    expect(commit).toBeGreaterThan(addConstraint);
    expect(lowerMigration.trimEnd().endsWith("commit;")).toBe(true);
    for (const constraintName of [
      "blurting_resources_v18_canonical_domains_check",
      "blurting_delivery_receipts_v18_canonical_domains_check",
      "blurting_evaluation_receipts_v18_canonical_domains_check",
    ]) {
      expect(lowerMigration).toContain(`validate constraint ${constraintName};`);
    }
  });

  it("keeps the migration private, dormant, and zero-access", () => {
    expect(lowerMigration).not.toMatch(
      /^\s*create\s+(?:or\s+replace\s+)?function\s+public\./gmu,
    );
    expect(lowerMigration).not.toMatch(/^\s*grant\s/gmu);
    expect(lowerMigration).not.toMatch(/^\s*notify\s/gmu);
    expect(lowerMigration).not.toMatch(/^\s*(?:insert|update|delete)\s/gmu);
    expect(lowerMigration).not.toContain("feature_flag");
    expect(lowerMigration).not.toContain("allowbroadrecall");
    expect(lowerMigration).not.toContain("auth.uid()");
    expect(lowerMigration).not.toContain("request.jwt.claim");
    for (const role of ["public", "anon", "authenticated", "service_role"]) {
      expect(lowerMigration).toContain(role);
    }
    expect(lowerMigration.match(/revoke all on function /gu)?.length)
      .toBeGreaterThanOrEqual(12);
  });
});
