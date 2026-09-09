import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { liveFixturePath } from "./live-fixtures";

afterEach(() => vi.unstubAllEnvs());
it("a failed producer cannot lend an earlier run's lesson to a later browser journey", () => {
  const root = mkdtempSync(resolve(tmpdir(), "yova-live-fixture-test-"));
  try {
    vi.stubEnv("YOVA_LIVE_FIXTURE_ROOT", resolve(root, "run-1"));
    writeFileSync(liveFixturePath("deadline", "live-ten-minute.json"), JSON.stringify({ title: "Learn ATP" }));
    expect(JSON.parse(readFileSync(liveFixturePath("deadline", "live-ten-minute.json"), "utf8"))).toEqual({ title: "Learn ATP" });
    vi.stubEnv("YOVA_LIVE_FIXTURE_ROOT", resolve(root, "run-2"));
    expect(existsSync(liveFixturePath("deadline", "live-ten-minute.json"))).toBe(false);
    expect(liveFixturePath("launch", "calculus-result.json")).not.toEqual(liveFixturePath("deadline", "calculus-result.json"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
