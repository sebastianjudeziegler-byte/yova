import { describe, expect, it } from "vitest";
import { documentReferentialReason } from "./document-referential";

describe("spec section 8 rule 2: document-referential questions are rejected", () => {
  it.each([
    "Which statement fits the notes on transcription?",
    "According to the study guide, which enzyme unwinds DNA?",
    "What are the goals of Unit 6?",
    "What does the study guide list as the three stages of translation?",
    "Which topic is on the Unit 6 test?",
    "Based on your class notes, what does helicase do?",
    "Which answer matches the provided materials?",
    "The outline lists which processes?",
  ])("rejects %j", question => {
    expect(documentReferentialReason(question)).not.toBeNull();
  });
  it.each([
    "Which enzyme unwinds the DNA double helix at the replication fork?",
    "A cell is placed in a hypotonic solution. What happens to its volume?",
    "Why does the lagging strand need Okazaki fragments?",
    "In the Treaty of Versailles, which clause assigned war guilt to Germany?",
    "Write a note explaining why ATP synthase needs a proton gradient.",
    "Which guide RNA sequence would target this gene in CRISPR?",
  ])("accepts %j", question => {
    expect(documentReferentialReason(question)).toBeNull();
  });
});
