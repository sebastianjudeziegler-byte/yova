import { describe, expect, it } from "vitest";
import { normalizeTutorMarkdown } from "@/lib/tutor/formatting";

describe("normalizeTutorMarkdown", () => {
  it("converts common model math delimiters for the tutor renderer", () => {
    expect(normalizeTutorMarkdown(String.raw`Use \(x=2\), then:
\[
\frac{f(2.1)-f(2)}{2.1-2}
\]`)).toBe(String.raw`Use $x=2$, then:
$$
\frac{f(2.1)-f(2)}{2.1-2}
$$`);
  });

  it("removes long dash punctuation without damaging Markdown structure", () => {
    expect(normalizeTutorMarkdown("**Core idea** \u2014 retrieve it first\n\n- Try once"))
      .toBe("**Core idea**, retrieve it first\n\n- Try once");
  });

  it("escapes ordinary currency while preserving delimited equations", () => {
    expect(normalizeTutorMarkdown("USD example: $100 becomes $110. Equation: $2x + 3$."))
      .toBe("USD example: \\$100 becomes \\$110. Equation: $2x + 3$.");
  });
});
