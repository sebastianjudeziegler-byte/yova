import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CANONICAL_PROFILE_QUESTIONS } from "@/lib/personalization/canonical-profile-questionnaire";

describe("public canonical study profile", () => {
  it("starts the same optional 11-question profile used inside YOVA", () => {
    const source = readFileSync(resolve(
      process.cwd(),
      "src/components/study-profile/canonical-study-profile-experience.tsx",
    ), "utf8");

    expect(CANONICAL_PROFILE_QUESTIONS).toHaveLength(11);
    expect(source).toContain("ONE CANONICAL STUDY PROFILE");
    expect(source).toContain("11 short, optional questions");
    expect(source).toContain("not a personality type");
    expect(source).not.toContain("14 questions");
    expect(source).toContain("writePublicCanonicalProfileDraft(window.localStorage, profile)");
    expect(source).toContain('role="progressbar"');
    expect(source).toContain('aria-label="Study Profile progress"');
    expect(source).toContain("activeHeadingRef.current?.focus()");
  });
});
