import { describe, expect, it } from "vitest";
import { assessMaterialQuality } from "@/lib/materials/quality";

describe("assessMaterialQuality", () => {
  it("accepts a substantial readable source", () => {
    const text = Array.from({ length: 75 }, (_, index) => `concept${index} explains a useful relationship`).join(" ");
    expect(assessMaterialQuality(text, false)).toEqual({
      status: "ready",
      wordCount: 375,
      notice: null,
    });
  });

  it("keeps short readable notes but warns that coverage is limited", () => {
    const quality = assessMaterialQuality(
      "Mitosis produces two genetically identical cells through prophase, metaphase, anaphase, and telophase for growth and repair.",
      false,
    );
    expect(quality.status).toBe("limited");
    expect(quality.notice).toContain("small amount");
  });

  it("rejects empty and symbol-heavy files", () => {
    expect(assessMaterialQuality("", false).status).toBe("unusable");
    expect(assessMaterialQuality("### --- ??? !!! *** ### --- ??? !!! ***", false).status).toBe("unusable");
  });

  it("warns when YOVA reached its extraction boundary", () => {
    const text = Array.from({ length: 80 }, (_, index) => `topic${index} has readable explanatory material`).join(" ");
    const quality = assessMaterialQuality(text, true);
    expect(quality.status).toBe("limited");
    expect(quality.notice).toContain("50,000 characters");
  });
});
