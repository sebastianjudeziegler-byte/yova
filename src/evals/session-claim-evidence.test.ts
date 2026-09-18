import { describe, expect, it } from "vitest";
import { unsupportedLearnerClaimEvidence, UNSUPPORTED_LEARNER_CLAIM_PATTERN } from "./session-claim-evidence";

function draft(): Parameters<typeof unsupportedLearnerClaimEvidence>[0] {
  return {
    rationale: "Use a diagnostic check to identify the next history idea to explain.",
    coverage: { focus: "The outbreak of World War I", essentialIdeas: [], completionEvidence: [], deferredContent: [] },
    methodBriefing: { name: "Active recall", what: "Recall the causal chain.", why: "Check the links independently.", how: [], completion: "Explain the outbreak.", personalization: [] },
    activities: [],
  };
}

describe("bounded synthetic session claim evidence", () => {
  it("identifies the exact learner-facing field and preserves the matched claim", () => {
    const session = draft();
    session.methodBriefing.personalization = ["Because you are a visual learner, build a map of the alliances."];
    expect(unsupportedLearnerClaimEvidence(session)).toEqual([{ field: "methodBriefing.personalization[0]", matchedPhrase: "visual learner", snippet: session.methodBriefing.personalization[0] }]);
    expect(UNSUPPORTED_LEARNER_CLAIM_PATTERN.test(session.methodBriefing.personalization[0])).toBe(true);
    expect(unsupportedLearnerClaimEvidence(draft())).toEqual([]);
    expect(UNSUPPORTED_LEARNER_CLAIM_PATTERN.test(draft().rationale)).toBe(false);
  });

  it("limits the retained evidence and redacts contacts and URLs", () => {
    const session = draft();
    session.methodBriefing.personalization = Array.from({ length: 6 }, () => `${"Before. ".repeat(50)}test@example.com https://example.test/private?token=secret Because you are a visual learner, ${"after. ".repeat(100)}`);
    const evidence = unsupportedLearnerClaimEvidence(session);
    expect(evidence).toHaveLength(3);
    for (const match of evidence) {
      expect(match.snippet.length).toBeLessThanOrEqual(220);
      expect(match.snippet).toContain("visual learner");
      expect(match.snippet).toContain("[email] [url]");
      expect(match.snippet).not.toMatch(/example|secret|token/);
    }
  });

  it("also identifies teaching steps and answer options without collecting unscanned metadata", () => {
    const session = draft();
    session.activities = [{
      label: "Recall", title: "Trace the cause", body: "Recall the event.", choices: ["Your brain type decides how to remember."], correctAnswer: null, feedback: null,
      teaching: { keyIdea: "Alliances contributed to escalation.", explanation: "Follow each connection.", example: { setup: "Start with the declaration.", steps: ["An auditory learner must hear each declaration."], takeaway: "Explain the escalation." }, commonMistake: null },
    }];
    expect(unsupportedLearnerClaimEvidence(session).map((match) => match.field)).toEqual(["activities[0].choices[0]", "activities[0].teaching.example.steps[0]"]);
  });
});
