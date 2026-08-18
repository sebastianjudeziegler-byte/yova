import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("account-export lifecycle configuration", () => {
  it("schedules Storage deletion within the documented approximately-one-hour bound", () => {
    const vercel = JSON.parse(readFileSync(`${root}/vercel.json`, "utf8")) as {
      crons?: Array<{ path?: string; schedule?: string }>;
    };
    const migration = readFileSync(
      `${root}/supabase/migrations/202608170003_account_data_export.sql`,
      "utf8",
    );

    expect(vercel.crons).toContainEqual({
      path: "/api/internal/account-export-cleanup",
      schedule: "*/15 * * * *",
    });
    expect(migration).toContain("artifact_expires_at = now() + interval '40 minutes'");
  });
});
