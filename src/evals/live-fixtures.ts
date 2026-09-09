import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/** Test-only producer/consumer paths. The full gate supplies a fresh root per run. */
export function liveFixturePath(group: "launch" | "deadline", name: string) {
  const root = process.env.YOVA_LIVE_FIXTURE_ROOT;
  const directory = root
    ? resolve(root, group)
    : group === "launch"
      ? "/tmp/yova-launch-regressions"
      : resolve("docs/audits/2026-09-07-plan-creation/consolidated/evidence");
  mkdirSync(directory, { recursive: true });
  return resolve(directory, name);
}
