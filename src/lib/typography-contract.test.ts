import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("typography contract", () => {
  const globalStyles = readSource("src/app/globals.css");

  it("defines the font and tracking tokens used by global component styles", () => {
    expect(globalStyles).toMatch(/--font-inter:\s*"Inter";/);
    expect(globalStyles).toMatch(/--font-sora:\s*"Sora";/);
    expect(globalStyles).toMatch(/--tracking-heading:\s*-.018em;/);
    expect(globalStyles).toMatch(/h1, h2\s*\{[^}]*letter-spacing:\s*var\(--tracking-heading\);/);

    for (const path of ["src/app/layout.tsx", "src/app/global-error.tsx"]) {
      const source = readSource(path);
      expect(source).toContain('import "@fontsource/inter/700.css";');
      expect(source).toContain('import "@fontsource/inter/800.css";');
    }
  });

  it("keeps compact duration values readable and aligned", () => {
    expect(globalStyles).toMatch(/\.duration-value\s*\{[^}]*font-variant-numeric:\s*tabular-nums;/);
    expect(globalStyles).toMatch(/\.duration-unit\s*\{[^}]*font-size:\s*12px;/);
    expect(globalStyles).toMatch(/\.agenda-capacity-options button\s*\{[^}]*min-height:\s*46px;/);

    for (const path of [
      "src/components/plan-creator.tsx",
      "src/components/study-now-creator.tsx",
    ]) {
      const source = readSource(path);
      expect(source).toContain('className="duration-value"');
      expect(source).toContain('className="duration-unit"');
    }
  });
});
