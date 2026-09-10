import { buildSessionDeliveryPolicy } from "@/lib/personalization/session-delivery-policy";

export const BLOCK_TOPIC_ID = "c0000000-0000-4000-8000-000000000001";
export const BLOCK_ROUTE_ID = "c0000000-0000-4000-8000-000000000002";
export const BLOCK_ID = "c0000000-0000-4000-8000-000000000003";

/** Same usable lecture section and topic for both profiles. No provider evidence. */
export function blockFixture(profile: 1 | 2 = 1) {
  const source = {
    id: "lecture-page-1", topicId: BLOCK_TOPIC_ID,
    materialId: "c0000000-0000-4000-8000-000000000004", url: null,
    kind: "read_source_section", title: "Cellular energetics lecture.pdf",
    section: "Page 1 — ATP and energy transfer",
    text: "ATP hydrolysis releases free energy when ATP reacts with water to form ADP and inorganic phosphate. Cells couple this favorable reaction to processes that require energy. ATP is regenerated from ADP and phosphate using energy from other reactions.",
  };
  const questions = [
    {
      id: "atp-products", topicId: BLOCK_TOPIC_ID, format: "multiple_choice",
      prompt: "Which products form when ATP reacts with water in the reaction described on page 1?",
      choices: ["ADP and inorganic phosphate", "ADP and glucose", "AMP and oxygen"],
      hints: profile === 1 ? ["Locate the sentence describing hydrolysis.", "One product is a nucleotide; the other is a phosphate group."] : [],
      workedExample: profile === 1 ? "For ATP regeneration, identify the reactants first: ADP and phosphate. Now use the same reactant/product distinction for hydrolysis." : null,
      reflectBeforeCheck: profile === 2,
    },
    {
      id: "atp-coupling", topicId: BLOCK_TOPIC_ID, format: "short_answer",
      prompt: "In your own words, why can a cell couple ATP hydrolysis to an energy-requiring process?",
      choices: [], hints: profile === 1 ? ["Consider the direction of free-energy transfer."] : [],
      workedExample: null, reflectBeforeCheck: profile === 2,
    },
    ...(profile === 2 ? [{
      id: "atp-regeneration", topicId: BLOCK_TOPIC_ID, format: "short_answer",
      prompt: "What inputs are needed to regenerate ATP according to this page?",
      choices: [], hints: [], workedExample: null, reflectBeforeCheck: true,
    }] : []),
  ];
  const block = {
    version: 1, id: BLOCK_ID, topicIds: [BLOCK_TOPIC_ID], learningMode: "learn",
    objective: "Explain how ATP hydrolysis supplies energy for coupled cellular work.",
    instructions: "Read page 1, then answer the short practice check. Help is available without restarting your work.",
    stoppingPoint: "Finish the source section and attempt each practice question. Review the feedback; you may continue without repeating a question.",
    estimatedMinutes: 20, sources: [source],
    activities: [
      { id: "source-step", kind: "read_source_section", topicId: BLOCK_TOPIC_ID, title: "Read ATP and energy transfer", instructions: "Read page 1 and identify the reactants, products and direction of energy transfer.", sourceId: source.id, questionIds: [], estimatedMinutes: 10 },
      { id: "practice-step", kind: "quiz", topicId: BLOCK_TOPIC_ID, title: "Check ATP and energy transfer", instructions: profile === 1 ? "Start with the worked example; hints are available one at a time." : "Explain each answer in your own words before checking it.", sourceId: null, questionIds: questions.map(question => question.id), estimatedMinutes: 10 },
    ],
    questions,
    personalization: {
      profileReason: profile === 1 ? "You prefer examples and hints in a short focus window, so this check has two questions." : "You prefer to explain in your own words before checking, so this check has three questions with direct feedback.",
      examplesFirst: profile === 1, hintsAvailable: profile === 1,
      shortFocus: profile === 1, reflective: profile === 2, setSize: questions.length,
    },
    semanticReview: { policyVersion: "block_semantic_v1", status: "passed", reviewedAt: "2026-09-10T10:00:00.000Z" },
  };
  return {
    schemaVersion: 19, routeRevisionId: BLOCK_ROUTE_ID, model: "fixture-only",
    generatedAt: "2026-09-10T10:00:00.000Z", topicIds: [BLOCK_TOPIC_ID],
    rationale: block.personalization.profileReason,
    coverage: {
      focus: block.objective, essentialIdeas: ["ATP hydrolysis supports coupled cellular work"],
      completionEvidence: ["Explain the products of ATP hydrolysis and the direction of energy transfer"],
      evidenceMap: [{ essentialIdea: "ATP hydrolysis supports coupled cellular work", activityConcept: "ATP and energy transfer" }], deferredContent: [],
    },
    methodBriefing: {
      learningMode: "learn", taskType: "conceptual_learning", methodId: "retrieval_practice", name: "Retrieval Practice",
      what: "Read the assigned source section, then retrieve its central explanation.",
      why: block.personalization.profileReason,
      how: ["Study the assigned source section.", "Attempt the check, then review the feedback."],
      completion: block.stoppingPoint, personalization: [block.personalization.profileReason],
    },
    sourceGrounding: null,
    deliveryPolicy: buildSessionDeliveryPolicy({ learnerProfile: null, recentResults: [], recentInterruptions: [], learningMode: "learn", estimatedMinutes: 20 }),
    cacheContext: {
      effectiveMinutes: 20, adjustmentFingerprint: "a".repeat(64), contractFingerprint: "b".repeat(64),
      scopeFingerprint: "sc1:0123456789abcdef", routeRevisionId: BLOCK_ROUTE_ID,
    },
    activities: [], block,
  };
}
