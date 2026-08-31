import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ConceptMapRuntimePanel,
  ErrorRepairRuntimePanel,
  WorkedExampleRuntimePanel,
  conceptMapDraftAnswer,
  conceptMapDraftIsComplete,
  conceptMapDraftPhrases,
} from "./method-runtime-panel";

const conceptMap = {
  kind: "concept_map" as const,
  instructions: "Connect each concept with a precise phrase that explains the relationship.",
  nodes: [
    { id: "glucose", label: "Glucose" },
    { id: "glycolysis", label: "Glycolysis" },
    { id: "atp", label: "ATP" },
  ],
  connections: [
    { fromId: "glucose", toId: "glycolysis", prompt: "How are these related?", expectedRelationship: "Glucose is broken down during glycolysis." },
    { fromId: "glycolysis", toId: "atp", prompt: "What does this process produce?", expectedRelationship: "Glycolysis produces a net gain of ATP." },
  ],
};

describe("method runtime panels", () => {
  it("renders the complete and faded worked-example sequence", () => {
    const html = renderToStaticMarkup(createElement(WorkedExampleRuntimePanel, {
      runtime: {
        kind: "worked_example",
        problem: "Find the acceleration from the force and mass.",
        steps: [
          { statement: "Write F = ma.", why: "This connects force, mass, and acceleration." },
          { statement: "Rearrange to a = F / m.", why: "Acceleration is the unknown quantity." },
        ],
        fadedProblem: "Find acceleration for a different force and mass.",
        fadedSteps: [
          { statement: "Write the relationship.", prompt: null, expectedAnswer: null },
          { statement: "Solve for acceleration.", prompt: "Which rearrangement is needed?", expectedAnswer: "a = F / m" },
        ],
      },
    }));

    expect(html).toContain("COMPLETE MODEL");
    expect(html).toContain("SUPPORT FADES HERE");
    expect(html).toContain("Which rearrangement is needed?");
    expect(html).not.toContain("a = F / m</strong>");
  });

  it("renders error reconstruction, rule contrast, and a fresh check", () => {
    const html = renderToStaticMarkup(createElement(ErrorRepairRuntimePanel, {
      runtime: {
        kind: "error_repair",
        observedError: "The denominator was multiplied instead of divided.",
        whyItSeemedReasonable: "The learner correctly noticed the denominator had to move.",
        incorrectRule: "Moving a term always changes division into multiplication.",
        correctRule: "Use the inverse operation that preserves equality.",
        warningSign: "A term crosses the equals sign without an operation on both sides.",
        correctedExample: "Divide both sides by the coefficient before simplifying.",
        parallelPrompt: "Solve a comparable equation with a new coefficient.",
        parallelAnswer: "Apply the inverse operation to both sides.",
      },
    }));

    expect(html).toContain("WHAT WENT WRONG");
    expect(html).toContain("RULE CONTRAST");
    expect(html).toContain("FRESH CHECK");
    expect(html).toContain("Solve a comparable equation");
    expect(html).not.toContain("Apply the inverse operation to both sides");
  });

  it("renders a relationship builder without revealing the factual map before checking", () => {
    const html = renderToStaticMarkup(createElement(ConceptMapRuntimePanel, {
      runtime: conceptMap,
      value: "",
      disabled: false,
      revealExpected: false,
      onChange: () => undefined,
    }));

    expect(html).toContain("CONCEPT MAP");
    expect(html).toContain("Glucose");
    expect(html).toContain("Glycolysis");
    expect(html).toContain("Write the relationship");
    expect(html).not.toContain("Glucose is broken down during glycolysis");
  });

  it("reveals only the server-authored relationships after the learner checks the map", () => {
    const answer = conceptMapDraftAnswer(conceptMap, [
      "is broken down during",
      "produces a net gain of",
    ]);
    const html = renderToStaticMarkup(createElement(ConceptMapRuntimePanel, {
      runtime: conceptMap,
      value: answer,
      disabled: true,
      revealExpected: true,
      onChange: () => undefined,
    }));

    expect(conceptMapDraftPhrases(conceptMap, answer)).toEqual([
      "is broken down during",
      "produces a net gain of",
    ]);
    expect(conceptMapDraftIsComplete(conceptMap, answer)).toBe(true);
    expect(conceptMapDraftIsComplete(conceptMap, conceptMapDraftAnswer(conceptMap, ["", "produces"]))).toBe(false);
    expect(html).toContain("REFERENCE RELATIONSHIP");
    expect(html).toContain("Glucose is broken down during glycolysis");
  });
});
