import { describe, expect, it } from "vitest";
import { isDocumentLabelTitle } from "./document-label";

describe("topic titles name knowledge, not parts of a document", () => {
  it.each(["Unit 6 test scope", "Unit 6 concept explanations", "Chapter 12", "Unit 3: Overview", "Exam review topics", "Key terms", "Learning objectives", "Study guide questions", "Week 4 notes"])("flags %j", title => {
    expect(isDocumentLabelTitle(title)).toBe(true);
  });
  it.each(["Gene expression", "Transcription and RNA processing", "The product rule", "Causes of World War I", "Osmosis and water potential", "Explaining concepts to others", "Unit conversions in stoichiometry"])("accepts %j", title => {
    expect(isDocumentLabelTitle(title)).toBe(false);
  });
});
