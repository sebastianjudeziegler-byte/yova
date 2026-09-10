import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeArtifactText } from "./artifact-safety.mjs";

test("published browser evidence removes runner credentials even without an ambient key", () => {
  const report = { config: { webServer: { env: { OPENAI_API_KEY: "synthetic-provider-credential" } } }, suites: [{ title: "learner completes", specs: [] }], errors: [], stats: { expected: 1 } };
  const sanitized = JSON.parse(sanitizeArtifactText(JSON.stringify(report), {}));
  assert.equal(sanitized.config, undefined);
  assert.deepEqual(sanitized.suites, report.suites);
  assert.deepEqual(sanitized.stats, report.stats);
});
test("provider diagnostics redact credential values without changing test outcomes", () => {
  const result = sanitizeArtifactText('failure: synthetic-provider-credential\n{"state":"failed"}\n', { OPENAI_API_KEY: "synthetic-provider-credential" });
  assert.equal(result, 'failure: [REDACTED]\n{"state":"failed"}\n');
});
