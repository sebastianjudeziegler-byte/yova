import { redact } from "./core.mjs";

export function sanitizeArtifactText(source, environment) {
  let text = source;
  try {
    const report = JSON.parse(source);
    // Playwright's config serializes webServer.env. Evidence needs outcomes,
    // steps and errors, never the runner's complete configuration.
    if (report && !Array.isArray(report) && Array.isArray(report.suites) && report.config) {
      delete report.config;
      text = JSON.stringify(report, null, 2) + "\n";
    }
  } catch { /* Logs and JSONL still receive secret-value redaction. */ }
  return redact(text, environment);
}
