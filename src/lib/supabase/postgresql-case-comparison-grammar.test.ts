import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const migrations = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => ({
    name,
    sql: readFileSync(resolve(migrationsDirectory, name), "utf8"),
  }));

describe("PostgreSQL CASE comparison grammar", () => {
  it.each(migrations)(
    "parenthesizes CASE operands after IS DISTINCT FROM in $name",
    ({ sql }) => {
      expect(sql).not.toMatch(
        /\bis\s+(?:not\s+)?distinct\s+from\s+case\b/i,
      );
    },
  );
});
