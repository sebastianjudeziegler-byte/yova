import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const migrations = readdirSync(migrationsDirectory)
  .filter((filename) => filename.endsWith(".sql"))
  .sort()
  .map((filename) => readFileSync(resolve(migrationsDirectory, filename), "utf8"))
  .join("\n");

const TABLE_INVENTORY = {
  includedInArtifact: [
    "deadline_milestones",
    "error_reports",
    "learner_profiles",
    "learning_events",
    "learning_items",
    "material_chunks",
    "material_uploads",
    "materials",
    "plan_sessions",
    "plans",
    "product_events",
    "profiles",
    "session_attempts",
    "support_requests",
    "tutor_messages",
    "tutor_threads",
  ],
  sanitizedInArtifact: [
    "ai_usage_windows",
    "founder_accounts",
    "tester_invites",
  ],
  internalExcluded: [
    "account_data_exports",
    "account_deletion_cleanup_jobs",
    "ai_usage_claims",
  ],
  separatePublicStudyProfile: [
    "study_profile_events",
    "study_profile_leads",
    "study_profile_responses",
  ],
} as const;

const STORAGE_INVENTORY = {
  manifestedWithoutBinaryContent: ["learning-materials"],
  internalExcluded: ["account-exports"],
} as const;

describe("account-data export inventory drift", () => {
  it("classifies every public table, including internal and separate public-profile records", () => {
    const createdTables = new Set(
      [...migrations.matchAll(/create table(?: if not exists)? public[.]([a-z_]+)/gi)]
        .map((match) => match[1]),
    );
    const classifiedTables = Object.values(TABLE_INVENTORY).flat();

    expect([...createdTables].sort()).toEqual([...classifiedTables].sort());
    expect(createdTables.size).toBe(25);
    expect(TABLE_INVENTORY.internalExcluded).toContain("account_data_exports");
    expect(TABLE_INVENTORY.internalExcluded).toContain("account_deletion_cleanup_jobs");
    expect(TABLE_INVENTORY.separatePublicStudyProfile).toEqual([
      "study_profile_events",
      "study_profile_leads",
      "study_profile_responses",
    ]);
  });

  it("classifies every private Storage bucket", () => {
    const bucketNames = new Set(
      [...migrations.matchAll(
        /insert into storage[.]buckets[\s\S]*?values\s*\(\s*'([^']+)'/gi,
      )].map((match) => match[1]),
    );
    const classifiedBuckets = Object.values(STORAGE_INVENTORY).flat();

    expect([...bucketNames].sort()).toEqual([...classifiedBuckets].sort());
    expect(STORAGE_INVENTORY.internalExcluded).toContain("account-exports");
  });
});
