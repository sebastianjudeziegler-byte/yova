import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, extname } from "node:path";
import { sanitizeArtifactText } from "./live-gate/artifact-safety.mjs";
if (!process.env.GITHUB_ACTIONS) throw new Error("Artifact publishing runs in GitHub Actions only.");
for (const directory of process.argv.slice(2)) {
  const root = resolve(directory);
  if (!existsSync(root)) continue;
  for (const file of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!file.isFile()) continue;
    const path = resolve(file.parentPath, file.name);
    // Source-first live browser evidence retains video/screens and outcomes.
    // Opaque trace bundles can also embed runner configuration.
    if (extname(path) === ".zip" && path.includes("live-browser")) { unlinkSync(path); continue; }
    if (![".json", ".jsonl", ".txt", ".md", ".log"].includes(extname(path))) continue;
    writeFileSync(path, sanitizeArtifactText(readFileSync(path, "utf8"), process.env));
  }
}
